// Dados das campanhas: clientes com última compra, total e categorias; resultado por campanha.
import type { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { PAID_STATUSES } from '@/lib/retail/customers'
import type { CampaignCustomer, CampaignOrder } from '@/lib/retail/campaigns'

type Db = Awaited<ReturnType<typeof createScopedAdmin>>
const PAID = new Set<string>(PAID_STATUSES)

export async function loadCampaignCustomers(db: Db): Promise<CampaignCustomer[]> {
  const [{ data: cs }, { data: os }] = await Promise.all([
    db.from('retail_customers').select('id, name, phone, whatsapp_optin, birth_date, legacy_last_purchase_at, legacy_total').limit(20000),
    db.from('retail_orders').select('customer_id, status, paid_at, created_at, total, shipping, retail_order_items(product_id, retail_products(category))').not('customer_id', 'is', null).limit(20000),
  ])
  type O = { customer_id: string; status: string; paid_at: string | null; created_at: string; total: number; shipping: number | null; retail_order_items: { retail_products: { category: string | null } | null }[] }
  const stats = new Map<string, { last: string | null; total: number; cats: Set<string> }>()
  for (const o of (os ?? []) as unknown as O[]) {
    if (!PAID.has(o.status)) continue
    const s = stats.get(o.customer_id) ?? { last: null, total: 0, cats: new Set<string>() }
    const when = o.paid_at ?? o.created_at
    if (!s.last || when > s.last) s.last = when
    s.total += Number(o.total ?? 0) - Number(o.shipping ?? 0)
    for (const it of o.retail_order_items ?? []) if (it.retail_products?.category) s.cats.add(it.retail_products.category)
    stats.set(o.customer_id, s)
  }
  type C = { id: string; name: string; phone: string | null; whatsapp_optin: boolean | null; birth_date: string | null; legacy_last_purchase_at: string | null; legacy_total: number | null }
  return ((cs ?? []) as C[]).map(c => {
    const s = stats.get(c.id)
    const last = [s?.last ?? null, c.legacy_last_purchase_at].filter((x): x is string => !!x).sort().pop() ?? null
    return { id: c.id, name: c.name, phone: c.phone, optin: c.whatsapp_optin === true, birth_date: c.birth_date, last_purchase: last, total: (s?.total ?? 0) + Number(c.legacy_total ?? 0), categories: [...(s?.cats ?? [])] }
  })
}

// Pedidos marcados com cada campanha (pago ou não), com o custo das peças quando conhecido
export async function loadCampaignOrders(db: Db, campaignIds: string[]): Promise<Record<string, CampaignOrder[]>> {
  const out: Record<string, CampaignOrder[]> = {}
  if (!campaignIds.length) return out
  const { data } = await db.from('retail_orders').select('campaign_id, status, total, shipping, retail_order_items(qty, unit_cost)').in('campaign_id', campaignIds).limit(20000)
  type O = { campaign_id: string; status: string; total: number; shipping: number | null; retail_order_items: { qty: number; unit_cost: number | null }[] }
  for (const o of (data ?? []) as unknown as O[]) {
    const items = o.retail_order_items ?? []
    const cost = items.length && items.every(i => i.unit_cost !== null) ? items.reduce((t, i) => t + Number(i.unit_cost) * Number(i.qty), 0) : null
    if (o.status === 'cancelado') continue
    ;(out[o.campaign_id] ??= []).push({ total: Number(o.total ?? 0), shipping: Number(o.shipping ?? 0), cost, paid: PAID.has(o.status) })
  }
  return out
}

export async function storefrontLinkBase(db: Db): Promise<{ base: string | null; slug: string | null; domain: string | null; store: string }> {
  const { data: sf } = await db.from('retail_storefronts').select('slug, domains, title').maybeSingle()
  const domains = (sf?.domains ?? []) as string[]
  return { base: (process.env.NEXT_PUBLIC_STOREFRONT_URL ?? '').replace(/\/+$/, '') || null, slug: (sf?.slug as string | null) ?? null, domain: domains[0] ?? null, store: (sf?.title as string | null) ?? '' }
}
