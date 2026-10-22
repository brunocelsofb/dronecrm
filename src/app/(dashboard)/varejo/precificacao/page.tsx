import { redirect } from 'next/navigation'
import { hasFeature } from '@/lib/auth/access'
import { requireTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { getSupportSession } from '@/lib/tenant/support'
import { averagePaidTicket, loadPricingConfig } from '@/lib/retail/loyalty-server'
import { PricingForm } from '@/components/retail/pricing-form'

export const dynamic = 'force-dynamic'

export default async function RetailPricingPage() {
  const access = await hasFeature('varejo')
  if (!access) redirect('/')
  const tenantId = await requireTenantId()
  const db = await createScopedAdmin(tenantId)
  const [{ pricing, loyalty }, avg, support] = await Promise.all([loadPricingConfig(db, tenantId), averagePaidTicket(db), getSupportSession()])
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Preço e fidelidade</h1>
        <p className="mt-1 text-sm text-gray-500">Os custos da loja e a margem que você quer. Com isso, cada peça ganha um preço de referência e cada pedido mostra quanto dá para negociar.</p>
      </div>
      <PricingForm pricing={pricing} loyalty={loyalty} avgTicket={avg.avg} avgCount={avg.count} readOnly={!access.isAdmin || !!support} />
    </div>
  )
}
