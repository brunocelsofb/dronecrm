'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isCurrentUserAdmin } from '@/lib/auth/role'
import { sendEvoTextMessage, sendEvoImageMessage, sendEvoDocumentMessage, verifyEvoConnection, getEvoQrCode, getEvoInstanceStatus, setEvoWebhook } from '@/lib/whatsapp/evolution'
import type { EvoCredentials } from '@/lib/whatsapp/evolution'
import { canSendAutomatedWhatsApp } from '@/lib/whatsapp/guardrails'
import { getActiveTenantId } from '@/lib/supabase/server'

async function getTenantId(admin: ReturnType<typeof createAdminClient>): Promise<string | null> {
  // Durante impersonation, o tenant ativo é lido do header injetado pelo middleware
  const activeTenantId = await getActiveTenantId()
  if (activeTenantId) return activeTenantId
  const { data } = await admin.from('organization_settings').select('tenant_id').eq('id', 'default').maybeSingle()
  return (data as any)?.tenant_id ?? null
}

export type ActionState = { error?: string; message?: any }

async function getEvoCredentials(): Promise<EvoCredentials | null> {
  const supabase = createAdminClient()
  const activeTenantId = await getActiveTenantId()
  let query = supabase.from('organization_settings').select('evo_server_url, evo_api_key, evo_instance_name, evo_instance_token').eq('id', 'default')
  if (activeTenantId) query = (query as any).eq('tenant_id', activeTenantId)
  const { data } = await (query as any).maybeSingle()
  if (!data?.evo_server_url || !data?.evo_api_key || !data?.evo_instance_name) return null
  return { serverUrl: data.evo_server_url, apiKey: data.evo_api_key, instanceName: data.evo_instance_name, instanceToken: (data as any).evo_instance_token ?? null }
}

export async function connectEvo(formData: FormData): Promise<ActionState> {
  if (!(await isCurrentUserAdmin())) return { error: 'Só administradores podem configurar isso.' }

  const serverUrl     = (formData.get('evo_server_url') as string)?.trim()
  const apiKey        = (formData.get('evo_api_key') as string)?.trim()
  const instanceName  = (formData.get('evo_instance_name') as string)?.trim()

  if (!serverUrl || !apiKey || !instanceName) return { error: 'Preencha Server URL, API Key e Instance Name.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('organization_settings')
    .update({ evo_server_url: serverUrl, evo_api_key: apiKey, evo_instance_name: instanceName, updated_at: new Date().toISOString() })
    .eq('id', 'default')

  if (error) return { error: error.message }

  const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://crm-gestaocontratos-pi.vercel.app'}/api/whatsapp-inbound/evolution`
  const webhookRes = await setEvoWebhook({ serverUrl, apiKey, instanceName, webhookUrl })
  if (!webhookRes.ok) console.warn('[evo] webhook não configurado:', webhookRes.error)

  revalidatePath('/settings')
  return {}
}

export async function getEvoQrCodeAction(): Promise<{ base64?: string; status?: string; error?: string }> {
  if (!(await isCurrentUserAdmin())) return { error: 'Acesso negado.' }
  const creds = await getEvoCredentials()
  if (!creds) return { error: 'Credenciais da Evolution API não configuradas.' }
  return getEvoQrCode(creds)
}

export async function configureEvoWebhook(): Promise<ActionState> {
  if (!(await isCurrentUserAdmin())) return { error: 'Acesso negado.' }
  const creds = await getEvoCredentials()
  if (!creds) return { error: 'Credenciais não configuradas.' }
  const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://crm-gestaocontratos-pi.vercel.app'}/api/whatsapp-inbound/evolution`
  const res = await setEvoWebhook({ ...creds, webhookUrl })
  if (!res.ok) return { error: `Erro ao configurar webhook: ${res.error}` }
  return {}
}

export async function disconnectEvo(): Promise<ActionState> {
  if (!(await isCurrentUserAdmin())) return { error: 'Só administradores podem configurar isso.' }
  const supabase = await createClient()
  await supabase
    .from('organization_settings')
    .update({ evo_server_url: null, evo_api_key: null, evo_instance_name: null })
    .eq('id', 'default')
  revalidatePath('/settings')
  return {}
}

export async function sendContractWhatsApp(
  contractId: string,
  phone: string,
  message: string,
  templateId: string | null,
  instanceName?: string | null
): Promise<ActionState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Usuário não autenticado.' }
  if (!phone) return { error: 'Informe o telefone do destinatário.' }
  if (!message.trim()) return { error: 'Escreva a mensagem.' }

  const creds = await getEvoCredentials()
  if (!creds) return { error: 'WhatsApp não está conectado. Vá em Configurações.' }

  const admin = createAdminClient()
  const tenantId = await getTenantId(admin)

  const rawPhone = phone.replace(/\D/g, '')
  const normalizedPhone = rawPhone.length <= 11 ? `55${rawPhone}` : rawPhone
  const { data: profile } = await admin.from('profiles').select('full_name, job_title').eq('id', user.id).maybeSingle()
  const senderName = (profile as any)?.full_name ?? null
  const jobTitle = (profile as any)?.job_title ?? null
  const signature = senderName
    ? (jobTitle ? `*${senderName} - ${jobTitle}:*` : `*${senderName}:*`)
    : null
  const signedMessage = signature ? `${signature} ${message}` : message
  const evoCreds = instanceName ? { ...creds, instanceName } : creds

  try {
    const evoResult: any = await sendEvoTextMessage({ ...evoCreds, phone: normalizedPhone, message: signedMessage })

    const { data: inserted, error: insertErr } = await admin
      .from('contract_whatsapp_messages')
      .insert({
        contract_id: contractId,
        sent_by: user.id,
        direction: 'enviado',
        phone: normalizedPhone,
        message: signedMessage,
        status: 'enviado',
        triggered_automatically: false,
        zapi_message_id: evoResult?.key?.id ?? null,
        instance_name: instanceName ?? creds.instanceName,
        tenant_id: tenantId,
      })
      .select('id, phone, message, direction, status, triggered_automatically, error_message, created_at, media_url, media_type, media_filename, sender_photo_url, delivery_status, sent_by, lead_id, zapi_message_id')
      .single()

    if (insertErr) {
      return { error: insertErr.message }
    }

    await unarchiveWhatsAppConversation(normalizedPhone, instanceName ?? creds.instanceName)

    revalidatePath('/whatsapp')
    revalidatePath(`/contracts/${contractId}`)

    return { message: { ...inserted, sent_by_name: senderName } }

  } catch (e: any) {
    const errorMsg = e?.message ?? 'Falha ao enviar WhatsApp.'
    await admin.from('contract_whatsapp_messages').insert({
      contract_id: contractId,
      sent_by: user.id,
      direction: 'enviado',
      phone: normalizedPhone,
      message: signedMessage,
      status: 'falhou',
      error_message: errorMsg,
      triggered_automatically: false,
      instance_name: instanceName ?? creds.instanceName,
      tenant_id: tenantId,
    })
    return { error: errorMsg }
  }
}

