import Link from 'next/link'
import { redirect } from 'next/navigation'
import { hasFeature } from '@/lib/auth/access'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { effectivePrice } from '@/lib/retail/products'
import { OrderBuilder, type CatalogItem, type CustomerOption } from '@/components/retail/order-builder'

export const dynamic = 'force-dynamic'

type P = { id: string; code: string; name: string; price: number; promo_price: number | null; status: string; retail_product_variants: { id: string; sku: string; color: string | null; size: string | null; stock: number; active: boolean }[] }

export default async function NewRetailOrderPage({ searchParams }: { searchParams: Promise<{ cliente?: string }> }) {
  if (!(await hasFeature('varejo'))) redirect('/')
  const { cliente } = await searchParams
  const db = await createScopedAdmin()
  const [{ data: products }, { data: customers }] = await Promise.all([
    db.from('retail_products').select('id, code, name, price, promo_price, status, retail_product_variants(id, sku, color, size, stock, active)').neq('status', 'arquivado').order('name'),
    db.from('retail_customers').select('id, name, phone').order('name').limit(5000),
  ])
  const catalog: CatalogItem[] = ((products ?? []) as unknown as P[]).flatMap(p =>
    (p.retail_product_variants ?? []).filter(v => v.active).map(v => ({
      variant_id: v.id, label: `${p.name} · ${[v.color, v.size].filter(Boolean).join(' / ') || v.sku}`, code: p.code, sku: v.sku,
      price: effectivePrice({ price: Number(p.price), promo_price: p.promo_price === null ? null : Number(p.promo_price) }), stock: v.stock,
    })))
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/varejo/pedidos" className="text-sm text-brand-700 hover:underline">← Pedidos</Link>
      <h1 className="text-xl font-semibold text-gray-900">Novo pedido</h1>
      <OrderBuilder catalog={catalog} customers={(customers ?? []) as CustomerOption[]} initialCustomerId={cliente ?? null} />
    </div>
  )
}
