'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { isCurrentUserAdmin } from '@/lib/auth/role'
import { headers } from 'next/headers'
import { createZapSignFromTemplate, createZapSignFromPdf, createZapSignWebhook } from '@/lib/zapsign/api'
import { syncZapSignDoc, getTenantZapSignToken, type ZapSignDocRow } from '@/lib/zapsign/sync'
import { resolveTenantId } from '@/lib/tenant/context'
import { fmtBRL } from '@/lib/format'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

export type ActionState = { error?: string }

async function buildContractData(contractId: string): Promise<Record<string, string>> {
  const supabase = (await createScopedAdmin())
  const { data: contract } = await supabase.from('contracts').select('*, companies(name, cnpj), contacts(name, email, phone)').eq('id', contractId).maybeSingle()
  if (!contract) return {}
  const { data: orgSettings } = await supabase.from('organization_settings').select('company_name, company_cnpj').eq('tenant_id', await resolveTenantId({ contractId })).maybeSingle()
  const { data: customFieldDefs } = await supabase.from('custom_fields').select('id, field_key')
  const { data: customFieldValues } = await supabase.from('contract_custom_field_values').select('custom_field_id, value').eq('contract_id', contractId)
  const valueByFieldId = new Map((customFieldValues ?? []).map((v) => [v.custom_field_id, v.value]))
  const customVars: Record<string, string> = {}
  for (const field of customFieldDefs ?? []) {
    customVars[field.field_key] = valueByFieldId.get(field.id) ?? ''
  }
  const company = (contract as any).companies
  const contact = (contract as any).contacts
  return {
    cliente: contact?.name ?? contract.client_name ?? '',
    empresa: company?.name ?? contract.client_name ?? '',
    cnpj: company?.cnpj ?? '',
    contato: contact?.name ?? '',
    email_contato: contact?.email ?? '',
    telefone_contato: contact?.phone ?? '',
    processo: contract.process_number ?? '',
    minha_empresa: orgSettings?.company_name ?? '',
    minha_cnpj: orgSettings?.company_cnpj ?? '',
    data_hoje: new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
    valor_mensal: contract.monthly_value !== null && contract.monthly_value !== undefined ? fmtBRL(Number(contract.monthly_value)) : '',
    inicio_vigencia: contract.valid_from ? String(contract.valid_from).slice(0, 10).split('-').reverse().join('/') : '',
    fim_vigencia: contract.valid_until ? String(contract.valid_until).slice(0, 10).split('-').reverse().join('/') : '',
    ...customVars,
  }
}

export type SignatureSigner = { name: string; email: string; phone?: string; qualify?: string; sendWhatsApp?: boolean }

// Envia para assinatura a partir de um MODELO da ZapSign (contrato nosso, gerado
// com os dados do CRM) ou de um PDF já anexado na aba Contrato e aditivos.
export async function sendForSignature(input: {
  contractId: string
  source: 'modelo' | 'pdf'
  templateId?: string
  fileId?: string
  kind: 'contrato' | 'aditivo'
  documentName: string
  signers: SignatureSigner[]
}): Promise<ActionState & { documentId?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Usuário não autenticado.' }
  const name = input.documentName.trim()
  if (!name) return { error: 'Dê um nome ao documento.' }
  const signers = input.signers.map(s => ({ ...s, name: s.name.trim(), email: s.email.trim() })).filter(s => s.name || s.email)
  if (signers.length === 0) return { error: 'Inclua ao menos um signatário.' }
  if (signers.some(s => !s.name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.email))) return { error: 'Cada signatário precisa de nome e e-mail válido.' }

  const tenantId = await resolveTenantId({ contractId: input.contractId })
  const admin = await createScopedAdmin(tenantId)
  const { data: contract } = await admin.from('contracts').select('id').eq('id', input.contractId).maybeSingle()
  if (!contract) return { error: 'Contrato não encontrado.' }
  const apiToken = await getTenantZapSignToken(tenantId)
  if (!apiToken) return { error: 'Configure o token da ZapSign em Configurações antes de continuar.' }

  const signerInputs = signers.map(s => ({ name: s.name, email: s.email, phone: s.phone, qualification: s.qualify, sendWhatsApp: s.sendWhatsApp }))
  let result
  let templateId: string | null = null
  let fileId: string | null = null
  try {
    if (input.source === 'modelo') {
      const { data: template } = await admin.from('zapsign_templates').select('id, zapsign_template_token').eq('id', input.templateId ?? '').maybeSingle()
      if (!template) return { error: 'Escolha um modelo (cadastre em Configurações → Modelos ZapSign).' }
      templateId = template.id
      result = await createZapSignFromTemplate({
        apiToken, templateToken: template.zapsign_template_token, documentName: name,
        data: await buildContractData(input.contractId), signers: signerInputs, externalId: input.contractId,
      })
    } else {
      const { data: file } = await admin.from('contract_files').select('id, file_name, storage_path, mime_type, file_size')
        .eq('id', input.fileId ?? '').eq('contract_id', input.contractId).maybeSingle()
      if (!file) return { error: 'Escolha o PDF a assinar.' }
      const isPdf = (file.mime_type ?? '').includes('pdf') || /\.pdf$/i.test(file.file_name ?? '')
      if (!isPdf) return { error: 'A ZapSign só recebe PDF. Converta o arquivo para PDF e anexe de novo.' }
      if ((file.file_size ?? 0) > 10 * 1024 * 1024) return { error: 'O PDF passa de 10 MB.' }
      const { data: blob, error: dlErr } = await admin.storage.from('contract-files').download(file.storage_path)
      if (dlErr || !blob) return { error: `Não foi possível abrir o PDF: ${dlErr?.message ?? 'sem conteúdo'}` }
      fileId = file.id
      result = await createZapSignFromPdf({
        apiToken, documentName: name, pdfBase64: Buffer.from(await blob.arrayBuffer()).toString('base64'),
        signers: signerInputs, externalId: input.contractId,
      })
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao enviar para a ZapSign.' }
  }

  const { data: doc, error: docError } = await admin.from('zapsign_documents').insert({
    contract_id: input.contractId,
    template_id: templateId,
    file_id: fileId,
    source: input.source,
    document_kind: input.kind,
    name,
    zapsign_doc_token: result.token,
    status: 'enviado',
    sent_at: new Date().toISOString(),
    created_by: user.id,
    signers: (result.signers ?? []).map(s => ({ name: s.name, email: s.email, status: s.status, sign_url: s.sign_url, signed_at: s.signed_at ?? null })),
  }).select('id').single()
  if (docError) return { error: `Enviado à ZapSign, mas não foi possível registrar no CRM: ${docError.message}` }

  await admin.from('activities').insert({
    contract_id: input.contractId,
    user_id: user.id,
    type: 'system',
    content: `✍️ "${name}" enviado para assinatura (ZapSign) — aguardando ${signers.map(s => s.name).join(', ')}.`,
    metadata: { kind: 'zapsign', zapsign_doc_token: result.token },
  })
  revalidatePath(`/contracts/${input.contractId}`)
  return { documentId: doc.id }
}