// Envio de Mídia pela Oportunidade CORRIGIDO (Garante inserção no banco com contract_id e revalida ambas as rotas)
export async function sendContractWhatsAppMedia(
  contractId: string,
  phone: string,
  mediaUrl: string,
  mediaType: 'image' | 'document' | 'video' | 'audio',
  filename: string | null
): Promise<ActionState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Usuário não autenticado.' }
  if (!phone) return { error: 'Informe o telefone do destinatário.' }

  const creds = await getEvoCredentials()
  if (!creds) return { error: 'WhatsApp ainda não está conectado.' }

  const admin = createAdminClient()
  const tenantId = await getTenantId(admin)
  const rawPhone = phone.replace(/\D/g, '')
  const normalizedPhone = rawPhone.length <= 11 ? `55${rawPhone}` : rawPhone
  const friendlyText = mediaType === 'image' ? '[imagem]' : `[${mediaType}] ${filename ?? ''}`

  try {
    const result: any =
      mediaType === 'image'
        ? await sendEvoImageMessage({ ...creds, phone: normalizedPhone, imageUrl: mediaUrl })
        : await sendEvoDocumentMessage({ ...creds, phone: normalizedPhone, documentUrl: mediaUrl, fileName: filename ?? 'documento' })

    const { error: insertErr } = await admin.from('contract_whatsapp_messages').insert({
      contract_id: contractId,
      sent_by: user.id,
      direction: 'enviado',
      phone: normalizedPhone,
      message: friendlyText,
      media_url: mediaUrl,
      media_type: mediaType,
      media_filename: filename,
      zapi_message_id: result?.key?.id ?? null,
      status: 'enviado',
      instance_name: creds.instanceName,
      tenant_id: tenantId,
    })

    if (insertErr) {
      console.error('[sendContractWhatsAppMedia] Erro no banco:', insertErr.message)
    }

    await admin.from('activities').insert({
      contract_id: contractId,
      user_id: user.id,
      type: 'whatsapp',
      content: `WhatsApp (${mediaType}) enviado pra ${normalizedPhone}.`,
      metadata: { kind: 'sent', phone: normalizedPhone, message: friendlyText },
    })
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : 'Falha ao enviar.'
    await admin.from('contract_whatsapp_messages').insert({
      contract_id: contractId,
      sent_by: user.id,
      direction: 'enviado',
      phone: normalizedPhone,
      message: friendlyText,
      media_url: mediaUrl,
      media_type: mediaType,
      media_filename: filename,
      status: 'falhou',
      error_message: errorMsg,
      instance_name: creds.instanceName,
      tenant_id: tenantId,
    })
    return { error: errorMsg }
  }

  revalidatePath('/whatsapp')
  revalidatePath(`/contracts/${contractId}`)
  return {}
}

function fillTemplateVariables(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '')
}

export async function buildWhatsAppFromTemplate(templateId: string, contractId: string): Promise<{ message: string; phone: string | null } | null> {
  const supabase = createAdminClient()

  const { data: template } = await supabase.from('email_templates').select('body').eq('id', templateId).maybeSingle()
  if (!template) return null

  const { data: contract } = await supabase.from('contracts').select('*').eq('id', contractId).maybeSingle()
  if (!contract) return null

  const { data: company } = contract.company_id
    ? await supabase.from('companies').select('name, cnpj').eq('id', contract.company_id).maybeSingle()
    : { data: null }
  const { data: contact } = contract.contact_id
    ? await supabase.from('contacts').select('name, phone').eq('id', contract.contact_id).maybeSingle()
    : { data: null }
  const { data: owner } = contract.owner_id
    ? await supabase.from('profiles').select('full_name').eq('id', contract.owner_id).maybeSingle()
    : { data: null }
  const { data: orgSettings } = await supabase.from('organization_settings').select('company_name, company_cnpj').eq('id', 'default').maybeSingle()

  const { data: customFieldDefs } = await supabase.from('custom_fields').select('id, field_key')
  const { data: customFieldValues } = await supabase.from('contract_custom_field_values').select('custom_field_id, value').eq('contract_id', contractId)
  const valueByFieldId = new Map((customFieldValues ?? []).map((v) => [v.custom_field_id, v.value]))
  const customVars: Record<string, string> = {}
  for (const field of customFieldDefs ?? []) {
    customVars[field.field_key] = valueByFieldId.get(field.id) ?? ''
  }

  const vars = {
    cliente: contract.client_name ?? '',
    empresa: company?.name ?? contract.client_name ?? '',
    contato: contact?.name ?? '',
    processo: contract.process_number ?? '',
    cnpj: company?.cnpj ?? '',
    minha_empresa: orgSettings?.company_name ?? '',
    minha_cnpj: orgSettings?.company_cnpj ?? '',
    responsavel: owner?.full_name ?? '',
    data_hoje: new Date().toLocaleDateString('pt-BR'),
    ...customVars,
  }

  return {
    message: fillTemplateVariables(template.body, vars),
    phone: contact?.phone ?? null,
  }
}

