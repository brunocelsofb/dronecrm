// Carrega os dados da tela Marketing (empresa atual) e calcula os resultados.
// O faturado vem do mesmo cálculo do Painel/Financeiro (computeDashboard),
// para bater com a meta.

import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { loadDashboardInput, fetchAll } from '@/lib/revenue/dashboard-data'
import { computeDashboard } from '@/lib/revenue/dashboard-compute'
import { loadMeta, loadMetaMonths } from '@/lib/ads/meta-data'
import { metaMonthlyCosts } from '@/lib/ads/meta'
import { computeMarketing, type MkCampaign, type MkCost, type MkLead, type MkOpp, type MkPeriod } from './report'

export type CampaignFull = MkCampaign & {
  meta_campaign_ids: string[] | null
  objective: string | null; start_date: string | null; end_date: string | null; owner_id: string | null; notes: string | null; created_at: string
}

export async function loadMarketing(tenantId: string, period: MkPeriod, now: { year: number; month: number }) {
  const db = await createScopedAdmin(tenantId)
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))

  const [campaigns, costs, leads, opps, dash] = await Promise.all([
    fetchAll<CampaignFull>((a, b) => db.from('marketing_campaigns')
      .select('id, name, channel, audience, status, utm_campaign, meta_campaign_ids, budget, objective, start_date, end_date, owner_id, notes, created_at')
      .order('created_at', { ascending: false }).range(a, b)),
    fetchAll<MkCost>((a, b) => db.from('marketing_campaign_costs').select('campaign_id, year, month, amount').order('id').range(a, b)),
    fetchAll<MkLead>((a, b) => db.from('leads')
      .select('id, campaign_id, created_at, status, source, utm_source, utm_medium, gclid, fbclid')
      .or('entry_type.is.null,entry_type.eq.inbound').order('id').range(a, b)),  // marketing mede só o inbound
    fetchAll<MkOpp>((a, b) => db.from('contracts').select('id, campaign_id, lead_id, created_at').order('id').range(a, b)),
    loadDashboardInput(period.year, tenantId),
  ])

  // Gasto do Meta (anúncios ligados à campanha) entra no investimento de cada mês, somado ao lançado à mão
  const meta = await loadMeta(db)
  const metaCosts = metaMonthlyCosts(meta.stats, await loadMetaMonths(db, meta.conn?.adAccountId ?? null), campaigns)

  const salesTypes = new Set(['vendas', 'servico_avulso'])
  const typeOf = new Map(dash.pipelines.map(p => [p.id, p.type]))
  const won = dash.runs
    .filter(r => r.status === 'won' && r.ended_at && salesTypes.has(typeOf.get(r.pipeline_id) ?? ''))
    .map(r => ({ contract_id: r.contract_id, value: Number(r.value) || 0, ended_at: r.ended_at as string }))

  // Faturado por contrato no período (meses já abertos do ano)
  const lastMonth = period.year < now.year ? 12 : period.year === now.year ? now.month : 0
  const months = period.month !== null ? (period.month <= lastMonth ? [period.month] : []) : Array.from({ length: lastMonth }, (_, i) => i + 1)
  const invoicedByContract: Record<string, number> = {}
  for (const m of months) {
    const d = computeDashboard(dash, period.year, m)
    for (const row of d.revenue.finRows) {
      const v = row.state === 'anterior' ? row.apurado ?? 0 : row.state === 'faturado' ? row.invoiced ?? 0 : 0
      if (v) invoicedByContract[row.contractId] = (invoicedByContract[row.contractId] ?? 0) + v
    }
  }

  const report = computeMarketing({
    campaigns: campaigns.map(c => ({ ...c, budget: num(c.budget) })),
    costs: [...costs.map(c => ({ ...c, amount: Number(c.amount) || 0 })), ...metaCosts],
    leads, opps, won, invoicedByContract, period,
  })
  return { campaigns: campaigns.map(c => ({ ...c, budget: num(c.budget) })), costs: costs.map(c => ({ ...c, amount: Number(c.amount) || 0 })), metaCosts, metaConnected: !!meta.conn?.adAccountId, report }
}
