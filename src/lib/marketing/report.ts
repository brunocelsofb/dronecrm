// ─── Resultados de marketing por campanha e por canal ────────────────────────
// Liga cada ação ao dinheiro: investimento → leads → oportunidades → ganhos →
// FATURADO (mesma regra da meta: faturado de verdade; antes do fluxo de
// faturamento, o apurado). Cálculo puro (sem banco) para poder testar.
//
// Período: conta o que ACONTECEU no período — leads criados, oportunidades
// criadas, ganhos fechados, faturado e investimento do período (padrão dos
// relatórios de CRM). Atribuição: campanha da oportunidade; senão a do lead
// de origem; sem campanha, o canal deduzido do link/formulário do lead.

import { inferChannel } from './tracking'

export type MkCampaign = { id: string; name: string; channel: string; audience: string; status: string; utm_campaign: string; budget: number | null }
export type MkCost = { campaign_id: string; year: number; month: number; amount: number }
export type MkLead = { id: string; campaign_id: string | null; created_at: string; status: string | null; source: string | null; utm_source: string | null; utm_medium: string | null; gclid: string | null; fbclid: string | null }
export type MkOpp = { id: string; campaign_id: string | null; lead_id: string | null; created_at: string }
export type MkWon = { contract_id: string; value: number; ended_at: string }

export type MkPeriod = { year: number; month: number | null }

export type MkRow = {
  key: string
  campaignId: string | null
  name: string
  channel: string
  audience: string | null
  status: string | null
  invest: number
  leads: number
  opps: number
  won: number
  wonValue: number
  invoiced: number
  cpl: number | null        // custo por lead
  cpo: number | null        // custo por oportunidade
  cac: number | null        // custo por cliente ganho
  roas: number | null       // faturado ÷ investimento (vezes)
  leadToOpp: number | null  // %
  oppToWon: number | null   // %
}

const r2 = (v: number) => Math.round(v * 100) / 100

function inPeriod(iso: string | null | undefined, p: MkPeriod): boolean {
  if (!iso) return false
  // Datas do banco em UTC; período no horário de Brasília (UTC−3)
  const d = new Date(new Date(iso).getTime() - 3 * 3600_000)
  if (d.getUTCFullYear() !== p.year) return false
  return p.month === null || d.getUTCMonth() + 1 === p.month
}

