// Seção fixa do briefing com os indicadores do mês (mesmos números do Painel gerencial).
// Montada direto dos dados — o modelo de IA não recalcula nada.

import { loadDashboardInput } from '@/lib/revenue/dashboard-data'
import { computeDashboard } from '@/lib/revenue/dashboard-compute'
import { MONTHS_LONG } from '@/lib/revenue/measurement'

const brl = (v: number | null) => (v === null ? '—' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v))
const pc = (v: number | null) => (v === null ? '—' : `${v.toLocaleString('pt-BR')}%`)

export async function buildKpiSection(tenantId: string): Promise<string> {
  const now = new Date(Date.now() - 3 * 60 * 60 * 1000)
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth() + 1
  const d = computeDashboard(await loadDashboardInput(year, tenantId), year, month)
  const rv = d.revenue, h = d.hunter, f = d.farmer
  const lines: string[] = []
  lines.push(`📊 *Indicadores de ${MONTHS_LONG[month - 1]}* (até hoje)`)
  lines.push(`Receita: ${brl(rv.total)}${rv.goal > 0 ? ` — ${pc(rv.goalPct)} da meta (${brl(rv.goal)})` : ' — sem meta cadastrada'}`)
  lines.push(`  $ Recorrente ${brl(rv.recurringTotal)} · 📏 Medição ${brl(rv.meteredTotal)} · Avulso ${brl(rv.avulsoTotal)}`)
  lines.push('')
  lines.push(`🎯 *Hunter*: conversão ${pc(h.conversion)} (${h.won.length}/${h.closed}) · novo recorrente ${brl(h.newMrr)} · ticket médio ${brl(h.ticket)} · avulso ${brl(h.avulso.value)}`)
  if (h.stale.length) lines.push(`  ${h.stale.length} oportunidade(s) parada(s) além do prazo da etapa`)
  lines.push('')
  lines.push(`🌱 *Farmer*: carteira ${brl(f.mrr)}/mês (${f.active.length} contratos)`)
  lines.push(`  Churn: ${f.churned.length}${f.churnMrr > 0 ? ` — perdemos ${brl(f.churnMrr)}/mês` : ''} · Renovações: ${f.renewed.length}${f.renewed.length ? ` (${brl(f.renewPrev)} → ${brl(f.renewNew)}, ▲${f.renewUp} ▼${f.renewDown})` : ''} · taxa de renovação ${pc(f.renewalRate)}`)
  if (rv.measurePending.length || rv.lostPotential > 0) {
    lines.push(`  Medição: ${rv.measurePending.length} pendente(s)${rv.lostPotential > 0 ? ` · perdemos ${brl(rv.lostPotential)} do potencial` : ''}`)
  }
  return lines.join('\n')
}
