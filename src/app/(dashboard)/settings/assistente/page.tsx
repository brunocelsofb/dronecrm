import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/auth/role'
import { resolveTenantId } from '@/lib/tenant/context'
import { OrganizationSettingsForm } from '@/components/settings/organization-settings-form'
import { SettingsSubpage } from '@/components/settings/settings-subpage'

export const dynamic = 'force-dynamic'

export default async function AssistenteSettingsPage() {
  const profile = await getCurrentProfile()
  if (profile?.role !== 'admin') redirect('/')
  const supabase = await createClient()
  const { data: s } = await supabase.from('organization_settings').select('assistant_monthly_budget_usd').eq('tenant_id', await resolveTenantId()).maybeSingle()
  return (
    <SettingsSubpage title="Assistente Théo" description="Limite de gasto mensal do assistente de IA do CRM.">
      <OrganizationSettingsForm show="orcamento" currentName="" currentCompanyName="" currentCompanyCnpj="" currentLogoPath={null}
        currentHeaderText="" currentFooterText="" currentBrandColor="#1B556B" currentAssistantBudget={s?.assistant_monthly_budget_usd ?? 10} />
    </SettingsSubpage>
  )
}
