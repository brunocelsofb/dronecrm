import { redirect } from 'next/navigation'
import { getUserAccess } from '@/lib/auth/access'
import { getCompanySettings } from '@/lib/actions/company-settings'
import { SettingsSubpage } from '@/components/settings/settings-subpage'
import { CompanySettingsForm } from '@/components/settings/company-settings-form'

export const dynamic = 'force-dynamic'

export default async function CompanySegmentsPage() {
  const access = await getUserAccess()
  if (!access?.isAdmin) redirect('/settings')
  return (
    <SettingsSubpage title="Segmentos e inativos" description="Segmentos usados no cadastro de empresas e a regra que define quem é cliente inativo.">
      <CompanySettingsForm initial={await getCompanySettings()} />
    </SettingsSubpage>
  )
}