export async function sendAutomatedWhatsAppTemplateMessage(contractId: string, templateId: string): Promise<void> {
  const supabase = createAdminClient()
  const creds = await getEvoCredentials()
  if (!creds) return

  const filled = await buildWhatsAppFromTemplate(templateId, contractId)
  if (!filled?.phone) return

  const guard = await canSendAutomatedWhatsApp(filled.phone)
  if (!guard.ok) return

  try {
    const result: any = await sendEvoTextMessage({ ...creds, phone: filled.phone, message: filled.message })
    await supabase.from('contract_whatsapp_messages').insert({
      contract_id: contractId,
      direction: 'enviado',
      phone: filled.phone,
      message: filled.message,
      triggered_automatically: true,
      zapi_message_id: result?.key?.id,
      status: 'enviado',
    })
    await supabase.from('activities').insert({
      contract_id: contractId,
      type: 'whatsapp',
      content: `WhatsApp automático enviado pra ${filled.phone}.`,
      metadata: { kind: 'sent', phone: filled.phone, message: filled.message },
    })
  } catch (e) {
    await supabase.from('contract_whatsapp_messages').insert({
      contract_id: contractId,
      direction: 'enviado',
      phone: filled.phone,
      message: filled.message,
      triggered_automatically: true,
      status: 'falhou',
      error_message: e instanceof Error ? e.message : 'Falha desconhecida.',
    })
  }
}

// ------------------------------------------------------------
// CENTRAL DE ATENDIMENTO GLOBAL - ESPELHO EXATO DA OPORTUNIDADE
// ------------------------------------------------------------
export type UnlinkedConversation = {
  phone: string
  senderName: string | null
  senderPhoto: string | null
  lastMessage: string
  lastMediaType: string | null
  lastMessageAt: string
}

export async function getUnlinkedWhatsAppConversations(): Promise<UnlinkedConversation[]> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('contract_whatsapp_messages')
    .select('phone, unlinked_sender_name, sender_photo_url, message, media_type, created_at, instance_name')
    .order('created_at', { ascending: false })
    .limit(500)

  const byPhone = new Map<string, UnlinkedConversation>()
  for (const m of data ?? []) {
    if (!m.phone) continue
    const cleanPhone = m.phone.replace(/\D/g, '')
    const keyPhone = cleanPhone.length >= 10 ? cleanPhone.slice(-10) : cleanPhone

    if (byPhone.has(keyPhone)) continue

    byPhone.set(keyPhone, {
      phone: m.phone,
      senderName: m.unlinked_sender_name,
      senderPhoto: m.sender_photo_url,
      lastMessage: m.message,
      lastMediaType: m.media_type,
      lastMessageAt: m.created_at,
    })
  }
  return Array.from(byPhone.values())
}

export async function getUnlinkedMessagesByPhone(phone: string) {
  const supabase = createAdminClient()
  const cleanPhone = phone.replace(/\D/g, '')
  const last8 = cleanPhone.slice(-8)
  const { data } = await supabase
    .from('contract_whatsapp_messages')
    .select('id, phone, message, direction, status, triggered_automatically, error_message, created_at, media_url, media_type, media_filename, sender_photo_url, delivery_status')
    .ilike('phone', `%${last8}`)
    .order('created_at', { ascending: false })
  return data ?? []
}

export async function getConversationByPhone(phone: string): Promise<{
  messages: Awaited<ReturnType<typeof getUnlinkedMessagesByPhone>>
  leadId: string | null
  displayName: string | null
  manualName: string | null
}> {
  const supabase = createAdminClient()
  const cleanPhone = phone.replace(/\D/g, '')
  const last10 = cleanPhone.slice(-10)

  const { data } = await supabase
    .from('contract_whatsapp_messages')
    .select('id, phone, message, direction, status, triggered_automatically, error_message, created_at, media_url, media_type, media_filename, sender_photo_url, delivery_status, lead_id, unlinked_sender_name, instance_name, zapi_message_id')
    .ilike('phone', `%${last10}`)
    .order('created_at', { ascending: true })
    .limit(500)

  const leadId = data?.find((m) => m.lead_id)?.lead_id ?? null

  const { data: orgData } = await supabase
    .from('organization_settings')
    .select('evo_instance_aliases, evo_instance_name, whatsapp_contact_names')
    .eq('id', 'default')
    .maybeSingle()

  const aliases = (orgData as any)?.evo_instance_aliases ?? {}
  const instanceLabels = new Set<string>([
    (orgData as any)?.evo_instance_name,
    ...Object.values(aliases).map((v: any) => typeof v === 'string' ? v : v?.label),
  ].filter(Boolean).map((s: string) => s.toLowerCase()))

  const contactNames = (orgData as any)?.whatsapp_contact_names ?? {}
  const manualName = contactNames[cleanPhone]
    ?? contactNames[last10]
    ?? contactNames[`55${last10}`]
    ?? null

  if (manualName) return { messages: data ?? [], leadId, displayName: manualName, manualName }

  function isInstanceName(name: string | null): boolean {
    if (!name) return false
    return instanceLabels.has(name.toLowerCase())
  }

  let displayName = data
    ?.find((m) => (m as any).direction === 'recebido' && m.unlinked_sender_name && !isInstanceName(m.unlinked_sender_name))
    ?.unlinked_sender_name ?? null

  if (!displayName) {
    const candidate = data?.find((m) => m.unlinked_sender_name)?.unlinked_sender_name ?? null
    if (!isInstanceName(candidate)) displayName = candidate
  }

  if (leadId && !displayName) {
    const { data: lead } = await supabase.from('leads').select('name').eq('id', leadId).maybeSingle()
    displayName = lead?.name ?? null
  }

  return { messages: data ?? [], leadId, displayName, manualName: null }
}

export async function linkUnlinkedWhatsAppConversation(phone: string, contractId: string): Promise<ActionState> {
  const supabase = await createClient()

  const cleanPhone = phone.replace(/\D/g, '')
  const last10 = cleanPhone.slice(-10)

  const { data, error } = await supabase
    .from('contract_whatsapp_messages')
    .update({ contract_id: contractId, unlinked_sender_name: null })
    .ilike('phone', `%${last10}`)
    .is('contract_id', null)
    .select('id')

  if (error) return { error: error.message }
  if (!data || data.length === 0) return { error: 'Nenhuma mensagem atualizada. O vínculo pode já ter sido feito.' }

  await supabase.from('activities').insert({
    contract_id: contractId,
    type: 'system',
    content: `Conversa de WhatsApp vinculada a esta conta.`,
  })

  revalidatePath('/whatsapp')
  revalidatePath(`/contracts/${contractId}`)
  return {}
}

