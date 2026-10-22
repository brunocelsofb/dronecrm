import Link from 'next/link'
import { redirect } from 'next/navigation'
import { hasFeature } from '@/lib/auth/access'
import { requireTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { getSupportSession } from '@/lib/tenant/support'
import { loadRetailDashboard } from '@/lib/retail/dashboard'
import { readDashboardBlocks } from '@/lib/retail/dashboard-blocks'
import { RetailDashboardView } from '@/components/retail/dashboard-view'
import { DashboardPicker } from '@/components/retail/dashboard-picker'

export const dynamic = 'force-dynamic'

export default async function RetailDashboardPage() {
  const access = await hasFeature('varejo')
  if (!access) redirect('/')
  const tenantId = await requireTenantId()
  const db = await createScopedAdmin(tenantId)
  const { data: org } = await db.from('organization_settings').select('company_name, name, retail_settings').eq('tenant_id', tenantId).maybeSingle()
  const blocks = readDashboardBlocks((org?.retail_settings as Record<string, unknown> | null)?.dashboard)
  const storeName = ((org?.company_name as string | null) || (org?.name as string | null) || 'loja').trim()
  const [d, support] = await Promise.all([loadRetailDashboard(db, tenantId, blocks), getSupportSession()])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Painel da loja</h1>
          <p className="mt-1 text-sm text-gray-500">Como está {d.month.label}: vendas, ganho, o que falta para pagar as contas e quem chamar hoje.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {access.isAdmin && !support && <DashboardPicker current={blocks} />}
          <Link href="/varejo/pedidos/novo" className="rounded-lg bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800">Novo pedido</Link>
        </div>
      </div>
      <RetailDashboardView d={d} blocks={blocks} storeName={storeName} />
    </div>
  )
}
