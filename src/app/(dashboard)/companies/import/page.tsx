import Link from 'next/link'
import { CsvImportForm } from '@/components/companies/csv-import-form'
import { getCompanySettings } from '@/lib/actions/company-settings'

export default async function ImportCompaniesPage() {
  const { segments } = await getCompanySettings()
  return (
    <div className="max-w-2xl space-y-6">
      <Link href="/companies" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-brand-700">
        ← Voltar para Empresas
      </Link>
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Importar Empresas (CSV)</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Cadastre em massa as empresas que já fazem parte da sua base de clientes.
        </p>
      </div>
      <CsvImportForm segments={segments} />
    </div>
  )
}
