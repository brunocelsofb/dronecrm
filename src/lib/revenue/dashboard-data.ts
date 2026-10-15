// Busca os dados do Painel gerencial da empresa atual (sempre filtrado por tenant).

import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { resolveTenantId } from '@/lib/tenant/context'
import type { DashboardInput } from './dashboard-compute'

const PAGE = 1000

// PostgREST devolve no máximo 1000 linhas por chamada: pagina até o fim
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: any; error: any }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

function chunk<T>(arr: T[], size: number): T[][] {
  const res: T[][] = []
  for (let i = 0; i < arr.length; i += size) res.push(arr.slice(i, i + size))
  return res
}

export async function loadDashboardInput(year: number, tenantIdArg?: string): Promise<DashboardInput> {
  const tenantId = tenantIdArg ?? await resolveTenantId()
  const db = await createScopedAdmin(tenantId)

  const [pipelines, runs, contracts, billing, renewals, goals, tags, stages, nps, tickets, leads, org] = await Promise.all([
    fetchAll<DashboardInput['pipelines'][number]>((a, b) => db.from('pipelines').select('id, name, type').order('id').range(a, b)),
    fetchAll<DashboardInput['runs'][number]>((a, b) => db.from('pipeline_runs')
      .select('id, contract_id, pipeline_id, stage_id, status, value, started_at, ended_at, stage_entered_at, tag_id, report_file_name')
      .order('id').range(a, b)),
    fetchAll<DashboardInput['contracts'][number]>((a, b) => db.from('contracts')
      .select('id, client_name, process_number, billing_type, monthly_value, valid_from').order('id').range(a, b)),
    fetchAll<DashboardInput['billing'][number]>((a, b) => db.from('billing_records')
      .select('contract_id, year, month, amount, measured_amount, glosa_amount, glosa_reason, discount_amount, discount_reason, contract_value, status').order('id').range(a, b)),
    fetchAll<DashboardInput['renewals'][number]>((a, b) => db.from('contract_renewals')
      .select('contract_id, renewed_at, previous_value, new_value').order('id').range(a, b)),
    fetchAll<DashboardInput['goals'][number]>((a, b) => db.from('monthly_goals').select('year, month, target_value').eq('year', year).order('month').range(a, b)),
    fetchAll<DashboardInput['tags'][number]>((a, b) => db.from('tags').select('id, name, color').order('id').range(a, b)),
    fetchAll<DashboardInput['stages'][number]>((a, b) => db.from('stages').select('id, name, sla_days').order('id').range(a, b)),
    fetchAll<DashboardInput['nps'][number]>((a, b) => db.from('nps_surveys').select('score, answered_at').not('score', 'is', null).order('id').range(a, b)),
    fetchAll<DashboardInput['tickets'][number]>((a, b) => db.from('tickets').select('status, sla_due_at').order('id').range(a, b)),
    fetchAll<DashboardInput['leads'][number]>((a, b) => db.from('leads').select('created_at, status').order('id').range(a, b)),
    db.from('organization_settings').select('measurement_due_day').limit(1).maybeSingle(),
  ])

  // Tags por contrato (tabela sem tenant_id: filtra pelos contratos da empresa)
  const contractTag: Record<string, string> = {}
  for (const ids of chunk(contracts.map(c => c.id), 200)) {
    const { data, error } = await db.from('contract_tags').select('contract_id, tag_id').in('contract_id', ids)
    if (error) throw new Error(error.message)
    for (const row of data ?? []) if (!contractTag[row.contract_id]) contractTag[row.contract_id] = row.tag_id
  }

  // Numéricos chegam como texto do Postgres
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))
  return {
    pipelines,
    runs: runs.map(r => ({ ...r, value: num(r.value) })),
    contracts: contracts.map(c => ({ ...c, monthly_value: num(c.monthly_value) })),
    billing: billing.map(b => ({ ...b, amount: Number(b.amount) || 0, measured_amount: num(b.measured_amount), glosa_amount: num(b.glosa_amount), discount_amount: num(b.discount_amount), contract_value: num(b.contract_value) })),
    renewals: renewals.map(r => ({ ...r, previous_value: num(r.previous_value), new_value: Number(r.new_value) })),
    goals: goals.map(g => ({ ...g, target_value: Number(g.target_value) || 0 })),
    tags,
    contractTag,
    stages,
    nps: nps.map(n => ({ ...n, score: num(n.score) })),
    tickets,
    leads,
    measurementDueDay: Number(org.data?.measurement_due_day ?? 5),
    now: new Date(),
  }
}
