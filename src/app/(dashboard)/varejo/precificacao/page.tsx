import Link from 'next/link'
import { redirect } from 'next/navigation'
import { hasFeature } from '@/lib/auth/access'
import { requireTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { getSupportSession } from '@/lib/tenant/support'
import { averagePaidTicket, loadPricingConfig, revenue12m } from '@/lib/retail/loyalty-server'
import { PricingForm, type PricedProduct } from '@/components/retail/pricing-form'
import { readPricing } from '@/lib/retail/margin'
import { readPaymentSetup } from '@/lib/retail/payments'
import { PaymentSetupForm } from '@/components/retail/payment-setup-form'
import { decryptSecret } from '@/lib/ai/tenant-key'

export const dynamic = 'force-dynamic'

export default async function RetailPricingPage() {
  const access = await hasFeature('varejo')
  if (!access) redirect('/')
  const tenantId = await requireTenantId()
  const db = await createScopedAdmin(tenantId)
  const [{ loyalty, regimes, rbt12, conditions, raw }, avg, support, { data: prods }, sold12] = await Promise.all([
    loadPricingConfig(db, tenantId), averagePaidTicket(db), getSupportSession(),
    db.from('retail_products').select('id, code, name, cost_price, price, promo_price, status, retail_product_variants(stock, active)').neq('status', 'arquivado').order('name').limit(5000),
    revenue12m(db),
  ])
  const products: PricedProduct[] = ((prods ?? []) as unknown as { id: string; code: string; name: string; cost_price: number | null; price: number; promo_price: number | null; status: string; retail_product_variants: { stock: number; active: boolean }[] }[])
    .map(p => ({
      id: p.id, code: p.code, name: p.name, status: p.status,
      cost: p.cost_price === null || p.cost_price === undefined ? null : Number(p.cost_price),
      price: Number(p.price), promo: p.promo_price === null || p.promo_price === undefined ? null : Number(p.promo_price),
      stock: p.retail_product_variants.filter(v => v.active).reduce((s, v) => s + v.stock, 0),
    }))
  // Recebimento: só o final da chave do Mercado Pago aparece na tela
  const { data: keys } = await db.from('organization_settings').select('retail_mp_token_enc, retail_ip_token_enc').eq('tenant_id', tenantId).maybeSingle()
  let mpLast4: string | null = null
  if (keys?.retail_mp_token_enc) { try { mpLast4 = decryptSecret(String(keys.retail_mp_token_enc)).slice(-4) } catch { mpLast4 = '????' } }
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <Link href="/varejo/configurar" className="block text-sm text-brand-700 hover:underline">← Configurar loja</Link>
        <h1 className="text-xl font-semibold text-gray-900">Custos e preço</h1>
        <p className="mt-1 text-sm text-gray-500">Suas peças com a conta completa, os impostos da loja, a margem que você quer e a fidelidade. Toda peça cadastrada entra aqui sozinha.</p>
      </div>
      <PricingForm pricing={readPricing(raw.pricing)} loyalty={loyalty} regimes={regimes} rbt12={rbt12} conditions={conditions} products={products} avgTicket={avg.avg} avgCount={avg.count} avgPieces={avg.avgPieces} monthlyAvg={Math.round((sold12 / 12) * 100) / 100} readOnly={!access.isAdmin || !!support} />
      <PaymentSetupForm setup={readPaymentSetup(raw.payments)} mpLast4={mpLast4} ipTokenSet={!!keys?.retail_ip_token_enc} readOnly={!access.isAdmin || !!support} />
    </div>
  )
}
