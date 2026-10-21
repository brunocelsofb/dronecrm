// Consultas do Varejo usadas pelas telas (servidor). Sempre com o cliente da empresa.
import type { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { PAID_STATUSES, readRetailSettings, type CustomerStats, type RetailSettings } from '@/lib/retail/customers'

type Db = Awaited<ReturnType<typeof createScopedAdmin>>

// Compras pagas por cliente (pago, enviado, entregue)
export async function loadCustomerOrderStats(db: Db, customerIds?: string[]): Promise<Map<string, CustomerStats>> {
  const out = new Map<string, CustomerStats>()
  for (let from = 0; ; from += 1000) {
    let q = db.from('retail_orders').select('customer_id, total, paid_at, created_at').in('status', PAID_STATUSES).not('customer_id', 'is', null)
    if (customerIds) q = q.in('customer_id', customerIds)
    const { data } = await q.order('created_at').range(from, from + 999)
    for (const o of data ?? []) {
      const id = o.customer_id as string
      const when = ((o.paid_at as string | null) ?? (o.created_at as string)).slice(0, 10)
      const s = out.get(id) ?? { orders: 0, total: 0, first: null, last: null }
      s.orders++; s.total += Number(o.total ?? 0)
      if (!s.first || when < s.first) s.first = when
      if (!s.last || when > s.last) s.last = when
      out.set(id, s)
    }
    if (!data || data.length < 1000) break
  }
  return out
}

export async function loadRetailSettings(db: Db, tenantId: string): Promise<RetailSettings> {
  const { data } = await db.from('organization_settings').select('retail_settings').eq('tenant_id', tenantId).maybeSingle()
  return readRetailSettings((data as { retail_settings?: unknown } | null)?.retail_settings)
}
