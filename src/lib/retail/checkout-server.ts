// ─── Varejo: confirmação do pagamento (servidor, rotinas públicas) ────────────
// Chamado pelo aviso do serviço (webhook) e pelo retorno da cliente à página
// "Finalizar compra". Só fecha o pedido depois que o serviço confirma o
// pagamento, a referência é de um link deste pedido e o valor bate.

import { createAdminClient } from '@/lib/supabase/admin'
import { scopeAdminClient } from '@/lib/tenant/scoped-admin'
import { loadPricingConfig, onRetailOrderPaid } from '@/lib/retail/loyalty-server'
import { isProposal } from '@/lib/retail/proposal'
import { round2 } from '@/lib/retail/margin'
import { fmtBRL } from '@/lib/format'
import { checkPayment, providerLabel, type PaymentLink, type PayProvider } from '@/lib/retail/payments'
import type { Verified } from '@/lib/retail/payment-providers'

export type OrderByToken = {
  id: string; tenant_id: string; number: number; status: string; stock_applied: boolean
  discount: number; loyalty_discount: number; proposal: unknown; payment_links: Record<string, PaymentLink> | null
  payment_tx: string | null
}

export async function orderByToken(token: string): Promise<OrderByToken | null> {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return null
  const { data } = await createAdminClient().from('retail_orders')
    .select('id, tenant_id, number, status, stock_applied, discount, loyalty_discount, proposal, payment_links, payment_tx')
    .eq('proposal_token', token).maybeSingle()
  return (data as OrderByToken | null) ?? null
}

export async function notifyStoreAdmins(tenantId: string, message: string): Promise<void> {
  const admin = createAdminClient()
  const { data: admins } = await admin.from('profiles').select('id').eq('tenant_id', tenantId).eq('role', 'admin').limit(20)
  if (admins?.length) await admin.from('notifications').insert(admins.map(a => ({ user_id: a.id, tenant_id: tenantId, read: false, message })))
}

// Resultado: 'pago' (fechou agora), 'ja_pago', 'pendente' (ainda não aprovado), 'recusado' (não fecha), 'ignorado'
export async function confirmRetailPayment(o: OrderByToken, provider: PayProvider, v: Verified): Promise<'pago' | 'ja_pago' | 'pendente' | 'recusado' | 'ignorado'> {
  const link = v.ref ? o.payment_links?.[v.ref] : undefined
  if (!link || link.provider !== provider) return 'ignorado'          // referência que não é deste pedido
  if (!v.paid) return 'pendente'
  if (o.stock_applied || ['pago', 'enviado', 'entregue'].includes(o.status)) return 'ja_pago'

  const db = scopeAdminClient(createAdminClient(), o.tenant_id, null)
  const via = `${link.choice === 'pix' ? 'Pix' : 'cartão'} via ${providerLabel(provider)}`
  if (o.status === 'cancelado') {
    await db.from('retail_orders').update({ payment_alert: `Pagamento aprovado (${via}) num pedido cancelado. Devolva o valor ou crie um novo pedido.`, payment_tx: v.tx }).eq('id', o.id)
    await notifyStoreAdmins(o.tenant_id, `Pedido nº ${o.number}: chegou um pagamento aprovado (${via}), mas o pedido está cancelado. Confira.`)
    return 'recusado'
  }
  const check = checkPayment(link, { amount: v.amount, method: v.method })
  if (!check.ok) {
    await db.from('retail_orders').update({ payment_alert: check.alert, payment_tx: v.tx, payment_paid_amount: v.amount }).eq('id', o.id)
    await notifyStoreAdmins(o.tenant_id, `Pedido nº ${o.number}: ${check.alert}`)
    return 'recusado'
  }

  // Valores do pedido conforme a condição paga (ex.: desconto do Pix)
  const prop = isProposal(o.proposal) ? o.proposal : null
  const opt = prop?.options.find(x => x.id === link.choice)
  const baseDiscount = prop ? prop.discount : Number(o.discount)
  const now = new Date().toISOString()
  const patch: Record<string, unknown> = {
    discount: round2(baseDiscount + link.discount), total: link.amount,
    payment_method: link.choice === 'pix' ? 'pix' : 'cartao', payment_condition: opt?.label ?? (link.choice === 'pix' ? 'Pix' : 'Cartão'),
    payment_link: link.url, payment_provider: provider, payment_tx: v.tx, payment_paid_amount: v.amount,
    payment_paid_method: v.method, payment_receipt_url: v.receiptUrl, payment_alert: check.alert,
    proposal_choice: link.choice, proposal_accepted_at: now, updated_at: now,
  }
  await db.from('retail_orders').update(patch).eq('id', o.id)

  // Baixa o estoque (uma vez) e só então vira Pago
  const { data: stockMsg, error: stockErr } = await db.rpc('retail_apply_order_stock', { p_order: o.id, p_tenant: o.tenant_id, p_apply: true })
  const stockProblem = stockErr ? stockErr.message.replace(/^.*?Estoque/, 'Estoque') : (stockMsg as string | null)
  if (stockProblem) {
    await db.from('retail_orders').update({ status: 'aguardando_pagamento', payment_alert: `Pago (${via}), mas: ${stockProblem}. Ajuste o estoque e marque como Pago.` }).eq('id', o.id)
    await notifyStoreAdmins(o.tenant_id, `Pedido nº ${o.number} foi pago (${via}), mas o estoque não baixou: ${stockProblem}`)
    return 'recusado'
  }
  await db.from('retail_orders').update({ status: 'pago', paid_at: now }).eq('id', o.id).neq('status', 'cancelado')
  try { await onRetailOrderPaid(db, o.id, (await loadPricingConfig(db, o.tenant_id)).loyalty) } catch (e) { console.error('[varejo-pagamento] fidelidade:', e instanceof Error ? e.message : e) }
  await notifyStoreAdmins(o.tenant_id, `Pedido nº ${o.number} pago: ${via}, ${fmtBRL(v.amount)}. O estoque já baixou.${check.alert ? ` Atenção: ${check.alert}` : ''}`)
  return 'pago'
}
