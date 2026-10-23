// ─── Varejo: preço e fidelidade (servidor, sem ser ação) ──────────────────────
// Lê as configurações da empresa e calcula a fidelidade de uma cliente a partir
// do banco. As contas ficam em margin.ts (testadas). Usado por telas e ações.

import type { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { PAID_STATUSES } from '@/lib/retail/customers'
import {
  readLoyalty, readPricing, readTaxRegimes, readPaymentConditions, pricingAt, cashbackBalance, everyRewards, tierFor, round2,
  type LoyaltySettings, type PricingSettings, type CashbackEntry, type TaxRegime, type PaymentConditions,
} from '@/lib/retail/margin'

type Db = Awaited<ReturnType<typeof createScopedAdmin>>

// pricing já vem com o imposto do regime em vigor hoje; para uma venda antiga use pricingAt(pricing, regimes, data)
// rbt12 = vendas pagas no Drone nos últimos 12 meses (peças, sem frete): base do Simples e do limite do MEI
export type RetailPricingConfig = { pricing: PricingSettings; loyalty: LoyaltySettings; regimes: TaxRegime[]; rbt12: number; conditions: PaymentConditions; raw: Record<string, unknown> }

export async function loadPricingConfig(db: Db, tenantId: string): Promise<RetailPricingConfig> {
  const { data } = await db.from('organization_settings').select('retail_settings').eq('tenant_id', tenantId).maybeSingle()
  const raw = ((data as { retail_settings?: Record<string, unknown> } | null)?.retail_settings ?? {}) as Record<string, unknown>
  const regimes = readTaxRegimes(raw.tax_regimes)
  const rbt12 = regimes.length ? await revenue12m(db) : 0
  return { pricing: pricingAt(readPricing(raw.pricing), regimes, new Date(), rbt12), loyalty: readLoyalty(raw.loyalty), regimes, rbt12, conditions: readPaymentConditions(raw.payment_conditions), raw }
}

// Vendas pagas nos últimos 12 meses (valor das peças menos descontos, sem frete)
export async function revenue12m(db: Db, now = new Date()): Promise<number> {
  const from = new Date(now.getTime() - 365 * 86_400_000).toISOString()
  let total = 0
  for (let i = 0; ; i += 1000) {
    const { data } = await db.from('retail_orders').select('subtotal, discount, loyalty_discount').in('status', PAID_STATUSES).gte('paid_at', from).range(i, i + 999)
    for (const o of data ?? []) total += Math.max(0, Number(o.subtotal) - Number(o.discount) - Number(o.loyalty_discount ?? 0))
    if (!data || data.length < 1000) break
  }
  return round2(total)
}

export type CustomerLoyalty =
  | { mode: 'off' }
  | { mode: 'cashback'; balance: number; nextExpiry: string | null; expiringAmount: number; pct: number }
  | { mode: 'cada_x'; available: number; progress: number; missing: number; every: number; unit: LoyaltySettings['every_unit']; pct: number }
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
  let q = db.from('retail_orders').select('id, status, loyalty_base, loyalty_kind, loyalty_discount, paid_at, created_at, retail_order_items(qty)').eq('customer_id', customerId).neq('status', 'cancelado')
  if (exceptOrderId) q = q.neq('id', exceptOrderId)
  const { data } = await q.limit(5000)
  const orders = (data ?? []) as unknown as { id: string; status: string; loyalty_base: number; loyalty_kind: string | null; loyalty_discount: number; paid_at: string | null; created_at: string; retail_order_items: { qty: number }[] }[]
  // compras que contam: pagas enquanto a fidelidade estava ligada (loyalty_base > 0)
  const paid = orders.filter(o => PAID_STATUSES.includes(o.status as never) && Number(o.loyalty_base ?? 0) > 0)
  if (l.mode === 'cada_x') {
    const from = l.changed_at ?? ''
    const inRule = (iso: string | null) => !from || (iso ?? '') >= from
    const counted = paid.filter(o => inRule(o.paid_at))
    const value = l.every_unit === 'pecas' ? counted.reduce((s, o) => s + o.retail_order_items.reduce((t, i) => t + i.qty, 0), 0)
      : l.every_unit === 'compras' ? counted.length
      : counted.reduce((s, o) => s + Number(o.loyalty_base ?? 0), 0)
    const used = orders.filter(o => o.loyalty_kind === 'cada_x' && Number(o.loyalty_discount) > 0 && inRule(o.created_at)).length
    return { mode: 'cada_x', every: l.every_amount, unit: l.every_unit, pct: l.every_pct, ...everyRewards(value, used, l) }
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
export async function averagePaidTicket(db: Db): Promise<{ avg: number; count: number; avgPieces: number }> {
  const { data } = await db.from('retail_orders').select('subtotal, discount, loyalty_discount, retail_order_items(qty)').in('status', PAID_STATUSES).order('created_at', { ascending: false }).limit(500)
  const rows = (data ?? []) as unknown as { subtotal: number; discount: number; loyalty_discount: number | null; retail_order_items: { qty: number }[] }[]
  const list = rows.map(o => Number(o.subtotal) - Number(o.discount) - Number(o.loyalty_discount ?? 0)).filter(v => v > 0)
  const pieces = rows.map(o => o.retail_order_items.reduce((s, i) => s + i.qty, 0)).filter(v => v > 0)
  return {
    avg: list.length ? round2(list.reduce((s, v) => s + v, 0) / list.length) : 0, count: list.length,
    avgPieces: pieces.length ? Math.round((pieces.reduce((s, v) => s + v, 0) / pieces.length) * 10) / 10 : 0,
  }
}
