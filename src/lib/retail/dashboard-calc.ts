// ─── Painel do Varejo: contas puras (testadas em tests/retail-margin.test.mjs) ─
// Mês no fuso de Brasília (UTC−3, sem horário de verão desde 2019).

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

const pad = (n: number) => String(n).padStart(2, '0')

export type MonthBounds = { start: string; end: string; prevStart: string; day: number; days: number; label: string }

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

// Início e fim (ISO, UTC) do mês atual e início do mês anterior, contados em Brasília
export function monthBounds(now = new Date()): MonthBounds {
  const br = new Date(now.getTime() - 3 * 3_600_000) // relógio de Brasília em UTC
  const y = br.getUTCFullYear(), m = br.getUTCMonth() + 1, day = br.getUTCDate()
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const iso = (yy: number, mm: number) => {
    const yN = mm > 12 ? yy + 1 : mm < 1 ? yy - 1 : yy
    const mN = mm > 12 ? 1 : mm < 1 ? 12 : mm
    return `${yN}-${pad(mN)}-01T03:00:00.000Z`
  }
  return { start: iso(y, m), end: iso(y, m + 1), prevStart: iso(y, m - 1), day, days, label: `${MONTHS[m - 1]} de ${y}` }
}

// Resultado de analyzeOrder (margin.ts) de cada pedido pago
export type OrderResult = { revenue: number; contribution: number; missingCost: number }

export type SalesSummary = {
  orders: number; revenue: number; avgTicket: number
  contribution: number; marginPct: number; missingCostUnits: number
}

// Vendas pagas: valor das peças (sem frete) e quanto sobrou depois de custos e despesas da venda
export function summarizeSales(orders: OrderResult[]): SalesSummary {
  let revenue = 0, contribution = 0, missing = 0
  for (const a of orders) { revenue += a.revenue; contribution += a.contribution; missing += a.missingCost }
  return {
    orders: orders.length, revenue: round2(revenue), avgTicket: orders.length ? round2(revenue / orders.length) : 0,
    contribution: round2(contribution), marginPct: revenue > 0 ? (contribution / revenue) * 100 : 0, missingCostUnits: missing,
  }
}

export type BreakEvenProgress = {
  fixed: number; covered: number; pct: number          // quanto dos custos fixos o ganho do mês já pagou
  missingContribution: number                          // ganho que ainda falta
  missingRevenue: number | null                        // vendas que ainda faltam, na margem do mês (ou na desejada)
  perDayRevenue: number | null                         // por dia, até o fim do mês
  projectedContribution: number                        // se o ritmo continuar
  reached: boolean
}

export function breakEvenProgress(fixed: number, s: SalesSummary, targetMarginPct: number, day: number, days: number): BreakEvenProgress | null {
  if (!(fixed > 0)) return null
  const covered = Math.max(0, s.contribution)
  const missing = Math.max(0, fixed - covered)
  const margin = s.revenue > 0 && s.marginPct > 0 ? s.marginPct : targetMarginPct
  const missingRevenue = missing > 0 && margin > 0 ? round2(missing / (margin / 100)) : missing > 0 ? null : 0
  const left = Math.max(1, days - day + 1)
  return {
    fixed, covered: round2(covered), pct: Math.min(100, (covered / fixed) * 100),
    missingContribution: round2(missing), missingRevenue,
    perDayRevenue: missingRevenue === null ? null : round2(missingRevenue / left),
    projectedContribution: round2(day > 0 ? (s.contribution / day) * days : 0),
    reached: missing <= 0,
  }
}

// Variação contra o mês anterior até o mesmo dia (comparação justa no meio do mês)
export function changePct(current: number, previous: number): number | null {
  return previous > 0 ? ((current - previous) / previous) * 100 : null
}
