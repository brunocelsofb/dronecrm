import { redirect } from 'next/navigation'
import { getUserAccess } from '@/lib/auth/access'
import { resolveTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { resolveActionPlanSettings } from '@/lib/quality/action-plan'
import { SettingsSubpage } from '@/components/settings/settings-subpage'
import { ActionPlanSettingsForm } from '@/components/settings/action-plan-settings-form'

export const dynamic = 'force-dynamic'

export default async function ActionPlanSettingsPage() {
  const access = await getUserAccess()
  if (!access?.isAdmin) redirect('/settings')
  const tenantId = await resolveTenantId()
  const db = await createScopedAdmin(tenantId)
  const { data } = await db.from('organization_settings').select('action_plan_settings').eq('tenant_id', tenantId).maybeSingle()
  return (
    <SettingsSubpage title="Plano de ação" description="Ferramentas da qualidade usadas nas tratativas (PDCA) da aba Plano de Ação.">
      <ActionPlanSettingsForm initial={resolveActionPlanSettings(data?.action_plan_settings)} />
    </SettingsSubpage>
  )
}