export function computeMarketing(input: {
  campaigns: MkCampaign[]
  costs: MkCost[]
  leads: MkLead[]
  opps: MkOpp[]
  won: MkWon[]
  invoicedByContract: Record<string, number> // faturado do período por oportunidade/contrato
  period: MkPeriod
}) {
  const { period } = input
  const campaignById = new Map(input.campaigns.map(c => [c.id, c]))
  const leadById = new Map(input.leads.map(l => [l.id, l]))
  const rows = new Map<string, MkRow>()

  const keyOfLead = (l: MkLead): string => (l.campaign_id && campaignById.has(l.campaign_id) ? `c:${l.campaign_id}` : `ch:${inferChannel(l)}`)
  const rowFor = (key: string): MkRow => {
    let r = rows.get(key)
    if (!r) {
      const camp = key.startsWith('c:') ? campaignById.get(key.slice(2)) ?? null : null
      r = {
        key, campaignId: camp?.id ?? null, name: camp?.name ?? '', channel: camp?.channel ?? key.slice(3),
        audience: camp?.audience ?? null, status: camp?.status ?? null,
        invest: 0, leads: 0, opps: 0, won: 0, wonValue: 0, invoiced: 0,
        cpl: null, cpo: null, cac: null, roas: null, leadToOpp: null, oppToWon: null,
      }
      rows.set(key, r)
    }
    return r
  }

  // Campanhas do cadastro sempre aparecem (mesmo zeradas), menos as encerradas sem nada
  for (const c of input.campaigns) if (c.status !== 'encerrada') rowFor(`c:${c.id}`)

  for (const cost of input.costs) {
    if (cost.year !== period.year || (period.month !== null && cost.month !== period.month)) continue
    if (!campaignById.has(cost.campaign_id)) continue
    rowFor(`c:${cost.campaign_id}`).invest += Number(cost.amount) || 0
  }

  for (const l of input.leads) if (inPeriod(l.created_at, period)) rowFor(keyOfLead(l)).leads++

  // Origem de cada oportunidade
  const oppKey = new Map<string, string>()
  let unattributed = 0
  for (const o of input.opps) {
    let key: string | null = null
    if (o.campaign_id && campaignById.has(o.campaign_id)) key = `c:${o.campaign_id}`
    else if (o.lead_id && leadById.has(o.lead_id)) key = keyOfLead(leadById.get(o.lead_id)!)
    if (!key) { if (inPeriod(o.created_at, period)) unattributed++; continue }
    oppKey.set(o.id, key)
    if (inPeriod(o.created_at, period)) rowFor(key).opps++
  }

  const wonContracts = new Set<string>()
  for (const w of input.won) {
    const key = oppKey.get(w.contract_id)
    if (!key || !inPeriod(w.ended_at, period)) continue
    const r = rowFor(key)
    if (!wonContracts.has(`${key}|${w.contract_id}`)) { r.won++; wonContracts.add(`${key}|${w.contract_id}`) }
    r.wonValue += Number(w.value) || 0
  }

  for (const [contractId, amount] of Object.entries(input.invoicedByContract)) {
    const key = oppKey.get(contractId)
    if (key) rowFor(key).invoiced += Number(amount) || 0
  }

  const finish = (r: MkRow): MkRow => {
    const invest = r2(r.invest)
    return {
      ...r, invest, wonValue: r2(r.wonValue), invoiced: r2(r.invoiced),
      cpl: invest > 0 && r.leads > 0 ? r2(invest / r.leads) : null,
      cpo: invest > 0 && r.opps > 0 ? r2(invest / r.opps) : null,
      cac: invest > 0 && r.won > 0 ? r2(invest / r.won) : null,
      roas: invest > 0 ? Math.round((r.invoiced / invest) * 10) / 10 : null,
      leadToOpp: r.leads > 0 ? Math.round((r.opps / r.leads) * 1000) / 10 : null,
      oppToWon: r.opps > 0 ? Math.round((r.won / r.opps) * 1000) / 10 : null,
    }
  }

  const all = [...rows.values()].map(finish)
  const campaignRows = all.filter(r => r.campaignId).sort((a, b) => b.invoiced - a.invoiced || b.leads - a.leads || a.name.localeCompare(b.name))
  const channelOnlyRows = all.filter(r => !r.campaignId && (r.leads || r.opps || r.won || r.invoiced)).sort((a, b) => b.leads - a.leads)

  // Por canal (campanhas + leads sem campanha)
  const byChannel = new Map<string, MkRow>()
  for (const r of all) {
    const k = r.channel || 'outro'
    const c = byChannel.get(k) ?? { ...r, key: `ch:${k}`, campaignId: null, name: '', channel: k, audience: null, status: null, invest: 0, leads: 0, opps: 0, won: 0, wonValue: 0, invoiced: 0 }
    if (c !== r) { c.invest += r.invest; c.leads += r.leads; c.opps += r.opps; c.won += r.won; c.wonValue += r.wonValue; c.invoiced += r.invoiced }
    byChannel.set(k, c)
  }
  const channels = [...byChannel.values()].map(finish).filter(r => r.invest || r.leads || r.opps || r.won || r.invoiced).sort((a, b) => b.invoiced - a.invoiced || b.leads - a.leads)

  const sum = (k: 'invest' | 'leads' | 'opps' | 'won' | 'wonValue' | 'invoiced') => all.reduce((s, r) => s + r[k], 0)
  const totals = finish({
    key: 'total', campaignId: null, name: 'Total', channel: '', audience: null, status: null,
    invest: sum('invest'), leads: sum('leads'), opps: sum('opps'), won: sum('won'), wonValue: sum('wonValue'), invoiced: sum('invoiced'),
    cpl: null, cpo: null, cac: null, roas: null, leadToOpp: null, oppToWon: null,
  })

  return { campaignRows, channelOnlyRows, channels, totals, unattributedOpps: unattributed }
}