export async function saveWhatsAppConversationAsNote(contractId: string, noteText: string): Promise<ActionState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Usuário não autenticado.' }

  const { error } = await supabase.from('activities').insert({
    contract_id: contractId,
    user_id: user.id,
    type: 'note',
    content: noteText,
  })
  if (error) return { error: error.message }

  revalidatePath(`/contracts/${contractId}`)
  return {}
}

export async function resolveContactNameByPhone(phone: string): Promise<string | null> {
  const supabase = createAdminClient()
  const cleanPhone = phone.replace(/\D/g, '')
  const last8 = cleanPhone.slice(-8)
  const { data } = await supabase.from('contacts').select('name').ilike('phone', `%${last8}%`).limit(1).maybeSingle()
  return data?.name ?? null
}

export async function searchContractsForLinking(query: string): Promise<{ id: string; label: string }[]> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('contracts')
    .select('id, title, client_name')
    .ilike('client_name', `%${query}%`)
    .limit(8)

  return (data ?? []).map((c) => ({ id: c.id, label: c.client_name || c.title }))
}

export async function sendUnlinkedWhatsAppMessage(phone: string, message: string, instanceName?: string): Promise<ActionState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Usuário não autenticado.' }
  if (!message.trim()) return { error: 'Escreva a mensagem.' }

  const creds = await getEvoCredentials()
  if (!creds) return { error: 'WhatsApp ainda não está conectado.' }

  const { data: profile } = await supabase.from('profiles').select('full_name, job_title').eq('id', user.id).maybeSingle()
  const senderName = profile?.full_name ?? null
  const jobTitle = (profile as any)?.job_title ?? null
  const signature = senderName
    ? (jobTitle ? `*${senderName} - ${jobTitle}:*` : `*${senderName}:*`)
    : null
  const signedMessage = signature ? `${signature} ${message}` : message

  // 1. Higienização do telefone
  const rawPhone = phone.replace(/\D/g, '')
  const normalizedPhone = rawPhone.length <= 11 ? `55${rawPhone}` : rawPhone
  const last8 = normalizedPhone.slice(-8)

  const targetCreds = instanceName ? { ...creds, instanceName } : creds
  const admin = createAdminClient()
  const tenantId = await getTenantId(admin)

  // 2. Busca de vínculo infalível
  let contractId: string | null = null
  const { data: linkData } = await admin.from('contract_whatsapp_messages')
    .select('contract_id').ilike('phone', `%${last8}`)
    .not('contract_id', 'is', null)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()

  if (linkData?.contract_id) {
    contractId = linkData.contract_id
  } else {
    const { data: contact } = await admin.from('contacts')
      .select('id, contract_contacts(contract_id)')
      .ilike('phone', `%${last8}%`).limit(1).maybeSingle()
    if ((contact?.contract_contacts as any)?.[0]?.contract_id) {
      contractId = (contact!.contract_contacts as any)[0].contract_id
    }
  }

  // 3. Envio e insert com normalizedPhone
  let insertedMsg: any = null
  try {
    const result: any = await sendEvoTextMessage({ ...targetCreds, phone: normalizedPhone, message: signedMessage })
    await unarchiveWhatsAppConversation(normalizedPhone, targetCreds.instanceName)
    const { data: inserted } = await admin.from('contract_whatsapp_messages').insert({
      contract_id: contractId,
      sent_by: user.id,
      direction: 'enviado',
      phone: normalizedPhone,
      message: signedMessage,
      status: 'enviado',
      instance_name: targetCreds.instanceName,
      zapi_message_id: result?.key?.id ?? null,
      tenant_id: tenantId,
    })
    .select('id, phone, message, direction, status, triggered_automatically, error_message, created_at, media_url, media_type, media_filename, sender_photo_url, delivery_status, sent_by, lead_id, zapi_message_id')
    .single()
    insertedMsg = inserted
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : 'Falha ao enviar.'
    await admin.from('contract_whatsapp_messages').insert({
      contract_id: contractId,
      sent_by: user.id,
      direction: 'enviado',
      phone: normalizedPhone,
      message: signedMessage,
      status: 'falhou',
      error_message: errorMsg,
      instance_name: targetCreds.instanceName,
      tenant_id: tenantId,
    })
    return { error: errorMsg }
  }

  revalidatePath('/whatsapp')
  if (contractId) revalidatePath(`/contracts/${contractId}`)
  return { message: insertedMsg ?? undefined }
}

export async function sendUnlinkedWhatsAppMedia(
  phone: string,
  mediaUrl: string,
  mediaType: 'image' | 'document' | 'video' | 'audio',
  filename: string | null,
  instanceName?: string
): Promise<ActionState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Usuário não autenticado.' }
  if (!phone) return { error: 'Informe o telefone do destinatário.' }

  const creds = await getEvoCredentials()
  if (!creds) return { error: 'WhatsApp ainda não está conectado.' }

  // 1. Higienização do telefone
  const rawPhone = phone.replace(/\D/g, '')
  const normalizedPhone = rawPhone.length <= 11 ? `55${rawPhone}` : rawPhone
  const last8 = normalizedPhone.slice(-8)

  const targetCreds = instanceName ? { ...creds, instanceName } : creds
  const admin = createAdminClient()

  // 2. Busca de vínculo infalível
  let contractId: string | null = null
  const { data: linkData } = await admin.from('contract_whatsapp_messages')
    .select('contract_id').ilike('phone', `%${last8}`)
    .not('contract_id', 'is', null)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()

  if (linkData?.contract_id) {
    contractId = linkData.contract_id
  } else {
    const { data: contact } = await admin.from('contacts')
      .select('id, contract_contacts(contract_id)')
      .ilike('phone', `%${last8}%`).limit(1).maybeSingle()
    if ((contact?.contract_contacts as any)?.[0]?.contract_id) {
      contractId = (contact!.contract_contacts as any)[0].contract_id
    }
  }

  // 3. Envio com normalizedPhone
  try {
    await unarchiveWhatsAppConversation(normalizedPhone, targetCreds.instanceName)

    const isImage = mediaType === 'image'
    const result: any = isImage
      ? await sendEvoImageMessage({ ...targetCreds, phone: normalizedPhone, imageUrl: mediaUrl })
      : await sendEvoDocumentMessage({ ...targetCreds, phone: normalizedPhone, documentUrl: mediaUrl, fileName: filename ?? 'arquivo' })

    await admin.from('contract_whatsapp_messages').insert({
      contract_id: contractId,
      sent_by: user.id,
      direction: 'enviado',
      phone: normalizedPhone,
      message: isImage ? '[imagem]' : `[${mediaType}] ${filename ?? ''}`,
      media_url: mediaUrl,
      media_type: mediaType,
      media_filename: filename,
      zapi_message_id: result?.key?.id,
      status: 'enviado',
      instance_name: targetCreds.instanceName,
    })
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : 'Falha ao enviar arquivo.'
    await admin.from('contract_whatsapp_messages').insert({
      contract_id: contractId,
      sent_by: user.id,
      direction: 'enviado',
      phone: normalizedPhone,
      message: mediaType === 'image' ? '[imagem]' : `[${mediaType}] ${filename ?? ''}`,
      media_url: mediaUrl,
      media_type: mediaType,
      media_filename: filename,
      status: 'falhou',
      error_message: errorMsg,
      instance_name: targetCreds.instanceName,
    })
    return { error: errorMsg }
  }

  revalidatePath('/whatsapp')
  if (contractId) revalidatePath(`/contracts/${contractId}`)
  return {}
}

