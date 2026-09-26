'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export type ActionState = {
  error?: string
  success?: boolean
  message?: any
}

async function isCurrentUserAdmin(): Promise<boolean> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()
  return profile?.role === 'admin'
}

export async function updateWhatsAppBotSettings(formData: FormData): Promise<ActionState> {
  if (!(await isCurrentUserAdmin())) return { error: 'Só administradores podem alterar as configurações do bot.' }

  const welcomeMsg = (formData.get('whatsapp_welcome_message') as string)?.trim() ?? ''
  const welcomeMsgOnline = (formData.get('whatsapp_welcome_message_online') as string)?.trim() ?? ''
  const reminderMsg = (formData.get('whatsapp_reminder_message') as string)?.trim() ?? ''
  const companyName = (formData.get('company_name') as string)?.trim() ?? ''
  const dailyLimitRaw = formData.get('whatsapp_daily_auto_limit') as string
  const dailyLimit = dailyLimitRaw ? parseInt(dailyLimitRaw, 10) : 5

  const supabase = await createClient()
  const { error } = await supabase
    .from('organization_settings')
    .update({
      whatsapp_welcome_message: welcomeMsg,
      whatsapp_welcome_message_online: welcomeMsgOnline,
      whatsapp_reminder_message: reminderMsg,
      company_name: companyName,
      whatsapp_daily_auto_limit: isNaN(dailyLimit) ? 5 : dailyLimit,
    })
    .eq('id', 'default')

  if (error) return { error: error.message }
  revalidatePath('/settings/whatsapp-bot')
  return { success: true }
}

export async function toggleWhatsAppOnlineStatus(newStatus: boolean): Promise<ActionState> {
  if (!(await isCurrentUserAdmin())) return { error: 'Só administradores podem alterar isso.' }
  const supabase = await createClient()
  const { error } = await supabase
    .from('organization_settings')
    .update({ whatsapp_is_online: newStatus })
    .eq('id', 'default')

  if (error) return { error: error.message }
  revalidatePath('/settings/whatsapp-bot')
  revalidatePath('/whatsapp')
  return { success: true }
}

export async function toggleTriagemEnabled(newStatus: boolean): Promise<ActionState> {
  if (!(await isCurrentUserAdmin())) return { error: 'Só administradores podem alterar isso.' }
  const supabase = await createClient()
  const { error } = await supabase
    .from('organization_settings')
    .update({ triage_enabled: newStatus })
    .eq('id', 'default')

  if (error) return { error: error.message }
  revalidatePath('/settings/whatsapp-bot')
  revalidatePath('/whatsapp')
  return { success: true }
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
  return { success: true }
}

export async function sendUnlinkedWhatsAppMessage(
  phone: string,
  text: string,
  instanceName?: string
): Promise<ActionState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado' }

  const admin = createAdminClient()
  const { data: orgSettings } = await admin
    .from('organization_settings')
    .select('evo_server_url, evo_api_key, evo_instance_name, tenant_id')
    .eq('id', 'default')
    .maybeSingle()

  if (!orgSettings?.evo_server_url || !orgSettings?.evo_api_key) {
    return { error: 'Servidor do WhatsApp não configurado' }
  }

  const inst = instanceName || orgSettings.evo_instance_name
  if (!inst) return { error: 'Instância não informada' }

  try {
    const res = await fetch(`${orgSettings.evo_server_url}/message/sendText/${inst}`, {
      method: 'POST',
      headers: { 'apikey': orgSettings.evo_api_key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: phone, text }),
    })

    const resData = await res.json()
    if (!res.ok) return { error: resData?.response?.message?.[0] || 'Erro ao enviar mensagem' }

    const messageId = resData?.key?.id ?? null

    const { data: inserted, error: insertErr } = await admin
      .from('contract_whatsapp_messages')
      .insert({
        phone,
        message: text,
        direction: 'enviado',
        status: 'enviado',
        triggered_automatically: false,
        zapi_message_id: messageId,
        instance_name: inst,
        tenant_id: orgSettings.tenant_id,
        created_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (insertErr) console.error('[sendUnlinkedWhatsAppMessage] Erro ao gravar mensagem:', insertErr)

    revalidatePath('/whatsapp')
    return { success: true, message: inserted }
  } catch (e: any) {
    return { error: e.message || 'Erro de conexão' }
  }
}

