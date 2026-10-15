import { fmtPct, fmtNum1 } from '@/lib/format'
// ─── Painel gerencial: cálculos (funções puras, sem banco) ───────────────────
// Regras combinadas com o gestor:
//   Receita do mês = Recorrente + Medição + Avulso
//     • Recorrente: contrato ativo no funil de Gestão de Contratos no mês, pelo
//       valor mensal vigente (vale até ser rescindido; vencer sem renovar não tira).
//       O mês da rescisão ainda conta; a partir do mês seguinte, não.
//     • Medição: medição do mês VALIDADA (com relatório ou aprovada pelo admin), líquida de glosa.
//     • Avulso: oportunidade do funil Avulso ganha (Faturamento) no mês.
//   Churn = contrato do funil de Gestão de Contratos marcado como perdido (rescisão) no mês.
//   Renovação = renovações registradas no mês, com valor antes x depois.
// Datas no fuso de Brasília (UTC−3).

export type PipelineRow = { id: string; name: string; type: string }
export type RunRow = {
  id: string; contract_id: string; pipeline_id: string; stage_id: string | null
  status: string; value: number | null
  started_at: string | null; ended_at: string | null; stage_entered_at: string | null
  tag_id: string | null; report_file_name: string | null
}
export type ContractRow = {
  id: string; client_name: string | null; process_number: string | null
  billing_type: string | null; monthly_value: number | null; valid_from: string | null
}
export type BillingRow = {
  contract_id: string; year: number; month: number; amount: number
  measured_amount: number | null; glosa_amount: number | null; contract_value: number | null; status: string
  discount_amount?: number | null; discount_reason?: string | null; glosa_reason?: string | null
}
export type RenewalRow = {
  contract_id: string; renewed_at: string; previous_value: number | null; new_value: number
}
export type GoalRow = { year: number; month: number; target_value: number }
export type TagRow = { id: string; name: string; color: string | null }
export type StageRow = { id: string; name: string; sla_days: number | null }
export type NpsRow = { score: number | null; answered_at: string | null }
export type TicketRow = { status: string; sla_due_at: string | null }
export type LeadRow = { created_at: string; status: string | null }

export type DashboardInput = {
  pipelines: PipelineRow[]
  runs: RunRow[]
  contracts: ContractRow[]
  billing: BillingRow[]
  renewals: RenewalRow[]
  goals: GoalRow[]
  tags: TagRow[]
  contractTag: Record<string, string>   // contract_id → tag_id
  stages: StageRow[]
  nps: NpsRow[]
  tickets: TicketRow[]
  leads: LeadRow[]
  measurementDueDay: number
  now: Date
}

export type ContractLine = { contractId: string; client: string; number: string; value: number; note?: string }

const BR_OFFSET_MS = 3 * 60 * 60 * 1000
const MONTHS_SHORT_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const DEFAULT_SLA = 7

export const r2 = (v: number) => Math.round(v * 100) / 100
const pct = (a: number, b: number): number | null => (b > 0 ? Math.round((a / b) * 1000) / 10 : null)

// Início do mês (00:00 de Brasília) em ms UTC
export function monthStartMs(year: number, month: number): number {
  return Date.UTC(year, month - 1, 1) + BR_OFFSET_MS
}
const ts = (iso: string | null | undefined): number | null => {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : t
}
// "YYYY-MM-DD" → início desse dia em Brasília
const dateMs = (d: string | null | undefined): number | null => {
  if (!d || !/^\d{4}-\d{2}-\d{2}/.test(d)) return null
  const [y, m, day] = d.slice(0, 10).split('-').map(Number)
  return Date.UTC(y, m - 1, day) + BR_OFFSET_MS
}

export type DashboardScope = 'month' | 'year'

// Soma linhas do mesmo contrato (consolidado do ano)
function mergeLines(lists: ContractLine[][]): ContractLine[] {
  const map = new Map<string, ContractLine & { months: number }>()
  for (const list of lists) for (const l of list) {
    const cur = map.get(l.contractId)
    if (cur) { cur.value = r2(cur.value + l.value); cur.months++ }
    else map.set(l.contractId, { ...l, months: 1, note: undefined })
  }
  return [...map.values()]
    .map(({ months, ...l }) => ({ ...l, note: `${months} ${months === 1 ? 'mês' : 'meses'}` }))
    .sort((a, b) => b.value - a.value)
}