export async function syncZapSignDocumentStatus(zapsignDocId: string): Promise<ActionState> {
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) return { error: 'Usuário não autenticado.' }
  const admin = await createScopedAdmin()
  const { data: doc } = await admin.from('zapsign_documents')
    .select('id, tenant_id, contract_id, name, status, zapsign_doc_token, document_kind, signed_file_id, created_by').eq('id', zapsignDocId).maybeSingle()
  if (!doc?.zapsign_doc_token) return { error: 'Documento não encontrado.' }
  const apiToken = await getTenantZapSignToken(doc.tenant_id)
  if (!apiToken) return { error: 'Token da ZapSign não configurado.' }
  try {
    const h = await headers()
    const host = h.get('x-forwarded-host') ?? h.get('host')
    await syncZapSignDoc(doc as ZapSignDocRow, apiToken, host ? `https://${host}` : null)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao consultar a ZapSign.' }
  }
  revalidatePath(`/contracts/${doc.contract_id}`)
  return {}
}

// Cadastra na conta ZapSign da empresa o aviso automático (webhook) para este CRM
export async function registerZapSignWebhook(): Promise<ActionState & { url?: string }> {
  if (!(await isCurrentUserAdmin())) return { error: 'Só administradores podem configurar isso.' }
  const tenantId = await resolveTenantId()
  const apiToken = await getTenantZapSignToken(tenantId)
  if (!apiToken) return { error: 'Salve o token da ZapSign primeiro.' }
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? ''
  if (!host || host.includes('localhost')) return { error: 'Abra o CRM pelo endereço oficial para ativar os avisos.' }
  const url = `https://${host}/api/zapsign-webhook`
  try {
    await createZapSignWebhook(apiToken, url)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao cadastrar o aviso na ZapSign.' }
  }
  const admin = await createScopedAdmin(tenantId)
  await admin.from('organization_settings').update({ zapsign_webhook_url: url }).eq('tenant_id', tenantId)
  revalidatePath('/settings')
  return { url }
}

export async function saveZapSignSettings(formData: FormData): Promise<ActionState> {
  if (!(await isCurrentUserAdmin())) return { error: 'Só administradores podem configurar isso.' }
  const token = (formData.get('zapsign_api_token') as string)?.trim()
  if (!token) return { error: 'Cole o token da ZapSign.' }
  const supabase = await createClient()
  const { error } = await supabase.from('organization_settings').update({ zapsign_api_token: token }).eq('tenant_id', await resolveTenantId())
  if (error) return { error: error.message }
  revalidatePath('/settings')
  return {}
}

export async function createZapSignTemplate(formData: FormData): Promise<ActionState> {
  if (!(await isCurrentUserAdmin())) return { error: 'Só administradores podem criar modelos.' }
  const name = (formData.get('name') as string)?.trim()
  const zapsign_template_token = (formData.get('zapsign_template_token') as string)?.trim()
  const type = (formData.get('type') as string) || 'contrato'
  const description = (formData.get('description') as string)?.trim() || null
  if (!name || !zapsign_template_token) return { error: 'Preencha o nome e o token do modelo.' }
  const supabase = await createClient()
  const { error } = await supabase.from('zapsign_templates').insert({ name, zapsign_template_token, type, description })
  if (error) return { error: error.message }
  revalidatePath('/zapsign')
  return {}
}

export async function deleteZapSignTemplate(templateId: string) {
  const supabase = (await createScopedAdmin())
  await supabase.from('zapsign_templates').delete().eq('id', templateId)
  revalidatePath('/zapsign')
}
