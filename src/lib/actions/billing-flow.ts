'use server'

// Fluxo de faturamento: o comercial (guardião da receita) envia ao faturamento
// o que está apurado no CRM; o "faturado" volta do ERP (ou é lançado à mão
// pelo Admin enquanto a integração não existe).
//   recorrente: precisa estar confirmado no mês (billing_records validado)
//   medição:    precisa estar validada (com relatório ou aprovada pelo Admin)
//   avulso:     oportunidade do funil Avulso ganha no mês

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { randomBytes } from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { resolveTenantId } from '@/lib/tenant/context'
import { getConnector, readErpConfig, type BillingItem } from '@/lib/erp/connectors'
import { brl, MONTHS_LONG } from '@/lib/revenue/measurement'

type Result = { ok: true } | { ok: false; error: string }
export type SendInput = { contractId: string; sourceType: 'recorrente' | 'medicao' | 'avulso'; year: number; month: number }

const BR_OFFSET_MS = 3 * 3600 * 1000
const brMonthOf = (iso: string) => { const d = new Date(Date.parse(iso) - BR_OFFSET_MS); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 } }

async function me() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  return { id: user.id, isAdmin: profile?.role === 'admin' }
}

function revalidateAll(contractId?: string) {
  revalidatePath('/financeiro')
  revalidatePath('/painel')
  if (contractId) revalidatePath(`/contracts/${contractId}`)
}

export async function sendToBilling(input: SendInput): Promise<Result> {
  const user = await me()
  if (!user) return { ok: false, error: 'Usuário não autenticado.' }
  const { contractId, sourceType, year, month } = input
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return { ok: false, error: 'Mês inválido.' }

  const tenantId = await resolveTenantId({ contractId })
  const db = await createScopedAdmin(tenantId)
  const [{ data: contract }, { data: org }] = await Promise.all([
    db.from('contracts').select('id, client_name, process_number, owner_id, companies(cnpj)').eq('id', contractId).maybeSingle(),
    db.from('organization_settings').select('billing_erp').limit(1).maybeSingle(),
  ])
  if (!contract) return { ok: false, error: 'Contrato não encontrado.' }
  if (!user.isAdmin && contract.owner_id !== user.id) return { ok: false, error: 'Só o consultor responsável ou o Admin envia para faturamento.' }

  // Valor apurado no CRM (nunca vem do navegador)
  let amount = 0
  let billingRecordId: string | null = null
  let runId: string | null = null
  if (sourceType === 'avulso') {
    const { data: avulsoPipes } = await db.from('pipelines').select('id').eq('type', 'servico_avulso')
    const ids = (avulsoPipes ?? []).map(p => p.id)
    const { data: runs } = ids.length
      ? await db.from('pipeline_runs').select('id, value, ended_at, status').eq('contract_id', contractId).eq('status', 'won').in('pipeline_id', ids)
      : { data: [] as { id: string; value: number | null; ended_at: string | null; status: string }[] }
    const run = (runs ?? []).find(r => r.ended_at && brMonthOf(r.ended_at).y === year && brMonthOf(r.ended_at).m === month)
    if (!run) return { ok: false, error: 'Não há avulso ganho neste mês para este cliente.' }
    amount = Number(run.value) || 0
    runId = run.id
  } else {
    const { data: rec } = await db.from('billing_records').select('id, amount, status')
      .eq('contract_id', contractId).eq('year', year).eq('month', month).maybeSingle()
    if (!rec) return { ok: false, error: sourceType === 'recorrente' ? 'Confirme a recorrência do mês antes de enviar.' : 'Lance a medição do mês antes de enviar.' }
    if (rec.status !== 'validado') return { ok: false, error: 'A medição ainda não está validada (falta relatório ou aprovação do Admin).' }
    amount = Number(rec.amount) || 0
    billingRecordId = rec.id
  }
  if (amount <= 0) return { ok: false, error: 'Valor apurado zerado: nada a enviar.' }

  const config = readErpConfig(org?.billing_erp)
  const { data: sub, error: insErr } = await db.from('billing_submissions').insert({
    contract_id: contractId, source_type: sourceType, billing_record_id: billingRecordId, run_id: runId,
    year, month, amount_sent: amount, status: 'enviado', erp_provider: config.provider, sent_by: user.id,
  }).select('id').single()
  if (insErr || !sub) {
    if (insErr?.code === '23505') return { ok: false, error: 'Este valor já foi enviado para faturamento neste mês.' }
    return { ok: false, error: insErr?.message ?? 'Falha ao registrar o envio.' }
  }

  const company = (contract as { companies?: { cnpj?: string | null } | null }).companies
  const ref = `${MONTHS_LONG[month - 1]}/${year}`
  const item: BillingItem = {
    submissionId: sub.id, sourceType, year, month, amount,
    description: `${sourceType === 'recorrente' ? 'Recorrência' : sourceType === 'medicao' ? 'Medição' : 'Serviço avulso'} ${ref} — ${contract.client_name ?? ''}`,
    contract: { id: contract.id, client_name: contract.client_name, process_number: contract.process_number, cnpj: company?.cnpj ?? null },
  }
  try {
    const r = await getConnector(config.provider).send(item, config)
    await db.from('billing_submissions').update({ erp_reference: r.reference, erp_payload: r.payload as object }).eq('id', sub.id)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await db.from('billing_submissions').update({ status: 'erro', erp_error: msg.slice(0, 500) }).eq('id', sub.id)
    revalidateAll(contractId)
    return { ok: false, error: `Envio não concluído: ${msg}` }
  }

  await db.from('activities').insert({
    contract_id: contractId, user_id: user.id, type: 'system',
    content: `🧾 Enviado para faturamento: ${item.description.split(' — ')[0]} — ${brl(amount)}.`,
    metadata: { kind: 'billing_submission', submission_id: sub.id, year, month, source_type: sourceType },
  })
  revalidateAll(contractId)
  return { ok: true }
}