// scope 'month': o mês escolhido.
// scope 'year': consolidado dos meses escolhidos do ano (padrão: todos os meses já iniciados),
//               podendo ser meses soltos (ex.: Jan, Mar e Jul) — tudo é calculado só sobre eles.
export function computeDashboard(input: DashboardInput, year: number, month: number, scope: DashboardScope = 'month', selectedMonths?: number[]) {
  const typeOf = new Map(input.pipelines.map(p => [p.id, p.type]))
  const contractById = new Map(input.contracts.map(c => [c.id, c]))
  const tagById = new Map(input.tags.map(t => [t.id, t]))
  const stageById = new Map(input.stages.map(s => [s.id, s]))
  const renewalsByContract = new Map<string, RenewalRow[]>()
  for (const r of [...input.renewals].sort((a, b) => Date.parse(a.renewed_at) - Date.parse(b.renewed_at))) {
    const list = renewalsByContract.get(r.contract_id) ?? []
    list.push(r)
    renewalsByContract.set(r.contract_id, list)
  }
  const gestaoRunsByContract = new Map<string, RunRow[]>()
  for (const r of input.runs) {
    if (typeOf.get(r.pipeline_id) !== 'gestao_contratos') continue
    const list = gestaoRunsByContract.get(r.contract_id) ?? []
    list.push(r)
    gestaoRunsByContract.set(r.contract_id, list)
  }

  const line = (contractId: string, value: number, note?: string): ContractLine => {
    const c = contractById.get(contractId)
    return { contractId, client: c?.client_name ?? '—', number: c?.process_number ?? '', value: r2(value), note }
  }

  // Valor mensal vigente do contrato num instante (considera renovações)
  function valueAt(contractId: string, atMs: number): number {
    const c = contractById.get(contractId)
    const current = Number(c?.monthly_value) || 0
    const list = renewalsByContract.get(contractId)
    if (!list || list.length === 0) return current
    let v: number | null = null
    for (const r of list) if (Date.parse(r.renewed_at) < atMs) v = Number(r.new_value)
    if (v !== null) return v
    const first = list[0]
    return first.previous_value !== null && first.previous_value !== undefined ? Number(first.previous_value) : current
  }

  // Contrato ativo na carteira em algum momento do intervalo [startMs, endMs)
  function activeInRange(contractId: string, startMs: number, endMs: number): boolean {
    const runs = gestaoRunsByContract.get(contractId) ?? []
    const c = contractById.get(contractId)
    const vf = dateMs(c?.valid_from)
    if (vf !== null && vf >= endMs) return false
    return runs.some(r => {
      const s = ts(r.started_at) ?? 0
      const e = ts(r.ended_at)
      if (s >= endMs) return false
      if (e === null) return r.status === 'open'
      return e >= startMs
    })
  }
  // Ativo num instante (para "carteira no início do mês")
  function activeAt(contractId: string, atMs: number): boolean {
    const runs = gestaoRunsByContract.get(contractId) ?? []
    const vf = dateMs(contractById.get(contractId)?.valid_from)
    if (vf !== null && vf > atMs) return false
    return runs.some(r => {
      const s = ts(r.started_at) ?? 0
      const e = ts(r.ended_at)
      if (s > atMs) return false
      if (e === null) return r.status === 'open'
      // ganho (renovado) continua na passagem seguinte; perdido encerra
      return e > atMs
    })
  }

  // ── Receita de um mês ────────────────────────────────────────────────────
  // Em contrato (potencial) x faturado:
  //   recorrente: faturado = valor do contrato − desconto do mês
  //   medição:    faturado = medido − glosa − desconto (só medição validada; pendente = 0)
  // Diferença = descontos + glosas + medido abaixo do potencial + medições pendentes − medido acima
  function revenueOf(y: number, m: number) {
    const start = monthStartMs(y, m)
    const end = m === 12 ? monthStartMs(y + 1, 1) : monthStartMs(y, m + 1)
    const BRLf = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(r2(v))
    const billingOfMonth = input.billing.filter(b => b.year === y && b.month === m)

    const recurring: ContractLine[] = []          // faturado recorrente
    const recurringPotentialL: ContractLine[] = []
    const meteredExpected: ContractLine[] = []    // potencial dos contratos por medição ativos
    const discounts: ContractLine[] = []
    const glosas: ContractLine[] = []
    const below: ContractLine[] = []
    const above: ContractLine[] = []

    for (const contractId of gestaoRunsByContract.keys()) {
      if (!activeInRange(contractId, start, end)) continue
      const c = contractById.get(contractId)
      const v = valueAt(contractId, end)
      if (c?.billing_type === 'metered') { meteredExpected.push(line(contractId, v)); continue }
      recurringPotentialL.push(line(contractId, v))
      const rec = billingOfMonth.find(b => b.contract_id === contractId)
      const disc = Math.min(Math.max(Number(rec?.discount_amount) || 0, 0), v)
      if (disc > 0) discounts.push(line(contractId, disc, rec?.discount_reason ? `desconto: ${rec.discount_reason}` : 'desconto'))
      recurring.push(line(contractId, v - disc, disc > 0 ? `desconto de ${BRLf(disc)} sobre ${BRLf(v)}` : undefined))
    }

    const measured: ContractLine[] = []
    const measurePending: ContractLine[] = []
    let lostPotential = 0
    let glosaTotal = 0
    for (const exp of meteredExpected) {
      const rec = billingOfMonth.find(b => b.contract_id === exp.contractId)
      if (!rec || rec.status !== 'validado') {
        measurePending.push({ ...exp, note: rec ? 'lançada, aguardando aprovação do admin' : 'sem medição lançada' })
        continue
      }
      const potential = Number(rec.contract_value ?? exp.value) || 0
      const net = Number(rec.amount) || 0
      const g = Number(rec.glosa_amount) || 0
      const dsc = Number(rec.discount_amount) || 0
      const meas = rec.measured_amount !== null && rec.measured_amount !== undefined ? Number(rec.measured_amount) : net + g + dsc
      const lost = potential - net > 0 ? potential - net : 0
      lostPotential += lost
      glosaTotal += g
      if (g > 0) glosas.push(line(exp.contractId, g, rec.glosa_reason ? `glosa: ${rec.glosa_reason}` : 'glosa'))
      if (dsc > 0) discounts.push(line(exp.contractId, dsc, rec.discount_reason ? `desconto: ${rec.discount_reason}` : 'desconto'))
      if (potential - meas > 0) below.push(line(exp.contractId, potential - meas, `medido ${BRLf(meas)} de ${BRLf(potential)}`))
      if (meas - potential > 0) above.push(line(exp.contractId, meas - potential, `medido ${BRLf(meas)} acima de ${BRLf(potential)}`))
      measured.push(line(exp.contractId, net, lost > 0 ? `perdemos ${BRLf(lost)} do potencial (${String(pct(lost, potential)).replace('.', ',')}%)` : '100% do potencial'))
    }

    const avulso: ContractLine[] = []
    for (const r of input.runs) {
      if (typeOf.get(r.pipeline_id) !== 'servico_avulso' || r.status !== 'won') continue
      const e = ts(r.ended_at)
      if (e === null || e < start || e >= end) continue
      avulso.push(line(r.contract_id, Number(r.value) || 0, r.report_file_name ? `relatório: ${r.report_file_name}` : 'sem relatório anexado'))
    }

    const sum = (l: ContractLine[]) => r2(l.reduce((s, x) => s + x.value, 0))
    const recurringTotal = sum(recurring)
    const recurringPotential = sum(recurringPotentialL)
    const meteredTotal = sum(measured)
    const meteredPotential = sum(meteredExpected)
    const avulsoTotal = sum(avulso)
    const contractPotential = r2(recurringPotential + meteredPotential)
    const contractBilled = r2(recurringTotal + meteredTotal)
    const goal = Number(input.goals.find(g => g.year === y && g.month === m)?.target_value) || 0
    const total = r2(recurringTotal + meteredTotal + avulsoTotal)
    return {
      year: y, month: m,
      recurring, recurringTotal, recurringPotential,
      measured, meteredTotal, measurePending, lostPotential: r2(lostPotential), glosaTotal: r2(glosaTotal),
      meteredPotential,
      avulso, avulsoTotal,
      contractPotential, contractBilled,
      contractGap: r2(contractPotential - contractBilled),
      contractBilledPct: pct(contractBilled, contractPotential),
      gapParts: {
        discounts: { total: sum(discounts), lines: discounts },
        glosas: { total: sum(glosas), lines: glosas },
        below: { total: sum(below), lines: below },
        pending: { total: sum(measurePending), lines: measurePending },
        above: { total: sum(above), lines: above },
      },
      total, goal, goalPct: pct(total, goal), gap: r2(goal - total),
    }
  }

  const months = Array.from({ length: 12 }, (_, i) => i + 1)
  const sel = (() => {
    const clean = [...new Set((selectedMonths ?? []).filter(m => Number.isInteger(m) && m >= 1 && m <= 12))].sort((a, b) => a - b)
    return clean.length ? clean : months   // padrão: o ano todo (meses futuros somam só a meta)
  })()
  const selSet = new Set(sel)
  const monthRevenues = months.map(m => (monthStartMs(year, m) > input.now.getTime() ? null : revenueOf(year, m)))
  const goalOf = (m: number) => Number(input.goals.find(g => g.year === year && g.month === m)?.target_value) || 0
  const yearSeries = months.map((m, i) => {
    const r = monthRevenues[i]
    return {
      month: m,
      total: r ? r.total : null as number | null,
      recurring: r ? r.recurringTotal : null as number | null,
      metered: r ? r.meteredTotal : null as number | null,
      avulso: r ? r.avulsoTotal : null as number | null,
      lostPotential: r ? r.lostPotential : null as number | null,
      potential: r ? r.contractPotential : null as number | null,
      billed: r ? r.contractBilled : null as number | null,
      contractGap: r ? r.contractGap : null as number | null,
      pending: r ? r.measurePending.length : null as number | null,
      goal: goalOf(m),
      goalPct: r ? pct(r.total, goalOf(m)) : null,
    }
  })

  // Receita do período: o mês, ou o ano somando os meses já passados
  const current = (() => {
    if (scope === 'month') return revenueOf(year, month)
    const done = monthRevenues.filter((r): r is NonNullable<typeof r> => r !== null && selSet.has(r.month))
    const sumOf = (k: 'recurringTotal' | 'meteredTotal' | 'avulsoTotal' | 'lostPotential' | 'glosaTotal' | 'meteredPotential' | 'recurringPotential' | 'contractPotential' | 'contractBilled') => r2(done.reduce((s, r) => s + r[k], 0))
    const tag = (r: { month: number }, l: ContractLine) => ({ ...l, note: `${MONTHS_SHORT_PT[r.month - 1]}${l.note ? ` · ${l.note}` : ''}` })
    const part = (k: 'discounts' | 'glosas' | 'below' | 'pending' | 'above') => {
      const lines = done.flatMap(r => r.gapParts[k].lines.map(l => tag(r, l)))
      return { total: r2(lines.reduce((s, l) => s + l.value, 0)), lines }
    }
    const cPot = sumOf('contractPotential'), cBil = sumOf('contractBilled')
    const total = r2(done.reduce((s, r) => s + r.total, 0))
    const goal = r2(sel.reduce((s, m) => s + goalOf(m), 0))
    const goalToDate = r2(done.reduce((s, r) => s + r.goal, 0))
    return {
      year, month: 12,
      recurring: mergeLines(done.map(r => r.recurring)), recurringTotal: sumOf('recurringTotal'),
      measured: mergeLines(done.map(r => r.measured)), meteredTotal: sumOf('meteredTotal'),
      measurePending: done.flatMap(r => r.measurePending.map(p => ({ ...p, note: `${MONTHS_SHORT_PT[r.month - 1]}: ${p.note}` }))),
      lostPotential: sumOf('lostPotential'), glosaTotal: sumOf('glosaTotal'), meteredPotential: sumOf('meteredPotential'),
      recurringPotential: sumOf('recurringPotential'),
      contractPotential: cPot, contractBilled: cBil, contractGap: r2(cPot - cBil), contractBilledPct: pct(cBil, cPot),
      gapParts: { discounts: part('discounts'), glosas: part('glosas'), below: part('below'), pending: part('pending'), above: part('above') },
      avulso: done.flatMap(r => r.avulso.map(a => ({ ...a, note: `${MONTHS_SHORT_PT[r.month - 1]} · ${a.note ?? ''}` }))), avulsoTotal: sumOf('avulsoTotal'),
      total, goal, goalPct: pct(total, goal), gap: r2(goal - total),
      goalToDate, goalToDatePct: pct(total, goalToDate),
    }
  })()
  const ytdMonths = yearSeries.filter(s => s.month <= month)
  const ytdRevenue = r2(ytdMonths.reduce((s, x) => s + (x.total ?? 0), 0))
  const ytdGoal = r2(ytdMonths.reduce((s, x) => s + x.goal, 0))
  const annualGoal = r2(yearSeries.reduce((s, x) => s + x.goal, 0))

  const firstM = scope === 'year' ? sel[0] : month
  const lastM = scope === 'year' ? sel[sel.length - 1] : month
  const start = monthStartMs(year, firstM)
  const end = lastM === 12 ? monthStartMs(year + 1, 1) : monthStartMs(year, lastM + 1)
  // Evento dentro do período: no mês escolhido, ou num dos meses marcados do consolidado
  const inMonth = (iso: string | null) => {
    const t = ts(iso)
    if (t === null || t < start || t >= end) return false
    if (scope === 'month') return true
    const br = new Date(t - BR_OFFSET_MS)
    return br.getUTCFullYear() === year && selSet.has(br.getUTCMonth() + 1)
  }

  // ── Hunter (novos negócios) ──────────────────────────────────────────────
  const tagOfRun = (r: RunRow) => r.tag_id ?? input.contractTag[r.contract_id] ?? null
  type TagAgg = { tagId: string | null; name: string; color: string | null; won: number; lost: number; wonValue: number }
  function byTag(runs: RunRow[]) {
    const map = new Map<string, TagAgg>()
    for (const r of runs) {
      const tid = tagOfRun(r)
      const key = tid ?? '—'
      const t = tid ? tagById.get(tid) : null
      const agg = map.get(key) ?? { tagId: tid, name: t?.name ?? 'Sem tag', color: t?.color ?? null, won: 0, lost: 0, wonValue: 0 }
      if (r.status === 'won') { agg.won++; agg.wonValue += Number(r.value) || 0 }
      if (r.status === 'lost') agg.lost++
      map.set(key, agg)
    }
    return [...map.values()]
      .map(a => ({ ...a, wonValue: r2(a.wonValue), ticket: a.won > 0 ? r2(a.wonValue / a.won) : null, conversion: pct(a.won, a.won + a.lost) }))
      .sort((a, b) => b.wonValue - a.wonValue)
  }

  const salesClosed = input.runs.filter(r => typeOf.get(r.pipeline_id) === 'vendas' && (r.status === 'won' || r.status === 'lost') && inMonth(r.ended_at))
  const salesWon = salesClosed.filter(r => r.status === 'won')
  const salesLost = salesClosed.filter(r => r.status === 'lost')
  const salesWonValue = r2(salesWon.reduce((s, r) => s + (Number(r.value) || 0), 0))
  const avulsoClosed = input.runs.filter(r => typeOf.get(r.pipeline_id) === 'servico_avulso' && (r.status === 'won' || r.status === 'lost') && inMonth(r.ended_at))
  const avulsoWon = avulsoClosed.filter(r => r.status === 'won')
  const avulsoWonValue = r2(avulsoWon.reduce((s, r) => s + (Number(r.value) || 0), 0))

  const nowMs = input.now.getTime()
  const openSales = input.runs.filter(r => typeOf.get(r.pipeline_id) === 'vendas' && r.status === 'open')
  const stale = openSales.filter(r => {
    const entered = ts(r.stage_entered_at) ?? ts(r.started_at)
    if (entered === null) return false
    const sla = (r.stage_id ? stageById.get(r.stage_id)?.sla_days : null) ?? DEFAULT_SLA
    return (nowMs - entered) / 86_400_000 > sla
  })
  const openAvulso = input.runs.filter(r => typeOf.get(r.pipeline_id) === 'servico_avulso' && r.status === 'open')

  const hunter = {
    closed: salesClosed.length,
    won: salesWon.map(r => line(r.contract_id, Number(r.value) || 0)),
    lost: salesLost.map(r => line(r.contract_id, Number(r.value) || 0)),
    conversion: pct(salesWon.length, salesClosed.length),
    newMrr: salesWonValue,
    ticket: salesWon.length ? r2(salesWonValue / salesWon.length) : null,
    byTag: byTag(salesClosed),
    avulso: {
      won: avulsoWon.map(r => line(r.contract_id, Number(r.value) || 0, r.report_file_name ? undefined : 'sem relatório')),
      value: avulsoWonValue,
      ticket: avulsoWon.length ? r2(avulsoWonValue / avulsoWon.length) : null,
      conversion: pct(avulsoWon.length, avulsoClosed.length),
      byTag: byTag(avulsoClosed),
      open: openAvulso.map(r => line(r.contract_id, Number(r.value) || 0)),
    },
    open: openSales.map(r => line(r.contract_id, Number(r.value) || 0)),
    openValue: r2(openSales.reduce((s, r) => s + (Number(r.value) || 0), 0)),
    stale: stale.map(r => {
      const entered = ts(r.stage_entered_at) ?? ts(r.started_at) ?? nowMs
      const days = Math.floor((nowMs - entered) / 86_400_000)
      return line(r.contract_id, Number(r.value) || 0, `${days} dias em "${(r.stage_id && stageById.get(r.stage_id)?.name) || 'etapa'}"`)
    }),
    leadsNew: input.leads.filter(l => inMonth(l.created_at)).length,
    leadsConverted: input.leads.filter(l => inMonth(l.created_at) && l.status === 'convertido').length,
  }

  // ── Farmer (carteira) ────────────────────────────────────────────────────
  const activeStart: ContractLine[] = []
  const activeEnd: ContractLine[] = []
  for (const contractId of gestaoRunsByContract.keys()) {
    if (activeAt(contractId, start)) activeStart.push(line(contractId, valueAt(contractId, start)))
    if (activeAt(contractId, Math.min(end - 1, nowMs))) activeEnd.push(line(contractId, valueAt(contractId, Math.min(end - 1, nowMs))))
  }
  const mrrStart = r2(activeStart.reduce((s, x) => s + x.value, 0))
  const mrrEnd = r2(activeEnd.reduce((s, x) => s + x.value, 0))

  const churnRuns = input.runs.filter(r => typeOf.get(r.pipeline_id) === 'gestao_contratos' && r.status === 'lost' && inMonth(r.ended_at))
  const churned = churnRuns.map(r => line(r.contract_id, valueAt(r.contract_id, ts(r.ended_at) ?? end)))
  const churnMrr = r2(churned.reduce((s, x) => s + x.value, 0))

  const renewedRows = input.renewals.filter(r => inMonth(r.renewed_at))
  const renewed = renewedRows.map(r => {
    const prev = r.previous_value !== null ? Number(r.previous_value) : null
    const nv = Number(r.new_value)
    const p = prev && prev > 0 ? Math.round(((nv - prev) / prev) * 1000) / 10 : null
    const note = prev === null ? 'sem valor anterior registrado'
      : nv > prev ? `aumentou de ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(prev)} (${fmtPct(p, { signed: true })})`
      : nv < prev ? `reduziu de ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(prev)} (${fmtPct(p)})`
      : 'mesmo valor'
    return { ...line(r.contract_id, nv, note), previous: prev, direction: prev === null ? 'na' : nv > prev ? 'up' : nv < prev ? 'down' : 'flat' }
  })
  const renewPrev = r2(renewed.reduce((s, x) => s + (x.previous ?? 0), 0))
  const renewNew = r2(renewed.filter(x => x.previous !== null).reduce((s, x) => s + x.value, 0))

  const answered = input.nps.filter(n => n.score !== null && n.answered_at && (ts(n.answered_at) ?? 0) < end && (ts(n.answered_at) ?? 0) >= end - 365 * 86_400_000)
  const promoters = answered.filter(n => (n.score ?? 0) >= 9).length
  const detractors = answered.filter(n => (n.score ?? 0) <= 6).length
  const openTickets = input.tickets.filter(t => !['fechado', 'resolvido', 'cancelado'].includes(t.status))
  const overdueTickets = openTickets.filter(t => { const d = ts(t.sla_due_at); return d !== null && d < nowMs })

  const farmer = {
    activeStart: activeStart.length, mrrStart,
    active: activeEnd, mrr: mrrEnd,
    churned, churnMrr,
    churnRate: pct(churned.length, activeStart.length),
    revenueChurnRate: pct(churnMrr, mrrStart),
    renewed,
    renewPrev, renewNew,
    renewDelta: r2(renewNew - renewPrev),
    renewDeltaPct: renewPrev > 0 ? Math.round(((renewNew - renewPrev) / renewPrev) * 1000) / 10 : null,
    renewUp: renewed.filter(x => x.direction === 'up').length,
    renewDown: renewed.filter(x => x.direction === 'down').length,
    renewFlat: renewed.filter(x => x.direction === 'flat').length,
    renewalRate: pct(renewed.length, renewed.length + churned.length),
    measurePending: current.measurePending,
    lostPotential: current.lostPotential,
    nps: answered.length ? Math.round(((promoters - detractors) / answered.length) * 100) : null,
    npsAnswers: answered.length,
    openTickets: openTickets.length,
    overdueTickets: overdueTickets.length,
  }

  return { year, month, scope, selectedMonths: sel, revenue: current, yearSeries, ytdRevenue, ytdGoal, annualGoal, ytdPct: pct(ytdRevenue, ytdGoal), hunter, farmer }
}

export type DashboardResult = ReturnType<typeof computeDashboard>
