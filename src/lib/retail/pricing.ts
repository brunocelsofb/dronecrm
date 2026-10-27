// Preço dos itens de um pedido, sempre com os valores do banco.
// Usado pelo pedido manual (tela) e pela vitrine (etapa 3). Não é ação do servidor.
// O custo (unit_cost) é gravado no item para a margem do pedido; nunca sai na vitrine.
import type { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { variantPrice } from '@/lib/retail/products'

type Db = Awaited<ReturnType<typeof createScopedAdmin>>

export const round2 = (n: number) => Math.round(n * 100) / 100
export type OrderItemInput = { variant_id: string; qty: number }

type PricedItem = {
  product_id: string; variant_id: string; code: string; name: string; sku: string; color: string | null; size: string | null
  qty: number; unit_price: number; total: number; unit_cost: number | null
}

// Preço e dados de cada item vindos do banco (variação ativa, peça não arquivada)
// opts.storefront: vitrine pública — só peças publicadas e com saldo
export async function priceItems(db: Db, items: OrderItemInput[], opts: { storefront?: boolean } = {}): Promise<{ ok: true; items: PricedItem[]; subtotal: number } | { ok: false; error: string }> {
  const merged = new Map<string, number>()
  for (const it of items ?? []) {
    const qty = Math.floor(Number(it?.qty))
    if (!it?.variant_id || !Number.isFinite(qty) || qty <= 0 || qty > 99) return { ok: false, error: 'Quantidade inválida.' }
    merged.set(it.variant_id, (merged.get(it.variant_id) ?? 0) + qty)
  }
  if (!merged.size) return { ok: false, error: 'Adicione ao menos uma peça.' }
  if (merged.size > 50) return { ok: false, error: 'Máximo de 50 itens por pedido.' }
  const { data } = await db.from('retail_product_variants')
    .select('id, sku, color, size, active, stock, price, promo_price, product_id, retail_products(id, code, name, price, promo_price, status, cost_price)')
    .in('id', [...merged.keys()])
  type V = { id: string; sku: string; color: string | null; size: string | null; active: boolean; stock: number; price: number | null; promo_price: number | null; product_id: string; retail_products: { id: string; code: string; name: string; price: number | null; promo_price: number | null; status: string; cost_price: number | null } | null }
  const byId = new Map(((data ?? []) as unknown as V[]).map(v => [v.id, v]))
  const out: PricedItem[] = []
  for (const [variantId, qty] of merged) {
    const v = byId.get(variantId)
    const p = v?.retail_products
    if (!v || !p) return { ok: false, error: 'Uma das peças não existe mais.' }
    if (!v.active || p.status === 'arquivado' || (opts.storefront && p.status !== 'publicado')) return { ok: false, error: `${p.name} (${[v.color, v.size].filter(Boolean).join(' / ')}) não está disponível.` }
    if (opts.storefront && Number(v.stock) < qty) return { ok: false, error: Number(v.stock) > 0 ? `${p.name} (${[v.color, v.size].filter(Boolean).join(' / ')}): só temos ${v.stock}.` : `${p.name} (${[v.color, v.size].filter(Boolean).join(' / ')}) esgotou.` }
    // Preço da cor (se tiver), senão o da peça
    const vp = variantPrice({ price: p.price, promo_price: p.promo_price }, v)
    if (vp.final === null) return { ok: false, error: `${p.name} está sem preço. Defina o preço em Produtos antes de vender.` }
    const unit = round2(vp.final)
    out.push({ product_id: p.id, variant_id: v.id, code: p.code, name: p.name, sku: v.sku, color: v.color, size: v.size, qty, unit_price: unit, total: round2(unit * qty), unit_cost: p.cost_price === null || p.cost_price === undefined ? null : Number(p.cost_price) })
  }
  return { ok: true, items: out, subtotal: round2(out.reduce((s, i) => s + i.total, 0)) }
}