export async function checkAndSendWhatsAppCaptureReminders(): Promise<{ checked: number; sent: number }> {
  const supabase = createAdminClient()

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const { data: pending } = await supabase
    .from('whatsapp_capture_prompts')
    .select('phone')
    .is('lead_id', null)
    .is('reminder_sent_at', null)
    .lt('sent_at', oneDayAgo)

  if (!pending || pending.length === 0) return { checked: 0, sent: 0 }

  const creds = await getEvoCredentials()
  if (!creds) return { checked: pending.length, sent: 0 }

  const supabaseAdmin = supabase
  const { data: settings } = await supabaseAdmin.from('organization_settings').select('company_name, whatsapp_is_online, whatsapp_welcome_message, whatsapp_welcome_message_online, whatsapp_reminder_message').eq('id', 'default').maybeSingle()

  let sent = 0
  for (const p of pending) {
    const guard = await canSendAutomatedWhatsApp(p.phone)
    if (!guard.ok) continue

    const captureUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://crm-gestaocontratos-pi.vercel.app'}/captura?phone=${encodeURIComponent(p.phone)}`
    const { buildReminderMessage } = await import('@/lib/whatsapp/guardrails')
    const reminderMessage = buildReminderMessage(settings ?? { company_name: null, whatsapp_is_online: false, whatsapp_welcome_message: null, whatsapp_welcome_message_online: null, whatsapp_reminder_message: null }, captureUrl)
    try {
      const result: any = await sendEvoTextMessage({ ...creds, phone: p.phone, message: reminderMessage })
      await supabase.from('contract_whatsapp_messages').insert({
        contract_id: null,
        direction: 'enviado',
        phone: p.phone,
        message: reminderMessage,
        triggered_automatically: true,
        zapi_message_id: result?.key?.id,
        status: 'enviado',
      })
      await supabase.from('whatsapp_capture_prompts').update({ reminder_sent_at: new Date().toISOString() }).eq('phone', p.phone)
      sent++
    } catch (e) {
      console.error(`Falha ao mandar lembrete de captação pra ${p.phone}:`, e)
    }
  }

  return { checked: pending.length, sent }
}

export async function getWhatsAppMessagesByLead(leadId: string) {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('contract_whatsapp_messages')
    .select('id, phone, message, direction, status, triggered_automatically, error_message, created_at, media_url, media_type, media_filename, sender_photo_url, delivery_status')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
  return data ?? []
}

export type ConversationAssignment = { assigned_to: string; assigned_to_name: string; assigned_at: string }

export async function getWhatsAppAssignments(phones: string[]): Promise<Record<string, ConversationAssignment>> {
  if (phones.length === 0) return {}
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('whatsapp_conversation_assignments')
    .select('phone, assigned_to, assigned_at, profiles(full_name)')
    .in('phone', phones)

  const result: Record<string, ConversationAssignment> = {}
  for (const row of data ?? []) {
    result[row.phone] = { assigned_to: row.assigned_to, assigned_to_name: (row as any).profiles?.full_name ?? 'Alguém', assigned_at: row.assigned_at }
  }
  return result
}

// ── PONTO 2: assignWhatsAppConversation agora atualiza department pelo alias da instância ──
export async function assignWhatsAppConversation(phone: string, userId: string): Promise<ActionState> {
  const supabase = await createClient()
  const { error } = await supabase.from('whatsapp_conversation_assignments').upsert({ phone, assigned_to: userId, assigned_at: new Date().toISOString() })
  if (error) return { error: error.message }

  try {
    const admin = createAdminClient()
    const tenantId = await getTenantId(admin)
    const [{ data: profile }, { data: org }] = await Promise.all([
      admin.from('profiles').select('full_name').eq('id', userId).maybeSingle(),
      (() => { const q = admin.from('organization_settings').select('evo_server_url, evo_api_key, evo_instance_name, evo_instance_aliases, tenant_id').eq('id', 'default'); return tenantId ? (q as any).eq('tenant_id', tenantId).maybeSingle() : (q as any).maybeSingle() })(),
    ])
    const nome = (profile as any)?.full_name ?? 'nossa equipe'
    const transferText = `*Transferência de atendimento:* Aguarde um momento, vou transferir você para o(a) *${nome}*... 🙏`

    if (org?.evo_server_url && org?.evo_api_key) {
      const { data: lastMsg } = await admin.from('contract_whatsapp_messages')
        .select('instance_name, contract_id, lead_id').eq('phone', phone).order('created_at', { ascending: false }).limit(1).maybeSingle()
      const instance = (lastMsg as any)?.instance_name ?? org.evo_instance_name
      const contractId = (lastMsg as any)?.contract_id ?? null
      const leadId = (lastMsg as any)?.lead_id ?? null

      // Lê department do alias da instância e atualiza conversation_status
      const aliases = (org as any)?.evo_instance_aliases ?? {}
      const aliasInfo = instance ? aliases[instance] : null
      const instanceDepartment = typeof aliasInfo === 'object' ? (aliasInfo?.department ?? null) : null

      if (instanceDepartment) {
        const cleanPhone = String(phone).replace(/\D/g, '')
        const last8 = cleanPhone.slice(-8)
        const statusQ = admin
          .from('whatsapp_conversation_status')
          .select('phone, instance_name')
          .ilike('phone', `%${last8}`)
        const { data: statusRows } = instance
          ? await (statusQ as any).eq('instance_name', instance)
          : await statusQ
        if (statusRows && statusRows.length > 0) {
          for (const row of statusRows) {
            await admin
              .from('whatsapp_conversation_status')
              .update({ department: instanceDepartment, updated_at: new Date().toISOString() })
              .eq('phone', row.phone)
              .eq('instance_name', row.instance_name ?? '')
          }
        }
      }

      // Enviar mensagem de transferência para o cliente
      const evoRes = await fetch(`${org.evo_server_url}/message/sendText/${instance}`, {
        method: 'POST',
        headers: { 'apikey': org.evo_api_key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ number: phone, text: transferText }),
      })
      const evoData: any = await evoRes.json().catch(() => ({}))

      // Salvar mensagem de transferência no banco
      const { error: insertErr } = await admin.from('contract_whatsapp_messages').insert({
        contract_id: contractId,
        lead_id: leadId,
        phone,
        message: transferText,
        direction: 'enviado',
        status: 'enviado',
        triggered_automatically: true,
        instance_name: instance,
        zapi_message_id: evoData?.key?.id ?? null,
        tenant_id: tenantId,
      })
      if (insertErr) console.error('[assign] erro ao salvar msg transferência:', insertErr.message)
    }
  } catch (e) { console.warn('[assign] falha ao notificar transferência:', e) }

  revalidatePath('/whatsapp')
  return {}
}

