import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/auth/role'
import { resolveTenantId } from '@/lib/tenant/context'
import { createAdminClient } from '@/lib/supabase/admin'
import { ResetCrmCard } from '@/components/settings/reset-crm-card'
import { SettingsSubpage } from '@/components/settings/settings-subpage'

export const dynamic = 'force-dynamic'

export default async function ResetarSettingsPage() {
  const profile = await getCurrentProfile()
  if (profile?.role !== 'admin') redirect('/')
  const { data: t } = await createAdminClient().from('tenants').select('name').eq('id', await resolveTenantId()).maybeSingle()
  return (
    <SettingsSubpage title="Zona de risco" description="Apaga os dados da empresa no CRM. Usuários, licença e plano continuam.">
      <ResetCrmCard tenantName={(t?.name as string | undefined) ?? ''} />
    </SettingsSubpage>
  )
}
