// ─── Varejo: preço e fidelidade (servidor, sem ser ação) ──────────────────────
// Lê as configurações da empresa e calcula a fidelidade de uma cliente a partir
// do banco. As contas ficam em margin.ts (testadas). Usado por telas e ações.

import type { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { PAID_STATUSES } from '@/lib/retail/customers'
import {
  readLoyalty, readPricing, cashbackBalance, everyRewards, tierFor, round2,
  type LoyaltySettings, type PricingSettings, type CashbackEntry,
} from '@/lib/retail/margin'

type Db = Awaited<ReturnType<typeof createScopedAdmin>>

export type RetailPricingConfig = { pricing: PricingSettings; loyalty: LoyaltySettings; raw: Record<string, unknown> }

export async function loadPricingConfig(db: Db, tenantId: string): Promise<RetailPricingConfig> {
  const { data } = await db.from('organization_settings').select('retail_settings').eq('tenant_id', tenantId).maybeSingle()
  const raw = ((data as { retail_settings?: Record<string, unknown> } | null)?.retail_settings ?? {}) as Record<string, unknown>
  return { pricing: readPricing(raw.pricing), loyalty: readLoyalty(raw.loyalty), raw }
}

export type CustomerLoyalty =
  | { mode: 'off' }
  | { mode: 'cashback'; balance: number; nextExpiry: string | null; expiringAmount: number; pct: number }
  | { mode: 'cada_x'; available: number; progress: number; missing: number; every: number; pct: number }
  | { mode: 'progressivo'; pct: number; spent12m: number; nextMin: number | null; nextPct: number | null; missing: number | null }

// Situação da cliente no programa (ignora o pedido informado, para não contar ele mesmo)
export async function customerLoyalty(db: Db, customerId: string, l: LoyaltySettings, exceptOrderId?: string | null, now = new Date()): Promise<CustomerLoyalty> {
  if (!l.enabled) return { mode: 'off' }
  if (l.mode === 'cashback') {
    let q = db.from('retail_loyalty_entries').select('kind, amount, created_at, expires_at').eq('customer_id', customerId)
    if (exceptOrderId) q = q.or(`order_id.is.null,order_id.neq.${exceptOrderId}`)
    const { data } = await q.limit(5000)
    const entries: CashbackEntry[] = (data ?? []).map(e => ({ kind: e.kind as 'credito' | 'uso', amount: Number(e.amount), at: e.created_at as string, expires_at: e.expires_at as string | null }))
    return { mode: 'cashback', pct: l.cashback_pct, ...cashbackBalance(entries, now) }
  }
  let q = db.from('retail_orders').select('id, status, loyalty_base, loyalty_kind, loyalty_discount, paid_at').eq('customer_id', customerId).neq('status', 'cancelado')
  if (exceptOrderId) q = q.neq('id', exceptOrderId)
  const { data } = await q.limit(5000)
  const orders = data ?? []
  const paid = orders.filter(o => PAID_STATUSES.includes(o.status as never))
  if (l.mode === 'cada_x') {
    const spent = paid.reduce((s, o) => s + Number(o.loyalty_base ?? 0), 0)
    const used = orders.filter(o => o.loyalty_kind === 'cada_x' && Number(o.loyalty_discount) > 0).length
    return { mode: 'cada_x', every: l.every_amount, pct: l.every_pct, ...everyRewards(spent, used, l) }
  }
  const since = now.getTime() - 365 * 86_400_000
  const spent12m = round2(paid.filter(o => o.paid_at && Date.parse(o.paid_at as string) >= since).reduce((s, o) => s + Number(o.loyalty_base ?? 0), 0))
  const t = tierFor(spent12m, l)
  return { mode: 'progressivo', pct: t.pct, spent12m, nextMin: t.next?.min ?? null, nextPct: t.next?.pct ?? null, missing: t.missing }
}

// Pedido virou pago: registra quanto conta para a fidelidade e gera o cashback
export async function onRetailOrderPaid(db: Db, orderId: string, l: LoyaltySettings, now = new Date()): Promise<void> {
  if (!l.enabled) return
  const { data: o } = await db.from('retail_orders').select('id, customer_id, subtotal, discount, loyalty_discount, loyalty_base').eq('id', orderId).maybeSingle()
  if (!o?.customer_id || Number(o.loyalty_base) > 0) return
  const base = round2(Math.max(0, Number(o.subtotal) - Number(o.discount) - Number(o.loyalty_discount)))
  const patch: Record<string, unknown> = { loyalty_base: base }
  if (l.mode === 'cashback' && base > 0) {
    const credit = round2(base * l.cashback_pct / 100)
    if (credit > 0) {
      const { error } = await db.from('retail_loyalty_entries').insert({
        customer_id: o.customer_id, order_id: orderId, kind: 'credito', amount: credit,
        expires_at: new Date(now.getTime() + l.cashback_days * 86_400_000).toISOString(),
      })
      if (!error) patch.loyalty_earned = credit
    }
  }
  await db.from('retail_orders').update(patch).eq('id', orderId)
}

// Pedido cancelado: some o cashback gerado e volta o que foi usado nele
export async function onRetailOrderCancelled(db: Db, orderId: string): Promise<void> {
  await db.from('retail_loyalty_entries').delete().eq('order_id', orderId)
  await db.from('retail_orders').update({ loyalty_base: 0, loyalty_earned: 0 }).eq('id', orderId)
}

// Média das compras pagas (sugestão para o "ticket médio" da precificação)
export async function averagePaidTicket(db: Db): Promise<{ avg: number; count: number }> {
  const { data } = await db.from('retail_orders').select('subtotal, discount, loyalty_discount').in('status', PAID_STATUSES).order('created_at', { ascending: false }).limit(500)
  const list = (data ?? []).map(o => Number(o.subtotal) - Number(o.discount) - Number(o.loyalty_discount ?? 0)).filter(v => v > 0)
  return { avg: list.length ? round2(list.reduce((s, v) => s + v, 0) / list.length) : 0, count: list.length }
}