export async function unassignWhatsAppConversation(phone: string): Promise<ActionState> {
  const supabase = await createClient()
  await supabase.from('whatsapp_conversation_assignments').delete().eq('phone', phone)
  revalidatePath('/whatsapp')
  return {}
}

export async function importExistingWhatsAppChats(): Promise<ActionState & { imported?: number; skipped?: number }> {
  if (!(await isCurrentUserAdmin())) return { error: 'Só administradores podem importar.' }

  const creds = await getEvoCredentials()
  if (!creds) return { error: 'WhatsApp ainda não está conectado.' }

  const supabase = createAdminClient()

  let chats: Array<{ phone: string; isGroup: boolean; name?: string }> = []
  try {
    const { data: msgs } = await supabase
      .from('contract_whatsapp_messages')
      .select('phone')
      .eq('direction', 'inbound')
      .not('phone', 'is', null)
    const uniquePhones = [...new Set((msgs ?? []).map((m: any) => m.phone))]
    chats = uniquePhones.map(phone => ({ phone, isGroup: false }))
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao buscar conversas do WhatsApp.' }
  }

  let imported = 0
  let skipped = 0

  for (const chat of chats) {
    if (chat.isGroup || !chat.phone) {
      skipped++
      continue
    }

    const cleanPhone = chat.phone.replace(/\D/g, '')
    const { count } = await supabase
      .from('contract_whatsapp_messages')
      .select('id', { count: 'exact', head: true })
      .ilike('phone', `%${cleanPhone.slice(-8)}%`)

    if ((count ?? 0) > 0) {
      skipped++
      continue
    }

    const { data: matchingContacts } = await supabase.from('contacts').select('id, company_id').ilike('phone', `%${cleanPhone.slice(-8)}%`)
    let contractId: string | null = null
    if (matchingContacts && matchingContacts.length > 0) {
      const { data: exactLink } = await supabase.from('contract_contacts').select('contract_id').in('contact_id', matchingContacts.map((c) => c.id)).limit(1).maybeSingle()
      contractId = exactLink?.contract_id ?? null
    }

    await supabase.from('contract_whatsapp_messages').insert({
      contract_id: contractId,
      unlinked_sender_name: contractId ? null : chat.name,
      direction: 'recebido',
      phone: chat.phone,
      message: '[Conversa importada do WhatsApp — histórico anterior à conexão com o CRM]',
      status: 'enviado',
      created_at: (chat as any).lastMessageTime ? new Date(Number((chat as any).lastMessageTime) * 1000).toISOString() : new Date().toISOString(),
    })
    imported++
  }

  revalidatePath('/whatsapp')
  return { imported, skipped }
}