export async function sendManyToBilling(items: SendInput[]): Promise<{ sent: number; errors: string[] }> {
  let sent = 0
  const errors: string[] = []
  for (const it of items.slice(0, 200)) {
    const r = await sendToBilling(it)
    if (r.ok) sent++
    else errors.push(r.error)
  }
  return { sent, errors }
}

// Admin: lança o faturado (até a integração devolver sozinho)
export async function markInvoiced(input: { submissionId: string; amount: number; invoiceNumber: string; invoicedAt: string }): Promise<Result> {
  const user = await me()
  if (!user) return { ok: false, error: 'Usuário não autenticado.' }
  if (!user.isAdmin) return { ok: false, error: 'Só o Admin lança o faturado.' }
  const amount = Math.round(Number(input.amount) * 100) / 100
  if (!Number.isFinite(amount) || amount < 0) return { ok: false, error: 'Valor faturado inválido.' }
  if (!input.invoiceNumber.trim()) return { ok: false, error: 'Informe o número da nota.' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.invoicedAt)) return { ok: false, error: 'Informe a data do faturamento.' }
  const db = await createScopedAdmin()
  const { data: sub } = await db.from('billing_submissions').select('id, contract_id, status, amount_sent, year, month').eq('id', input.submissionId).maybeSingle()
  if (!sub) return { ok: false, error: 'Envio não encontrado.' }
  if (sub.status !== 'enviado' && sub.status !== 'faturado') return { ok: false, error: 'Este envio foi cancelado ou deu erro.' }
  const { error } = await db.from('billing_submissions').update({
    status: 'faturado', invoiced_amount: amount, invoice_number: input.invoiceNumber.trim(), invoiced_at: input.invoicedAt,
    invoiced_by: user.id, invoiced_source: 'manual',
  }).eq('id', sub.id)
  if (error) return { ok: false, error: error.message }
  const diff = Number(sub.amount_sent) - amount
  await db.from('activities').insert({
    contract_id: sub.contract_id, user_id: user.id, type: 'system',
    content: `✅ Faturado ${MONTHS_LONG[sub.month - 1]}/${sub.year}: NF ${input.invoiceNumber.trim()} — ${brl(amount)}${Math.abs(diff) > 0.005 ? ` (enviado ${brl(Number(sub.amount_sent))}; diferença ${brl(diff)})` : ''}.`,
    metadata: { kind: 'billing_invoiced', submission_id: sub.id },
  })
  revalidateAll(sub.contract_id)
  return { ok: true }
}

