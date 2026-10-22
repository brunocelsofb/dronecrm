import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { hasFeature } from '@/lib/auth/access'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { isProductStatus, type RetailProduct } from '@/lib/retail/products'
import { ProductForm } from '@/components/retail/product-form'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function RetailProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ criada?: string }> }) {
  if (!(await hasFeature('varejo'))) redirect('/')
  const { id } = await params
  const { criada } = await searchParams
  let product: RetailProduct | null = null
  let categories: string[] = []
  const db = await createScopedAdmin()
  const { data: cats } = await db.from('retail_products').select('category')
  categories = [...new Set((cats ?? []).map(c => c.category as string | null).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'pt-BR'))

  if (id !== 'nova') {
    if (!UUID.test(id)) notFound()
    const { data } = await db.from('retail_products')
      .select('id, code, name, category, description, composition, care, measures, price, promo_price, status, photos, weight_g, retail_product_variants(id, sku, color, size, stock, active)')
      .eq('id', id).maybeSingle()
    if (!data) notFound()
    const d = data as unknown as Omit<RetailProduct, 'variants'> & { retail_product_variants: RetailProduct['variants'] }
    product = {
      ...d,
      price: Number(d.price),
      promo_price: d.promo_price === null ? null : Number(d.promo_price),
      status: isProductStatus(d.status) ? d.status : 'rascunho',
      photos: d.photos ?? [],
      variants: [...(d.retail_product_variants ?? [])].sort((a, b) => `${a.color ?? ''}${a.size ?? ''}`.localeCompare(`${b.color ?? ''}${b.size ?? ''}`, 'pt-BR')),
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/varejo/produtos" className="text-sm text-brand-700 hover:underline">← Produtos</Link>
      <h1 className="text-xl font-semibold text-gray-900">{product ? product.name : 'Nova peça'}</h1>
      {!product && <p className="text-sm text-gray-500">São 4 passos rápidos: dados, quantidades, fotos e vitrine. Campos com * são obrigatórios.</p>}
      <ProductForm product={product} categories={categories} justCreated={!!product && criada === '1'} />
    </div>
  )
}
