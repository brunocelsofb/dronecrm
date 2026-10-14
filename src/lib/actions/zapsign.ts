'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isCurrentUserAdmin } from '@/lib/auth/role'
import { createZapSignDocumentFromTemplate, getZapSignDocument } from '@/lib/zapsign/api'
import { resolveTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

export type ActionState = { error?: string }

async function getZapSignToken(): Promise<string | null> {
  const supabase = (await createScopedAdmin())
  const { data } = await supabase.from('organization_settings').select('zapsign_api_token').eq('tenant_id', await resolveTenantId()).maybeSingle()
  return data?.zapsign_api_token ?? null
}

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
    data_hoje: new Date().toLocaleDateString('pt-BR'),
    ...customVars,
  }
}

export async function sendContractToZapSign(
  contractId: string,
  templateId: string,
  documentName: string,
  signers: Array<{ name: string; email: string; phone?: string; qualify?: string; sendWhatsApp?: boolean }>
): Promise<ActionState & { documentId?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Usuário não autenticado.' }

  const apiToken = await getZapSignToken()
  if (!apiToken) return { error: 'Configure o token da ZapSign em Configurações antes de continuar.' }

  const { data: template } = await supabase.from('zapsign_templates').select('*').eq('id', templateId).maybeSingle()
  if (!template) return { error: 'Modelo não encontrado.' }

  const data = await buildContractData(contractId)

  try {
    const result = await createZapSignDocumentFromTemplate({
      apiToken,
      templateToken: template.zapsign_template_token,
      documentName,
      data,
      signers: signers.map((s) => ({
        name: s.name,
        email: s.email,
        phone_number: s.phone?.replace(/\D/g, '') ?? '',
        send_automatic_email: true,
        send_automatic_whatsapp: s.sendWhatsApp ?? false,
        qualify: s.qualify ?? '',
      })),
    })

    const { data: doc, error: docError } = await supabase.from('zapsign_documents').insert({
      contract_id: contractId,
      template_id: templateId,
      name: documentName,
      zapsign_doc_token: result.token,
      pdf_url: result.original_file,
      status: 'enviado',
      sent_at: new Date().toISOString(),
      created_by: user.id,
    }).select('id').single()

    if (docError) return { error: docError.message }

    await supabase.from('activities').insert({
      contract_id: contractId,
      user_id: user.id,
      type: 'system',
      content: `Contrato "${documentName}" enviado pra ZapSign — aguardando assinatura de ${signers.map((s) => s.name).join(', ')}.`,
      metadata: { zapsign_doc_token: result.token },
    })

    revalidatePath(`/contracts/${contractId}`)
    return { documentId: doc.id }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao enviar pro ZapSign.' }
  }
}

export async function syncZapSignDocumentStatus(zapsignDocId: string): Promise<ActionState> {
  const supabase = (await createScopedAdmin())
  const apiToken = await getZapSignToken()
  if (!apiToken) return { error: 'Token da ZapSign não configurado.' }

  const { data: doc } = await supabase.from('zapsign_documents').select('*').eq('id', zapsignDocId).maybeSingle()
  if (!doc?.zapsign_doc_token) return { error: 'Documento não encontrado.' }

  try {
    const result = await getZapSignDocument(apiToken, doc.zapsign_doc_token)
    const statusMap: Record<string, string> = { pending: 'enviado', awaiting: 'enviado', signed: 'assinado', refused: 'recusado', expired: 'expirado' }
    const newStatus = statusMap[result.status] ?? 'enviado'

    await supabase.from('zapsign_documents').update({
      status: newStatus,
      signed_pdf_url: result.signed_file ?? null,
      signed_at: newStatus === 'assinado' ? new Date().toISOString() : null,
    }).eq('id', zapsignDocId)

    if (newStatus === 'assinado') {
      await supabase.from('activities').insert({
        contract_id: doc.contract_id,
        type: 'system',
        content: `Contrato "${doc.name}" assinado por todos os signatários. ✅`,
        metadata: { zapsign_doc_token: doc.zapsign_doc_token, signed_pdf_url: result.signed_file },
      })
    }

    revalidatePath(`/contracts/${doc.contract_id}`)
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao sincronizar com ZapSign.' }
  }
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
