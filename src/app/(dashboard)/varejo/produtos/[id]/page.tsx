import Link from 'next/link'
import { StockHistory } from '@/components/retail/stock-history'
import { loadStockMoves } from '@/lib/retail/stock-server'
import { notFound, redirect } from 'next/navigation'
import { hasFeature } from '@/lib/auth/access'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { isProductStatus, type RetailProduct } from '@/lib/retail/products'
import { ProductForm } from '@/components/retail/product-form'
import { requireTenantId } from '@/lib/tenant/context'
import { loadPricingConfig } from '@/lib/retail/loyalty-server'
import { readOccasions } from '@/lib/retail/storefront'
import { readPhotoMeta } from '@/lib/retail/photo-colors'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function RetailProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ criada?: string }> }) {
  if (!(await hasFeature('varejo'))) redirect('/')
  const { id } = await params
  const { criada } = await searchParams
  let product: RetailProduct | null = null
  let categories: string[] = []
  const tenantId = await requireTenantId()
  const db = await createScopedAdmin(tenantId)
  const [{ pricing, loyalty }, { data: sf }] = await Promise.all([
    loadPricingConfig(db, tenantId),
    db.from('retail_storefronts').select('occasions').eq('tenant_id', tenantId).maybeSingle(),
  ])
  const occasions = readOccasions(sf?.occasions)
  const { data: cats } = await db.from('retail_products').select('category')
  categories = [...new Set((cats ?? []).map(c => c.category as string | null).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'pt-BR'))

  if (id !== 'nova') {
    if (!UUID.test(id)) notFound()
    const { data } = await db.from('retail_products')
      .select('id, code, name, category, description, composition, care, measures, price, promo_price, cost_price, status, photos, photo_meta, weight_g, occasions, retail_product_variants(id, sku, color, size, stock, active)')
      .eq('id', id).maybeSingle()
    if (!data) notFound()
    const d = data as unknown as Omit<RetailProduct, 'variants'> & { retail_product_variants: RetailProduct['variants'] }
    product = {
      ...d,
      price: d.price === null ? null : Number(d.price),
      promo_price: d.promo_price === null ? null : Number(d.promo_price),
      cost_price: d.cost_price === null || d.cost_price === undefined ? null : Number(d.cost_price),
      status: isProductStatus(d.status) ? d.status : 'rascunho',
      photos: d.photos ?? [],
      photo_meta: readPhotoMeta((d as { photo_meta?: unknown }).photo_meta, d.photos ?? [], [...new Set((d.retail_product_variants ?? []).filter(v => v.active && v.color).map(v => v.color as string))]),
      variants: [...(d.retail_product_variants ?? [])].sort((a, b) => `${a.color ?? ''}${a.size ?? ''}`.localeCompare(`${b.color ?? ''}${b.size ?? ''}`, 'pt-BR')),
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/varejo/produtos" className="text-sm text-brand-700 hover:underline">← Produtos</Link>
      <h1 className="text-xl font-semibold text-gray-900">{product ? product.name : 'Nova peça'}</h1>
      {!product && <p className="text-sm text-gray-500">São 4 passos rápidos: dados, quantidades, fotos e vitrine. Campos com * são obrigatórios.</p>}
      <ProductForm product={product} categories={categories} justCreated={!!product && criada === '1'} pricing={pricing} loyalty={loyalty} occasions={occasions} />
      {product && (
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold text-gray-900">Histórico do estoque</h2>
            <Link href="/varejo/estoque" className="text-xs text-brand-700 hover:underline">Ver de todas as peças</Link>
          </div>
          <StockHistory moves={await loadStockMoves(db, { productId: product.id, limit: 30 })} showProduct={false} />
        </section>
      )}
    </div>
  )
}
