// ─── Painel do Varejo: dados (servidor) ───────────────────────────────────────
// Calcula só os blocos escolhidos. Contas em margin.ts e dashboard-calc.ts (testadas).

import type { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { PAID_STATUSES, birthdayInfo, customerStatus, mergeStats, type BirthdayInfo } from '@/lib/retail/customers'
import { loadCustomerOrderStats, loadRetailSettings } from '@/lib/retail/queries'
import { loadPricingConfig } from '@/lib/retail/loyalty-server'
import { analyzeOrder, pricingAt, readPricing, cashbackBalance, everyRewards, tierFor, round2, type CashbackEntry, type LoyaltySettings, type OrderLine, type PricingSettings } from '@/lib/retail/margin'
import { breakEvenProgress, changePct, monthBounds, summarizeSales, type BreakEvenProgress, type MonthBounds, type SalesSummary } from '@/lib/retail/dashboard-calc'
import type { DashboardBlockId } from '@/lib/retail/dashboard-blocks'

type Db = Awaited<ReturnType<typeof createScopedAdmin>>

type ItemRow = { qty: number; unit_price: number; unit_cost: number | null; name: string; product_id: string | null; retail_products: { cost_price: number | null } | null }
type PaidRow = { id: string; discount: number; loyalty_discount: number; paid_at: string | null; retail_order_items: ItemRow[] }

const n = (v: unknown) => Number(v ?? 0)
const lineOf = (i: ItemRow): OrderLine => ({
  qty: i.qty, unit_price: n(i.unit_price),
  unit_cost: i.unit_cost !== null && i.unit_cost !== undefined ? n(i.unit_cost) : i.retail_products?.cost_price !== null && i.retail_products?.cost_price !== undefined ? n(i.retail_products.cost_price) : null,
})

async function paidBetween(db: Db, from: string, to: string): Promise<PaidRow[]> {
  const out: PaidRow[] = []
  for (let i = 0; ; i += 1000) {
    const { data } = await db.from('retail_orders')
      .select('id, discount, loyalty_discount, paid_at, retail_order_items(qty, unit_price, unit_cost, name, product_id, retail_products(cost_price))')
      .in('status', PAID_STATUSES).gte('paid_at', from).lt('paid_at', to).order('paid_at').range(i, i + 999)
    out.push(...((data ?? []) as unknown as PaidRow[]))
    if (!data || data.length < 1000) return out
  }
}

export type RetailDashboard = {
  month: MonthBounds
  pricing: PricingSettings
  loyalty: LoyaltySettings
  sales?: SalesSummary & { prevRevenue: number; prevOrders: number; revenueChange: number | null }
  breakEven?: BreakEvenProgress | null
  open?: { count: number; list: { id: string; number: number; status: string; total: number; created_at: string; customer: string | null }[] }
  birthdays?: { id: string; name: string; phone: string | null; info: BirthdayInfo }[]
  inactive?: { count: number; list: { id: string; name: string; phone: string | null; total: number; last: string | null; optin: boolean }[] }
  topSellers?: { name: string; qty: number; revenue: number }[]
  stock?: { soldOut: { id: string; name: string; code: string }[]; lowCombos: number }
  loyaltyStats?:
    | { mode: 'off' }
    | { mode: 'cashback'; earned: number; used: number; expiringCustomers: number; expiringAmount: number; withBalance: number }
    | { mode: 'cada_x' | 'progressivo'; withBenefit: number; given: number }
  noCost?: { count: number; list: { id: string; name: string; code: string }[] }
}

export async function loadRetailDashboard(db: Db, tenantId: string, blocks: DashboardBlockId[], now = new Date()): Promise<RetailDashboard> {
  const has = (b: DashboardBlockId) => blocks.includes(b)
  const month = monthBounds(now)
  const { pricing, loyalty, regimes, rbt12, raw } = await loadPricingConfig(db, tenantId)
  const basePricing = readPricing(raw.pricing)
  const out: RetailDashboard = { month, pricing, loyalty }
  const tasks: Promise<void>[] = []

  if (has('vendas') || has('ganho') || has('equilibrio') || has('mais_vendidas')) {
    tasks.push((async () => {
      // Mês anterior até o mesmo ponto do mês (comparação justa)
      const elapsed = now.getTime() - Date.parse(month.start)
      const prevTo = new Date(Math.min(Date.parse(month.prevStart) + elapsed, Date.parse(month.start))).toISOString()
      const [cur, prev] = await Promise.all([paidBetween(db, month.start, month.end), has('vendas') ? paidBetween(db, month.prevStart, prevTo) : Promise.resolve([])])
      // cada venda com o imposto do regime em vigor na data em que foi paga
      const analyze = (o: PaidRow) => analyzeOrder(o.retail_order_items.map(lineOf), n(o.discount) + n(o.loyalty_discount), pricingAt(basePricing, regimes, o.paid_at ?? now, rbt12), loyalty)
      const s = summarizeSales(cur.map(analyze))
      const p = summarizeSales(prev.map(analyze))
      out.sales = { ...s, prevRevenue: p.revenue, prevOrders: p.orders, revenueChange: changePct(s.revenue, p.revenue) }
      out.breakEven = breakEvenProgress(pricing.fixed_monthly, s, pricing.target_margin_pct, month.day, month.days)
      const top = new Map<string, { name: string; qty: number; revenue: number }>()
      for (const o of cur) for (const i of o.retail_order_items) {
        const k = i.product_id ?? i.name
        const t = top.get(k) ?? { name: i.name, qty: 0, revenue: 0 }
        t.qty += i.qty; t.revenue = round2(t.revenue + i.qty * n(i.unit_price)); top.set(k, t)
      }
      out.topSellers = [...top.values()].sort((a, b) => b.qty - a.qty || b.revenue - a.revenue).slice(0, 5)
    })())
  }

  if (has('pedidos_abertos')) {
    tasks.push((async () => {
      const open = ['carrinho', 'enviado_atendimento', 'aguardando_pagamento']
      const [{ count }, { data }] = await Promise.all([
        db.from('retail_orders').select('id', { count: 'exact', head: true }).in('status', open),
        db.from('retail_orders').select('id, number, status, total, created_at, retail_customers(name)').in('status', open).order('created_at', { ascending: true }).limit(6),
      ])
      out.open = {
        count: count ?? 0,
        list: (data ?? []).map(o => ({ id: o.id as string, number: o.number as number, status: o.status as string, total: n(o.total), created_at: o.created_at as string, customer: (o.retail_customers as unknown as { name: string } | null)?.name ?? null })),
      }
    })())
  }

  if (has('aniversarios') || has('inativas')) {
    tasks.push((async () => {
      const { data } = await db.from('retail_customers').select('id, name, phone, birth_date, whatsapp_optin, legacy_last_purchase_at, legacy_total, legacy_orders').limit(10000)
      const rows = data ?? []
      if (has('aniversarios')) {
        out.birthdays = rows.map(c => ({ id: c.id as string, name: c.name as string, phone: c.phone as string | null, info: birthdayInfo(c.birth_date as string | null, now) }))
          .filter((c): c is { id: string; name: string; phone: string | null; info: BirthdayInfo } => !!c.info && c.info.daysUntil <= 7)
          .sort((a, b) => a.info.daysUntil - b.info.daysUntil).slice(0, 8)
      }
      if (has('inativas')) {
        const [settings, stats] = await Promise.all([loadRetailSettings(db, tenantId), loadCustomerOrderStats(db)])
        const inactive = rows.map(c => {
          const s = mergeStats(stats.get(c.id as string), c as never)
          return { id: c.id as string, name: c.name as string, phone: c.phone as string | null, total: round2(s.total), last: s.last, optin: c.whatsapp_optin === true, status: customerStatus(s.last, settings.inactive_days, now) }
        }).filter(c => c.status === 'inativa')
        out.inactive = { count: inactive.length, list: inactive.sort((a, b) => b.total - a.total).slice(0, 5).map(({ status: _s, ...c }) => c) }
      }
    })())
  }

  if (has('estoque') || has('sem_custo')) {
    tasks.push((async () => {
      const { data } = await db.from('retail_products').select('id, name, code, cost_price, retail_product_variants(stock, active)').eq('status', 'publicado').order('name').limit(5000)
      const rows = (data ?? []) as unknown as { id: string; name: string; code: string; cost_price: number | null; retail_product_variants: { stock: number; active: boolean }[] }[]
      if (has('estoque')) {
        const soldOut = rows.filter(p => p.retail_product_variants.filter(v => v.active).reduce((s, v) => s + v.stock, 0) === 0)
        const low = rows.reduce((s, p) => s + p.retail_product_variants.filter(v => v.active && v.stock === 1).length, 0)
        out.stock = { soldOut: soldOut.slice(0, 6).map(({ id, name, code }) => ({ id, name, code })), lowCombos: low }
      }
      if (has('sem_custo')) {
        const noCost = rows.filter(p => p.cost_price === null || p.cost_price === undefined)
        out.noCost = { count: noCost.length, list: noCost.slice(0, 5).map(({ id, name, code }) => ({ id, name, code })) }
      }
    })())
  }

  if (has('fidelidade')) {
    tasks.push((async () => {
      if (!loyalty.enabled) { out.loyaltyStats = { mode: 'off' }; return }
      if (loyalty.mode === 'cashback') {
        const { data } = await db.from('retail_loyalty_entries').select('customer_id, kind, amount, created_at, expires_at').limit(20000)
        const rows = data ?? []
        const inMonth = (iso: string) => iso >= month.start && iso < month.end
        const byCustomer = new Map<string, CashbackEntry[]>()
        for (const e of rows) {
          const list = byCustomer.get(e.customer_id as string) ?? []
          list.push({ kind: e.kind as 'credito' | 'uso', amount: n(e.amount), at: e.created_at as string, expires_at: e.expires_at as string | null })
          byCustomer.set(e.customer_id as string, list)
        }
        const soon = now.getTime() + 15 * 86_400_000
        let withBalance = 0, expiringCustomers = 0, expiringAmount = 0
        for (const list of byCustomer.values()) {
          const b = cashbackBalance(list, now)
          if (b.balance > 0) withBalance++
          if (b.balance > 0 && b.nextExpiry && Date.parse(b.nextExpiry) <= soon) { expiringCustomers++; expiringAmount += b.expiringAmount }
        }
        out.loyaltyStats = {
          mode: 'cashback',
          earned: round2(rows.filter(e => e.kind === 'credito' && inMonth(e.created_at as string)).reduce((s, e) => s + n(e.amount), 0)),
          used: round2(rows.filter(e => e.kind === 'uso' && inMonth(e.created_at as string)).reduce((s, e) => s + n(e.amount), 0)),
          withBalance, expiringCustomers, expiringAmount: round2(expiringAmount),
        }
        return
      }
      const { data } = await db.from('retail_orders').select('customer_id, status, loyalty_base, loyalty_kind, loyalty_discount, paid_at, created_at, retail_order_items(qty)').neq('status', 'cancelado').not('customer_id', 'is', null).limit(20000)
      const rows = (data ?? []) as unknown as { customer_id: string; status: string; loyalty_base: number; loyalty_kind: string | null; loyalty_discount: number; paid_at: string | null; created_at: string; retail_order_items: { qty: number }[] }[]
      // mesma contagem da ficha da cliente (loyalty-server.customerLoyalty)
      const per = new Map<string, { counted: number; spent12: number; used: number }>()
      const since = now.getTime() - 365 * 86_400_000
      const from = loyalty.changed_at ?? ''
      let given = 0
      for (const o of rows) {
        const c = per.get(o.customer_id) ?? { counted: 0, spent12: 0, used: 0 }
        const counts = PAID_STATUSES.includes(o.status as never) && n(o.loyalty_base) > 0
        if (counts && o.paid_at && Date.parse(o.paid_at) >= since) c.spent12 += n(o.loyalty_base)
        if (counts && (!from || (o.paid_at ?? '') >= from)) {
          c.counted += loyalty.every_unit === 'pecas' ? o.retail_order_items.reduce((s, i) => s + i.qty, 0) : loyalty.every_unit === 'compras' ? 1 : n(o.loyalty_base)
        }
        if (o.loyalty_kind === loyalty.mode && n(o.loyalty_discount) > 0) {
          if (loyalty.mode === 'cada_x' && (!from || o.created_at >= from)) c.used++
          if (o.paid_at && o.paid_at >= month.start && o.paid_at < month.end) given += n(o.loyalty_discount)
        }
        per.set(o.customer_id, c)
      }
      const withBenefit = [...per.values()].filter(c => loyalty.mode === 'cada_x' ? everyRewards(c.counted, c.used, loyalty).available > 0 : tierFor(c.spent12, loyalty).pct > 0).length
      out.loyaltyStats = { mode: loyalty.mode, withBenefit, given: round2(given) }
    })())
  }

  await Promise.all(tasks)
  return out
}
