import { redirect } from 'next/navigation'
import { getUserAccess } from '@/lib/auth/access'
import { resolveTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { resolveRulerSettings } from '@/lib/agent/renewal-ruler'
import { SettingsSubpage } from '@/components/settings/settings-subpage'
import { RenewalRulerForm } from '@/components/settings/renewal-ruler-form'

export const dynamic = 'force-dynamic'

export default async function RenewalRulerSettingsPage() {
  const access = await getUserAccess()
  if (!access?.isAdmin) redirect('/settings')
  const tenantId = await resolveTenantId()
  const db = await createScopedAdmin(tenantId)
  const { data: org } = await db.from('organization_settings').select('copilot_settings, company_name').eq('tenant_id', tenantId).maybeSingle()
  return (
    <SettingsSubpage
      title="Régua de renovação"
      description="Passos internos da renovação depois que o cliente recebe o aviso. Cada passo tem prazo, avisa as áreas por e-mail e é marcado como feito na oportunidade."
    >
      <RenewalRulerForm initial={resolveRulerSettings(org?.copilot_settings)} companyName={(org?.company_name as string | null) ?? ''} />
    </SettingsSubpage>
  )
}
