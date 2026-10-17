import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/auth/role'
import { resolveTenantId } from '@/lib/tenant/context'
import { OrganizationSettingsForm } from '@/components/settings/organization-settings-form'
import { SettingsSubpage } from '@/components/settings/settings-subpage'

export const dynamic = 'force-dynamic'

export default async function EmpresaSettingsPage() {
  const profile = await getCurrentProfile()
  if (profile?.role !== 'admin') redirect('/')
  const supabase = await createClient()
  const { data: s } = await supabase.from('organization_settings')
    .select('name, company_name, company_cnpj, logo_storage_path, proposal_header_text, proposal_footer_text, proposal_brand_color, assistant_monthly_budget_usd')
    .eq('tenant_id', await resolveTenantId()).maybeSingle()
  let logo: string | null = null
  if (s?.logo_storage_path) logo = s.logo_storage_path.startsWith('http') ? s.logo_storage_path : supabase.storage.from('public-assets').getPublicUrl(s.logo_storage_path).data.publicUrl
  return (
    <SettingsSubpage title="Dados da empresa" description="Logo, nome, CNPJ e o visual das propostas.">
      <OrganizationSettingsForm show="empresa"
        currentName={s?.name ?? 'CRM'} currentCompanyName={s?.company_name ?? ''} currentCompanyCnpj={s?.company_cnpj ?? ''}
        currentLogoPath={logo} currentHeaderText={s?.proposal_header_text ?? ''} currentFooterText={s?.proposal_footer_text ?? ''}
        currentBrandColor={s?.proposal_brand_color ?? '#1B556B'} currentAssistantBudget={s?.assistant_monthly_budget_usd ?? 10} />
    </SettingsSubpage>
  )
}
