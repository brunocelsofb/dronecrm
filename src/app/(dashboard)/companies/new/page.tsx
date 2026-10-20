import { getCompanySettings } from '@/lib/actions/company-settings'
import { NewCompanyForm } from '@/components/companies/new-company-form'

export const dynamic = 'force-dynamic'

export default async function NewCompanyPage() {
  const { segments } = await getCompanySettings()
  return <NewCompanyForm segments={segments} />
}
