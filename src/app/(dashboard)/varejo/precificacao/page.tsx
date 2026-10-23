import { redirect } from 'next/navigation'
import { hasFeature } from '@/lib/auth/access'
import { requireTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { getSupportSession } from '@/lib/tenant/support'
import { averagePaidTicket, loadPricingConfig } from '@/lib/retail/loyalty-server'
import { PricingForm, type PricedProduct } from '@/components/retail/pricing-form'

export const dynamic = 'force-dynamic'

export default async function RetailPricingPage() {
  const access = await hasFeature('varejo')
  if (!access) redirect('/')
  const tenantId = await requireTenantId()
  const db = await createScopedAdmin(tenantId)
  const [{ pricing, loyalty, regimes }, avg, support, { data: prods }] = await Promise.all([
    loadPricingConfig(db, tenantId), averagePaidTicket(db), getSupportSession(),
    db.from('retail_products').select('id, code, name, cost_price, price, promo_price, status, retail_product_variants(stock, active)').neq('status', 'arquivado').order('name').limit(5000),
  ])
  const products: PricedProduct[] = ((prods ?? []) as unknown as { id: string; code: string; name: string; cost_price: number | null; price: number; promo_price: number | null; status: string; retail_product_variants: { stock: number; active: boolean }[] }[])
    .map(p => ({
      id: p.id, code: p.code, name: p.name, status: p.status,
      cost: p.cost_price === null || p.cost_price === undefined ? null : Number(p.cost_price),
      price: Number(p.price), promo: p.promo_price === null || p.promo_price === undefined ? null : Number(p.promo_price),
      stock: p.retail_product_variants.filter(v => v.active).reduce((s, v) => s + v.stock, 0),
    }))
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Preço e fidelidade</h1>
        <p className="mt-1 text-sm text-gray-500">Suas peças com a conta completa, os impostos da loja, a margem que você quer e a fidelidade. Toda peça cadastrada entra aqui sozinha.</p>
      </div>
      <PricingForm pricing={pricing} loyalty={loyalty} regimes={regimes} products={products} avgTicket={avg.avg} avgCount={avg.count} avgPieces={avg.avgPieces} readOnly={!access.isAdmin || !!support} />
    </div>
  )
}