export async function updateWhatsAppBotSettings(formData: FormData): Promise<ActionState> {
  if (!(await isCurrentUserAdmin())) return { error: 'Só administradores podem configurar isso.' }

  const whatsapp_is_online = formData.get('whatsapp_is_online') === 'on'
  const whatsapp_welcome_message = (formData.get('whatsapp_welcome_message') as string)?.trim() || null
  const whatsapp_welcome_message_online = (formData.get('whatsapp_welcome_message_online') as string)?.trim() || null
  const whatsapp_reminder_message = (formData.get('whatsapp_reminder_message') as string)?.trim() || null
  const whatsapp_daily_auto_limit = formData.get('whatsapp_daily_auto_limit') ? Number(formData.get('whatsapp_daily_auto_limit')) : 3

  const supabase = await createClient()
  const { error } = await supabase
    .from('organization_settings')
    .update({
      whatsapp_is_online,
      whatsapp_welcome_message,
      whatsapp_welcome_message_online,
      whatsapp_reminder_message,
      whatsapp_daily_auto_limit,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 'default')

  if (error) return { error: error.message }
  revalidatePath('/settings')
  return {}
}

export async function toggleWhatsAppOnlineStatus(isOnline: boolean): Promise<ActionState> {
  if (!(await isCurrentUserAdmin())) return { error: 'Só administradores podem alterar isso.' }
  const supabase = await createClient()
  const { error } = await supabase.from('organization_settings').update({ whatsapp_is_online: isOnline }).eq('id', 'default')
  if (error) return { error: error.message }
  revalidatePath('/settings')
  revalidatePath('/whatsapp')
  return {}
}

export async function archiveWhatsAppConversation(phone: string, instanceName?: string | null, sendClosing = true): Promise<ActionState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const admin = createAdminClient()
  const tenantId = await getTenantId(admin)
  const inst = instanceName ?? ''
  const cleanPhone = String(phone).replace(/\D/g, '')
  const last8 = cleanPhone.slice(-8)

  // Buscar registro existente via last8 (cobre variações de DDI/DDD/9º dígito)
  let statusQuery = admin
    .from('whatsapp_conversation_status')
    .select('phone, instance_name')
    .ilike('phone', `%${last8}`)
  if (inst) {
    statusQuery = statusQuery.eq('instance_name', inst)
  } else {
    statusQuery = statusQuery.or('instance_name.is.null,instance_name.eq.""')
  }
  if (tenantId) {
    statusQuery = (statusQuery as any).eq('tenant_id', tenantId)
  }

  const { data: existing } = await statusQuery

  if (existing && existing.length > 0) {
    // Atualizar registro(s) encontrado(s)
    for (const row of existing) {
      let updateQ = admin
        .from('whatsapp_conversation_status')
        .update({ is_archived: true, archived_at: new Date().toISOString(), archived_by: user.id, updated_at: new Date().toISOString(), tenant_id: tenantId })
        .eq('phone', row.phone)
      if (row.instance_name) {
        updateQ = updateQ.eq('instance_name', row.instance_name)
      } else {
        updateQ = updateQ.or('instance_name.is.null,instance_name.eq.""')
      }
      if (tenantId) updateQ = (updateQ as any).eq('tenant_id', tenantId)
      await updateQ
    }
  } else {
    // Inserir novo registro de status arquivado
    await admin.from('whatsapp_conversation_status').insert({
      phone: cleanPhone, instance_name: inst || null,
      is_archived: true, archived_at: new Date().toISOString(), archived_by: user.id,
      tenant_id: tenantId,
    })
  }

  const creds = sendClosing ? await getEvoCredentials() : null
  if (creds) {
    const targetCreds = instanceName ? { ...creds, instanceName } : creds
    try {
      const orgQ = admin.from('organization_settings').select('evo_instance_aliases').eq('id', 'default')
      const { data: org } = tenantId
        ? await (orgQ as any).eq('tenant_id', tenantId).maybeSingle()
        : await (orgQ as any).maybeSingle()
      const aliases = (org as any)?.evo_instance_aliases ?? {}
      const instanceAlias = instanceName ? aliases[instanceName] : null
      const closingMsg = (typeof instanceAlias === 'object' ? instanceAlias?.closingMessage : null)
        ?? '*Atendimento finalizado.* Se precisar de mais alguma coisa, basta enviar uma nova mensagem por aqui! 🙏'

      // Buscar contract_id e lead_id para a mensagem de encerramento
      const { data: lastMsg } = await admin.from('contract_whatsapp_messages')
        .select('contract_id, lead_id').eq('phone', phone)
        .order('created_at', { ascending: false }).limit(1).maybeSingle()

      // Enviar via Evolution
      const evoRes = await sendEvoTextMessage({ ...targetCreds, phone, message: closingMsg })
      const evoData: any = evoRes

      // Salvar mensagem de encerramento no banco (com tenant_id para aparecer na UI)
      const { error: insertErr } = await admin.from('contract_whatsapp_messages').insert({
        contract_id: (lastMsg as any)?.contract_id ?? null,
        lead_id: (lastMsg as any)?.lead_id ?? null,
        phone,
        message: closingMsg,
        direction: 'enviado',
        status: 'enviado',
        triggered_automatically: true,
        instance_name: targetCreds.instanceName,
        zapi_message_id: (evoData as any)?.key?.id ?? null,
        tenant_id: tenantId,
      })
      if (insertErr) console.error('[archive] erro ao salvar msg encerramento:', insertErr.message)
    } catch (e) { console.warn('[archive] falha ao enviar msg encerramento:', e) }
  }

  revalidatePath('/whatsapp')
  return {}
}

export async function unarchiveWhatsAppConversation(phone: string, instanceName?: string | null, tenantId?: string | null): Promise<void> {
  const admin = createAdminClient()
  const inst = instanceName ?? ''

  let updateQ = admin
    .from('whatsapp_conversation_status')
    .update({ is_archived: false, archived_at: null, archived_by: null, updated_at: new Date().toISOString() })
    .eq('phone', phone)
    .eq('instance_name', inst)
  if (tenantId) updateQ = (updateQ as any).eq('tenant_id', tenantId)

  const { error } = await updateQ

  if (error) {
    await admin.from('whatsapp_conversation_status').insert({
      phone, instance_name: inst, is_archived: false,
      ...(tenantId ? { tenant_id: tenantId } : {}),
    })
  }
}

export async function saveUnlinkedContactName(phone: string, name: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const admin = createAdminClient()
  const cleanPhone = phone.replace(/\D/g, '')
  const last10 = cleanPhone.slice(-10)
  const trimmed = name.trim() || null

  const { data: org } = await admin
    .from('organization_settings')
    .select('whatsapp_contact_names')
    .eq('id', 'default')
    .maybeSingle()

  const existing = (org as any)?.whatsapp_contact_names ?? {}
  existing[cleanPhone] = trimmed
  existing[last10] = trimmed
  if (!cleanPhone.startsWith('55') && cleanPhone.length >= 10) {
    existing[`55${cleanPhone}`] = trimmed
  }

  await admin.from('organization_settings')
    .update({ whatsapp_contact_names: existing })
    .eq('id', 'default')

  revalidatePath('/whatsapp')
  return {}
}

export async function deleteWhatsAppMessage(
  messageId: string,
  phone: string,
  zApiMessageId?: string | null
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const admin = createAdminClient()

  await admin.from('contract_whatsapp_messages').delete().eq('id', messageId)

  if (zApiMessageId) {
    try {
      const { data: org } = await admin
        .from('organization_settings')
        .select('evo_server_url, evo_api_key, evo_instance_name')
        .eq('id', 'default').maybeSingle()

      if (org?.evo_server_url) {
        const cleanPhone = phone.replace(/\D/g, '')
        const res = await fetch(`${org.evo_server_url}/chat/deleteMessage/${org.evo_instance_name}`, {
          method: 'DELETE',
          headers: { apikey: org.evo_api_key, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            remoteJid: `${cleanPhone}@s.whatsapp.net`,
            messageId: zApiMessageId,
            id: zApiMessageId,
            fromMe: true,
          }),
        })
        const resText = await res.text().catch(() => '')
        console.log('[deleteMessage] Evolution status:', res.status, resText.slice(0, 100))
      }
    } catch (e) { console.warn('[deleteMessage] Evolution API:', e) }
  }

  revalidatePath('/whatsapp')
  return {}
}