// Admin: cancela um envio (ex.: valor errado) — libera para reenviar
export async function cancelSubmission(input: { submissionId: string; reason: string }): Promise<Result> {
  const user = await me()
  if (!user) return { ok: false, error: 'Usuário não autenticado.' }
  if (!user.isAdmin) return { ok: false, error: 'Só o Admin cancela um envio.' }
  if (!input.reason.trim()) return { ok: false, error: 'Informe o motivo do cancelamento.' }
  const db = await createScopedAdmin()
  const { data: sub } = await db.from('billing_submissions').select('id, contract_id, status, year, month, amount_sent').eq('id', input.submissionId).maybeSingle()
  if (!sub) return { ok: false, error: 'Envio não encontrado.' }
  if (sub.status === 'faturado') return { ok: false, error: 'Já faturado: o estorno é feito no ERP.' }
  const { error } = await db.from('billing_submissions').update({
    status: 'cancelado', cancelled_by: user.id, cancelled_at: new Date().toISOString(), cancel_reason: input.reason.trim(),
  }).eq('id', sub.id)
  if (error) return { ok: false, error: error.message }
  await db.from('activities').insert({
    contract_id: sub.contract_id, user_id: user.id, type: 'system',
    content: `↩️ Envio para faturamento de ${MONTHS_LONG[sub.month - 1]}/${sub.year} (${brl(Number(sub.amount_sent))}) cancelado: ${input.reason.trim()}.`,
    metadata: { kind: 'billing_cancelled', submission_id: sub.id },
  })
  revalidateAll(sub.contract_id)
  return { ok: true }
}

// Admin: mês de início do fluxo e chave do endereço de retorno
export async function saveBillingFlowStart(flowStart: string): Promise<Result> {
  const user = await me()
  if (!user?.isAdmin) return { ok: false, error: 'Só o Admin altera isso.' }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(flowStart)) return { ok: false, error: 'Mês inválido (use AAAA-MM).' }
  const tenantId = await resolveTenantId()
  const db = await createScopedAdmin(tenantId)
  const { data: org } = await db.from('organization_settings').select('billing_erp').limit(1).maybeSingle()
  const cfg = { ...readErpConfig(org?.billing_erp), flow_start: flowStart }
  const { error } = await db.from('organization_settings').update({ billing_erp: cfg }).eq('tenant_id', tenantId)
  if (error) return { ok: false, error: error.message }
  revalidateAll()
  return { ok: true }
}

export async function generateBillingReturnKey(): Promise<{ ok: true; url: string; key: string } | { ok: false; error: string }> {
  const user = await me()
  if (!user?.isAdmin) return { ok: false, error: 'Só o Admin gera a chave.' }
  const tenantId = await resolveTenantId()
  const db = await createScopedAdmin(tenantId)
  const { data: org } = await db.from('organization_settings').select('billing_erp').limit(1).maybeSingle()
  const key = randomBytes(24).toString('hex')
  const cfg = { ...readErpConfig(org?.billing_erp), webhook_secret: key }
  const { error } = await db.from('organization_settings').update({ billing_erp: cfg }).eq('tenant_id', tenantId)
  if (error) return { ok: false, error: error.message }
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? ''
  return { ok: true, key, url: `https://${host}/api/faturamento/retorno` }
}
