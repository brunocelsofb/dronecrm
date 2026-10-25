// Varejo: leitura do histórico do estoque (com peça, variação, pedido e pessoa)
import type { createAdminClient } from '@/lib/supabase/admin'
import type { StockMove } from '@/components/retail/stock-history'

type Db = ReturnType<typeof createAdminClient>

export async function loadStockMoves(db: Db, opts: { productId?: string | null; kind?: string | null; limit?: number } = {}): Promise<StockMove[]> {
  let q = db.from('retail_stock_movements')
    .select('id, created_at, kind, delta, before_qty, after_qty, note, order_id, product_id, created_by, retail_products(code, name), retail_product_variants(color, size, sku)')
    .order('created_at', { ascending: false }).limit(opts.limit ?? 200)
  if (opts.productId) q = q.eq('product_id', opts.productId)
  if (opts.kind) q = q.eq('kind', opts.kind)
  const { data } = await q
  type R = { id: string; created_at: string; kind: string; delta: number; before_qty: number; after_qty: number; note: string | null; order_id: string | null; product_id: string | null; created_by: string | null
    retail_products: { code: string; name: string } | null; retail_product_variants: { color: string | null; size: string | null; sku: string } | null }
  const rows = (data ?? []) as unknown as R[]
  const orderIds = [...new Set(rows.map(r => r.order_id).filter(Boolean))] as string[]
  const userIds = [...new Set(rows.map(r => r.created_by).filter(Boolean))] as string[]
  const [{ data: orders }, { data: people }] = await Promise.all([
    orderIds.length ? db.from('retail_orders').select('id, number').in('id', orderIds) : Promise.resolve({ data: [] as { id: string; number: number }[] }),
    userIds.length ? db.from('profiles').select('id, full_name').in('id', userIds) : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
  ])
  const num = new Map((orders ?? []).map(o => [o.id as string, o.number as number]))
  const who = new Map((people ?? []).map(p => [p.id as string, (p.full_name as string | null) ?? null]))
  return rows.map(r => ({
    id: r.id, created_at: r.created_at, kind: r.kind, delta: r.delta, before_qty: r.before_qty, after_qty: r.after_qty, note: r.note,
    order_id: r.order_id, order_number: r.order_id ? num.get(r.order_id) ?? null : null, product_id: r.product_id,
    product: r.retail_products ? `${r.retail_products.code} · ${r.retail_products.name}` : null,
    variant: r.retail_product_variants ? ([r.retail_product_variants.color, r.retail_product_variants.size].filter(Boolean).join(' / ') || r.retail_product_variants.sku) : null,
    by: r.created_by ? who.get(r.created_by) ?? null : null,
  }))
}
