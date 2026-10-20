// Carrega os dados da empresa (tenant) e calcula as inativas. Uso só no servidor.

import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { fetchAll } from '@/lib/revenue/dashboard-data'
import { resolveCompanySettings, type CompanySettings } from './settings'
import { computeInactive, type InCompany, type InContract, type InPipeline, type InRun, type InactiveCompany } from './inactive'

export const todayBr = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)

export async function loadInactiveCompanies(tenantId: string): Promise<{ list: InactiveCompany[]; settings: CompanySettings }> {
  const db = await createScopedAdmin(tenantId)
  const [{ data: org }, companies, contracts, pipelines, runs] = await Promise.all([
    db.from('organization_settings').select('company_settings').eq('tenant_id', tenantId).maybeSingle(),
    fetchAll<InCompany>((a, b) => db.from('companies').select('id, name, trade_name, cnpj, segment, status, account_owner_id, owner_id').order('id').range(a, b)),
    fetchAll<InContract>((a, b) => db.from('contracts').select('id, company_id').order('id').range(a, b)),
    fetchAll<InPipeline>((a, b) => db.from('pipelines').select('id, type').order('id').range(a, b)),
    fetchAll<InRun>((a, b) => db.from('pipeline_runs').select('contract_id, pipeline_id, status, ended_at').in('status', ['open', 'won']).order('id').range(a, b)),
  ])
  const settings = resolveCompanySettings((org as { company_settings?: unknown } | null)?.company_settings)
  return { settings, list: computeInactive({ companies, contracts, pipelines, runs, months: settings.inactive_months, today: todayBr() }) }
}
