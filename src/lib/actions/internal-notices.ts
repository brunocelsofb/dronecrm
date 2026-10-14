'use server'

// Envio dos e-mails internos preparados pelo Copiloto (ganho, renovação,
// relatório mensal de implantação). Sai do e-mail de quem clica em enviar;
// destinatários e cópia são editáveis na janela. Nunca leva valores.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmailForUser, getEmailAccountInfo } from '@/lib/email/send'
import { getContractTenantName } from '@/lib/agent/tenant-name'
import { buildInternalEmailHtml, invalidEmails, parseEmailList } from '@/lib/agent/internal-settings'
import { createMonthlyImplementationReport } from '@/lib/agent/internal-notices'
import { isCurrentUserAdmin } from '@/lib/auth/role'
import { resolveTenantId } from '@/lib/tenant/context'

const INTERNAL_KINDS = new Set(['internal_notice', 'internal_impl_report'])

export async function getMyEmailSender(): Promise<{ email: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { email: null }
  const acc = await getEmailAccountInfo(user.id)
  return { email: acc?.fromEmail ?? null }
}

export async function sendInternalEmail(
  activityId: string,
  toText: string,
  ccText: string,
  subject: string,
  message: string,
): Promise<{ ok?: true; error?: string; title?: string; content?: string; metadata?: Record<string, unknown> }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const badTo = invalidEmails(toText)
  const badCc = invalidEmails(ccText)
  if (badTo.length || badCc.length) return { error: `E-mail inválido: ${[...badTo, ...badCc].join(', ')}` }
  const to = parseEmailList(toText)
  const cc = parseEmailList(ccText).filter(e => !to.some(t => t.toLowerCase() === e.toLowerCase()))
  if (to.length === 0) return { error: 'Informe pelo menos um destinatário.' }
  if (!subject.trim()) return { error: 'O assunto está vazio.' }
  if (!message.trim()) return { error: 'A mensagem está vazia.' }

  const account = await getEmailAccountInfo(user.id)
  if (!account) return { error: 'Seu e-mail não está conectado. Conecte em Minha Conta para enviar.' }

  const admin = createAdminClient()
  const { data: activity } = await admin
    .from('activities').select('id, contract_id, metadata').eq('id', activityId).maybeSingle()
  if (!activity) return { error: 'Atividade não encontrada.' }
  const meta = (activity.metadata ?? {}) as Record<string, unknown>
  if (!INTERNAL_KINDS.has(String(meta.kind))) return { error: 'Esta atividade não é um e-mail interno do Copiloto.' }
  if (meta.approval === 'sent') return { error: 'Este e-mail já foi enviado.' }

  const { data: locked } = await admin
    .from('activities')
    .update({ metadata: { ...meta, approval: 'sending' } })
    .eq('id', activityId)
    .eq('metadata->>approval', 'pending')
    .select('id')
  if (!locked?.length) return { error: 'Este e-mail já está sendo enviado.' }

  const isReport = meta.kind === 'internal_impl_report'
  const key = meta.internal_key === 'renovado' ? 'renovado' : 'ganho'
  const [{ data: contract }, { data: org }] = await Promise.all([
    activity.contract_id
      ? admin.from('contracts').select('client_name').eq('id', activity.contract_id).maybeSingle()
      : Promise.resolve({ data: null as { client_name: string } | null }),
    admin.from('organization_settings').select('company_name').eq('tenant_id', await resolveTenantId({ contractId: activity.contract_id })).maybeSingle(),
  ])
  const tenantName = activity.contract_id ? await getContractTenantName(admin, activity.contract_id) : null
  const { data: tenantRow } = !tenantName
    ? await admin.from('organization_settings').select('tenant_id').eq('tenant_id', await resolveTenantId({ contractId: activity.contract_id })).maybeSingle()
    : { data: null }
  let companyName = tenantName ?? org?.company_name ?? 'Equipe Comercial'
  if (!tenantName && tenantRow?.tenant_id) {
    const { data: t } = await admin.from('tenants').select('name').eq('id', tenantRow.tenant_id).maybeSingle()
    if (t?.name) companyName = t.name
  }

  const html = buildInternalEmailHtml({
    badge: isReport ? 'IMPLANTAÇÃO' : key === 'renovado' ? 'RENOVAÇÃO' : 'NOVO CONTRATO',
    header: isReport
      ? 'Relatório consolidado das implantações'
      : key === 'renovado' ? `Contrato renovado — ${contract?.client_name ?? ''}` : `Contrato fechado — ${contract?.client_name ?? ''}`,
    messageText: message.trim(),
    companyName,
  })

  const unlock = async (err: string) => {
    await admin.from('activities').update({
      metadata: { ...meta, approval: 'pending', last_error: err, last_error_at: new Date().toISOString() },
    }).eq('id', activityId)
  }

  let res: { messageId?: string; fromEmail: string }
  try {
    res = await sendEmailForUser(user.id, to.join(', '), subject.trim(), html, cc.length ? { cc: cc.join(', ') } : undefined)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Falha ao enviar e-mail.'
    await unlock(msg)
    return { error: `O e-mail não foi enviado: ${msg}` }
  }

  if (activity.contract_id) {
    await admin.from('contract_emails').insert({
      contract_id: activity.contract_id,
      sent_by: user.id,
      from_email: res.fromEmail,
      to_email: to.join(', '),
      subject: subject.trim(),
      body: message.trim(),
      triggered_automatically: false,
      gmail_message_id: res.messageId ?? null,
      status: 'enviado',
    })
  }

  const { data: sender } = await admin.from('profiles').select('full_name').eq('id', user.id).maybeSingle()
  const sentAt = new Date()
  const quando = sentAt.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).replace(',', ' às')
  const title = isReport
    ? 'Relatório mensal de implantação enviado ao time técnico'
    : key === 'renovado' ? 'Renovação comunicada ao time interno' : 'Fechamento comunicado ao time interno'
  const content =
    `✉️ E-mail interno enviado em ${quando}${sender?.full_name ? ` por ${sender.full_name}` : ''} (${res.fromEmail}) ` +
    `para ${to.join(', ')}${cc.length ? `, com cópia para ${cc.join(', ')}` : ''}.`
  const metadata: Record<string, unknown> = {
    ...meta,
    approval:      'sent',
    sent_at:       sentAt.toISOString(),
    sent_by:       user.id,
    final_message: message.trim(),
    final_subject: subject.trim(),
    email_from:    res.fromEmail,
    email_to:      to,
    email_cc:      cc.join(', ') || null,
    last_error:    null,
  }
  await admin.from('activities')
    .update({ status: 'done', completed: true, title, content, metadata })
    .eq('id', activityId)

  if (activity.contract_id) revalidatePath(`/contracts/${activity.contract_id}`)
  revalidatePath('/copiloto/relatorios')
  return { ok: true, title, content, metadata }
}

export async function generateImplementationReportNow(): Promise<{ ok?: true; error?: string; detail?: string }> {
  if (!(await isCurrentUserAdmin())) return { error: 'Só administradores podem gerar o relatório.' }
  const r = await createMonthlyImplementationReport(await resolveTenantId(), true)
  if (r.status === 'error') return { error: r.detail ?? 'Falha ao gerar.' }
  revalidatePath('/copiloto/relatorios')
  return { ok: true, detail: r.status === 'skipped' ? r.detail : undefined }
}
