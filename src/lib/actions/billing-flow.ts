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
import { readErpConfig, isAllowedOutUrl, buildWebhookPayload, postSignedWebhook } from '@/lib/erp/connectors'
import { submitToBilling } from '@/lib/billing/submit'
import { brl, MONTHS_LONG } from '@/lib/revenue/measurement'

type Result = { ok: true } | { ok: false; error: string }
export type SendInput = { contractId: string; sourceType: 'recorrente' | 'medicao' | 'avulso'; year: number; month: number }


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
  const { contractId, year, month } = input
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return { ok: false, error: 'Mês inválido.' }

  const tenantId = await resolveTenantId({ contractId })
  const db = await createScopedAdmin(tenantId)
  const { data: contract } = await db.from('contracts').select('id, owner_id').eq('id', contractId).maybeSingle()
  if (!contract) return { ok: false, error: 'Contrato não encontrado.' }
  if (!user.isAdmin && contract.owner_id !== user.id) return { ok: false, error: 'Só o consultor responsável ou o Admin envia para faturamento.' }

  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const r = await submitToBilling(db, user.id, input, host ? `https://${host}/api/faturamento/retorno` : null)
  revalidateAll(contractId)
  return r
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

// Admin: modo de envio (manual ou webhook) e endereço que recebe os envios
export async function saveBillingDelivery(input: { provider: 'manual' | 'webhook'; outUrl: string }): Promise<Result> {
  const user = await me()
  if (!user?.isAdmin) return { ok: false, error: 'Só o Admin altera isso.' }
  const provider = input.provider === 'webhook' ? 'webhook' : 'manual'
  const outUrl = input.outUrl.trim()
  if (provider === 'webhook' && !isAllowedOutUrl(outUrl)) return { ok: false, error: 'Informe um endereço https válido (endereços internos não são aceitos).' }
  const tenantId = await resolveTenantId()
  const db = await createScopedAdmin(tenantId)
  const { data: org } = await db.from('organization_settings').select('billing_erp').limit(1).maybeSingle()
  const cfg = { ...readErpConfig(org?.billing_erp), provider, out_url: outUrl || null }
  const { error } = await db.from('organization_settings').update({ billing_erp: cfg }).eq('tenant_id', tenantId)
  if (error) return { ok: false, error: error.message }
  revalidateAll()
  return { ok: true }
}

export async function generateBillingOutSecret(): Promise<{ ok: true; secret: string } | { ok: false; error: string }> {
  const user = await me()
  if (!user?.isAdmin) return { ok: false, error: 'Só o Admin gera a chave.' }
  const tenantId = await resolveTenantId()
  const db = await createScopedAdmin(tenantId)
  const { data: org } = await db.from('organization_settings').select('billing_erp').limit(1).maybeSingle()
  const secret = randomBytes(24).toString('hex')
  const { error } = await db.from('organization_settings').update({ billing_erp: { ...readErpConfig(org?.billing_erp), out_secret: secret } }).eq('tenant_id', tenantId)
  if (error) return { ok: false, error: error.message }
  return { ok: true, secret }
}

// Admin: manda um aviso de teste (evento faturamento.teste) — nada é registrado
export async function testBillingWebhook(): Promise<Result> {
  const user = await me()
  if (!user?.isAdmin) return { ok: false, error: 'Só o Admin testa.' }
  const db = await createScopedAdmin(await resolveTenantId())
  const { data: org } = await db.from('organization_settings').select('billing_erp').limit(1).maybeSingle()
  const cfg = readErpConfig(org?.billing_erp)
  if (!cfg.out_url || !isAllowedOutUrl(cfg.out_url)) return { ok: false, error: 'Salve o endereço do webhook primeiro.' }
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const sample = buildWebhookPayload({
    submissionId: '00000000-0000-0000-0000-000000000000', sourceType: 'recorrente', year: 2026, month: 1, amount: 1234.56,
    description: 'TESTE — não faturar',
    contract: { id: '00000000-0000-0000-0000-000000000000', client_name: 'CLIENTE TESTE', process_number: null, contract_number: 'TESTE', cnpj: '00000000000000', razao_social: 'CLIENTE TESTE LTDA', nome_fantasia: 'Cliente Teste', cnpj_emitente: null },
  }, { returnUrl: host ? `https://${host}/api/faturamento/retorno` : null })
  try {
    const r = await postSignedWebhook(cfg.out_url, cfg.out_secret ?? null, { ...sample, evento: 'faturamento.teste' }, 'faturamento.teste')
    if (r.status >= 200 && r.status < 300) return { ok: true }
    return { ok: false, error: `O endereço respondeu ${r.status}${r.text ? `: ${r.text.slice(0, 200)}` : ''}` }
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.name === 'AbortError' ? 'O endereço não respondeu em 15 segundos.' : 'Não foi possível chamar o endereço.' }
  }
}