export async function sendUnlinkedWhatsAppMedia(
  phone: string,
  mediaUrl: string,
  mediaType: 'image' | 'video' | 'document' | 'audio',
  fileName?: string,
  instanceName?: string
): Promise<ActionState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado' }

  const admin = createAdminClient()
  const { data: orgSettings } = await admin
    .from('organization_settings')
    .select('evo_server_url, evo_api_key, evo_instance_name, tenant_id')
    .eq('id', 'default')
    .maybeSingle()

  if (!orgSettings?.evo_server_url || !orgSettings?.evo_api_key) {
    return { error: 'Servidor do WhatsApp não configurado' }
  }

  const inst = instanceName || orgSettings.evo_instance_name
  if (!inst) return { error: 'Instância não informada' }

  try {
    const endpoint = mediaType === 'audio' ? 'sendWhatsAppAudio' : 'sendMedia'
    const body: any = {
      number: phone,
      media: mediaUrl,
      mediatype: mediaType,
      fileName: fileName || 'arquivo',
    }

    const res = await fetch(`${orgSettings.evo_server_url}/message/${endpoint}/${inst}`, {
      method: 'POST',
      headers: { 'apikey': orgSettings.evo_api_key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    const resData = await res.json()
    if (!res.ok) return { error: resData?.response?.message?.[0] || 'Erro ao enviar mídia' }

    const messageId = resData?.key?.id ?? null

    const { data: inserted } = await admin
      .from('contract_whatsapp_messages')
      .insert({
        phone,
        message: fileName ? `[Arquivo: ${fileName}]` : `[${mediaType}]`,
        direction: 'enviado',
        status: 'enviado',
        triggered_automatically: false,
        zapi_message_id: messageId,
        instance_name: inst,
        tenant_id: orgSettings.tenant_id,
        media_url: mediaUrl,
        media_type: mediaType,
        media_filename: fileName,
        created_at: new Date().toISOString(),
      })
      .select()
      .single()

    revalidatePath('/whatsapp')
    return { success: true, message: inserted }
  } catch (e: any) {
    return { error: e.message || 'Erro ao enviar mídia' }
  }
}

export async function assignWhatsAppConversation(
  phone: string,
  userId: string,
  instanceName?: string
): Promise<ActionState> {
  const supabase = await createClient()
  const admin = createAdminClient()

  // 1. Atualiza quem assumiu no cadastro de conversas ativas
  const { error } = await supabase
    .from('whatsapp_conversation_assignments')
    .upsert({ phone, assigned_to: userId, updated_at: new Date().toISOString() }, { onConflict: 'phone' })

  if (error) return { error: error.message }

  // 2. Tenta atualizar o departamento na tabela de triagem com base nos aliases da instância
  if (instanceName) {
    const { data: orgSettings } = await admin
      .from('organization_settings')
      .select('evo_instance_aliases')
      .eq('id', 'default')
      .maybeSingle()

    const aliases = orgSettings?.evo_instance_aliases as Record<string, any> | null
    const instanceConfig = aliases?.[instanceName]
    const dept = typeof instanceConfig === 'object' ? instanceConfig?.department : null

    if (dept) {
      await admin
        .from('whatsapp_conversation_status')
        .update({ department: dept, updated_at: new Date().toISOString() })
        .eq('phone', phone)
    }
  }

  revalidatePath('/whatsapp')
  return { success: true }
}

export async function unassignWhatsAppConversation(phone: string): Promise<ActionState> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('whatsapp_conversation_assignments')
    .delete()
    .eq('phone', phone)

  if (error) return { error: error.message }
  revalidatePath('/whatsapp')
  return { success: true }
}

export async function archiveWhatsAppConversation(
  phone: string,
  instanceName?: string | null,
  sendMessage: boolean = false
): Promise<ActionState> {
  const admin = createAdminClient()

  const { error } = await admin
    .from('whatsapp_conversation_status')
    .update({
      is_archived: true,
      archived_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('phone', phone)

  if (error) return { error: error.message }

  if (sendMessage) {
    const { data: orgSettings } = await admin
      .from('organization_settings')
      .select('evo_server_url, evo_api_key, evo_instance_name')
      .eq('id', 'default')
      .maybeSingle()

    const inst = instanceName ?? orgSettings?.evo_instance_name
    if (orgSettings?.evo_server_url && orgSettings?.evo_api_key && inst) {
      const text = `*Atendimento finalizado.* Se precisar de mais alguma coisa, basta enviar uma nova mensagem por aqui! 🙏`
      try {
        await fetch(`${orgSettings.evo_server_url}/message/sendText/${inst}`, {
          method: 'POST',
          headers: { 'apikey': orgSettings.evo_api_key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ number: phone, text }),
        })
      } catch (e) {
        console.error('[archiveWhatsAppConversation] erro ao enviar mensagem:', e)
      }
    }
  }

  revalidatePath('/whatsapp')
  return { success: true }
}

export async function unarchiveWhatsAppConversation(
  phone: string,
  instanceName?: string
): Promise<ActionState> {
  const admin = createAdminClient()

  const { error } = await admin
    .from('whatsapp_conversation_status')
    .update({
      is_archived: false,
      archived_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('phone', phone)

  if (error) return { error: error.message }
  revalidatePath('/whatsapp')
  return { success: true }
}

export async function saveUnlinkedContactName(phone: string, name: string): Promise<ActionState> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('whatsapp_contact_names')
    .upsert({ phone, name, updated_at: new Date().toISOString() }, { onConflict: 'phone' })

  if (error) return { error: error.message }
  revalidatePath('/whatsapp')
  return { success: true }
}

export async function deleteWhatsAppConversation(phone: string): Promise<ActionState> {
  const admin = createAdminClient()

  await admin.from('contract_whatsapp_messages').delete().eq('phone', phone)
  await admin.from('whatsapp_conversation_status').delete().eq('phone', phone)
  await admin.from('whatsapp_conversation_assignments').delete().eq('phone', phone)

  revalidatePath('/whatsapp')
  return { success: true }
}

export async function linkUnlinkedWhatsAppConversation(
  phone: string,
  contractId: string
): Promise<ActionState> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('contract_whatsapp_messages')
    .update({ contract_id: contractId })
    .eq('phone', phone)

  if (error) return { error: error.message }
  revalidatePath('/whatsapp')
  return { success: true }
}

export async function finishConversationWithNPS(
  phone: string,
  instanceName: string | null | undefined,
  sendNPS: boolean
): Promise<ActionState> {
  const admin = createAdminClient()

  const { data: orgSettings } = await admin
    .from('organization_settings')
    .select('evo_server_url, evo_api_key, evo_instance_name')
    .eq('id', 'default')
    .maybeSingle()

  const inst = instanceName ?? orgSettings?.evo_instance_name

  if (sendNPS) {
    // 1. Marca a conversa para aguardar nota NPS (1 a 5)
    const { error } = await admin
      .from('whatsapp_conversation_status')
      .update({
        nps_pending: true,
        updated_at: new Date().toISOString(),
      })
      .eq('phone', phone)

    if (error) return { error: error.message }

    // 2. Dispara a mensagem com as opcoes no WhatsApp do cliente
    if (orgSettings?.evo_server_url && orgSettings?.evo_api_key && inst) {
      const npsMsg = `Seu atendimento foi concluído! 🌟\n\nPor favor, avalie o nosso atendimento enviando uma nota de *1 a 5*:\n\n1 - Péssimo\n2 - Ruim\n3 - Regular\n4 - Bom\n5 - Excelente`
      try {
        await fetch(`${orgSettings.evo_server_url}/message/sendText/${inst}`, {
          method: 'POST',
          headers: { 'apikey': orgSettings.evo_api_key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ number: phone, text: npsMsg }),
        })
      } catch (e) {
        console.error('[NPS] erro ao enviar mensagem NPS:', e)
      }
    }
  } else {
    // Arquiva diretamente se o usuario escolher finalizar sem NPS
    const { error } = await admin
      .from('whatsapp_conversation_status')
      .update({
        is_archived: true,
        archived_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('phone', phone)

    if (error) return { error: error.message }
  }

  revalidatePath('/whatsapp')
  return { success: true }
}
