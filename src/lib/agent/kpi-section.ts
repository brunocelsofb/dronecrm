// Seção fixa do briefing com os indicadores do mês (mesmos números do Painel gerencial).
// Montada direto dos dados — o modelo de IA não recalcula nada.

import { fmtPct, fmtNum1 } from '@/lib/format'
import { loadDashboardInput } from '@/lib/revenue/dashboard-data'
import { computeDashboard } from '@/lib/revenue/dashboard-compute'
import { MONTHS_LONG } from '@/lib/revenue/measurement'

const brl = (v: number | null) => (v === null ? '—' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v))
const pc = (v: number | null) => fmtPct(v)

export async function buildKpiSection(tenantId: string): Promise<string> {
  const now = new Date(Date.now() - 3 * 60 * 60 * 1000)
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth() + 1
  const d = computeDashboard(await loadDashboardInput(year, tenantId), year, month)
  const rv = d.revenue, h = d.hunter, f = d.farmer
  const lines: string[] = []
  lines.push(`📊 *Indicadores de ${MONTHS_LONG[month - 1]}* (até hoje)`)
  lines.push(`Em contrato: ${brl(rv.contractPotential)} · apurado: ${brl(rv.contractBilled)} · enviado p/ faturamento: ${brl(rv.contractSent)} · faturado: ${brl(rv.contractInvoiced)} (${pc(rv.contractInvoicedPct)})${rv.contractGap > 0 ? ` · diferença ${brl(rv.contractGap)} (recorrência não confirmada ${brl(rv.gapParts.pendingConfirm.total)}, medições pendentes ${brl(rv.gapParts.pending.total)}, descontos ${brl(rv.gapParts.discounts.total)}, glosas ${brl(rv.gapParts.glosas.total)}, não enviado ${brl(rv.gapParts.notSent.total)}, aguardando faturamento ${brl(rv.gapParts.notInvoiced.total)})` : ''}`)
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