export async function deleteWhatsAppConversation(phone: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const admin = createAdminClient()
  const cleanPhone = phone.replace(/\D/g, '')
  const last10 = cleanPhone.slice(-10)

  await Promise.all([
    admin.from('contract_whatsapp_messages').delete().ilike('phone', `%${last10}`),
    admin.from('whatsapp_conversation_status').delete().ilike('phone', `%${last10}`),
  ])

  revalidatePath('/whatsapp')
  return {}
}

export async function toggleTriagemEnabled(enabled: boolean): Promise<ActionState> {
  if (!(await isCurrentUserAdmin())) return { error: 'Só administradores podem alterar isso.' }
  const supabase = await createClient()
  const { error } = await supabase
    .from('organization_settings')
    .update({ triage_enabled: enabled })
    .eq('id', 'default')

  if (error) return { error: error.message }
  revalidatePath('/settings/whatsapp-bot')
  return {}
}

export async function saveTriagemMenuOptions(options: any[]): Promise<ActionState> {
  if (!(await isCurrentUserAdmin())) return { error: 'Só administradores podem alterar isso.' }
  const supabase = await createClient()
  const { error } = await supabase
    .from('organization_settings')
    .update({ triage_menu_options: options })
    .eq('id', 'default')

  if (error) return { error: error.message }
  revalidatePath('/settings/whatsapp-bot')
  return {}
}

// ── PONTO 4: finishConversationWithNPS corrigido ──────────────────────────────
// - Usa createAdminClient() em vez de createClient()
// - Usa chave composta (phone + instance_name) para o update
// - Envia NPS pela instância correta (a última que recebeu mensagem)
// - Ao enviar NPS: marca is_archived: true + nps_pending: true simultaneamente
// - Ao não enviar NPS: apenas arquiva (igual ao botão "Arquivar")
export async function finishConversationWithNPS(phone: string, instanceName: string | null | undefined, sendNPS: boolean): Promise<ActionState> {
  const admin = createAdminClient()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const tenantId = await getTenantId(admin)
  const cleanPhone = String(phone).replace(/\D/g, '')
  const last8 = cleanPhone.slice(-8)
  const inst = instanceName ?? ''

  // Busca o registro de status usando last8 + instance_name
  const statusQ = admin
    .from('whatsapp_conversation_status')
    .select('phone, instance_name')
    .ilike('phone', `%${last8}`)
  const { data: statusRows } = inst
    ? await (statusQ as any).eq('instance_name', inst)
    : await statusQ

  if (sendNPS) {
    // Buscar credenciais e instância correta
    const { data: org } = await admin
      .from('organization_settings')
      .select('evo_server_url, evo_api_key, evo_instance_name, evo_instance_aliases')
      .eq('id', 'default')
      .maybeSingle()

    // Descobrir a instância usada na última mensagem
    const { data: lastMsg } = await admin
      .from('contract_whatsapp_messages')
      .select('instance_name')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const targetInstance = inst || (lastMsg as any)?.instance_name || org?.evo_instance_name

    // Marcar como arquivada + nps_pending em todos os registros encontrados
    if (statusRows && statusRows.length > 0) {
      for (const row of statusRows) {
        await admin
          .from('whatsapp_conversation_status')
          .update({
            nps_pending: true,
            is_archived: true,
            archived_at: new Date().toISOString(),
            archived_by: user.id,
            updated_at: new Date().toISOString(),
          })
          .eq('phone', row.phone)
          .eq('instance_name', row.instance_name ?? '')
      }
    } else {
      // Upsert caso não exista registro
      await admin.from('whatsapp_conversation_status').upsert(
        {
          phone: cleanPhone,
          instance_name: inst || null,
          tenant_id: tenantId,
          nps_pending: true,
          is_archived: true,
          archived_at: new Date().toISOString(),
          archived_by: user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'phone,instance_name' }
      )
    }

    // Enviar pesquisa NPS via Evolution API
    if (org?.evo_server_url && org?.evo_api_key && targetInstance) {
      const npsMsg = `Seu atendimento foi concluído! 🌟\n\nPor favor, avalie o nosso atendimento enviando uma nota de *1 a 5*:\n\n1️⃣ - Péssimo\n2️⃣ - Ruim\n3️⃣ - Regular\n4️⃣ - Bom\n5️⃣ - Excelente`
      try {
        const evoRes = await fetch(`${org.evo_server_url}/message/sendText/${targetInstance}`, {
          method: 'POST',
          headers: { 'apikey': org.evo_api_key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ number: cleanPhone, text: npsMsg }),
        })
        const evoData: any = await evoRes.json().catch(() => ({}))
        // Registra a mensagem NPS no banco para aparecer no chat
        await admin.from('contract_whatsapp_messages').insert({
          phone: cleanPhone,
          message: npsMsg,
          direction: 'enviado',
          status: 'enviado',
          triggered_automatically: true,
          instance_name: targetInstance,
          zapi_message_id: evoData?.key?.id ?? null,
          tenant_id: tenantId,
        })
      } catch (e) {
        console.error('[NPS] erro ao enviar mensagem NPS:', e)
      }
    }
  } else {
    // Sem NPS — arquiva diretamente
    if (statusRows && statusRows.length > 0) {
      for (const row of statusRows) {
        await admin
          .from('whatsapp_conversation_status')
          .update({
            is_archived: true,
            archived_at: new Date().toISOString(),
            archived_by: user.id,
            updated_at: new Date().toISOString(),
          })
          .eq('phone', row.phone)
          .eq('instance_name', row.instance_name ?? '')
      }
    } else {
      await admin.from('whatsapp_conversation_status').upsert(
        {
          phone: cleanPhone,
          instance_name: inst || null,
          tenant_id: tenantId,
          is_archived: true,
          archived_at: new Date().toISOString(),
          archived_by: user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'phone,instance_name' }
      )
    }
  }

  revalidatePath('/whatsapp')
  return {}
}
