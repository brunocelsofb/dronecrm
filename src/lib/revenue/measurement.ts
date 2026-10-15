// Regras de medição usadas na tela, no painel e pelo Farmer (sem acesso a banco).

export const MONTHS_SHORT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
export const MONTHS_LONG = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

export const brl = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)

export function round2(v: number): number {
  return Math.round(v * 100) / 100
}

// Líquido = medido − glosa; "perdemos" = potencial (valor do contrato) − líquido, quando positivo
export function measurementLoss(contractValue: number, measured: number, glosa: number): {
  net: number
  lost: number          // ≥ 0
  lostPct: number | null // % do potencial
  above: number         // ≥ 0 (mediu acima do potencial)
} {
  const net = round2(measured - glosa)
  const diff = round2(contractValue - net)
  const lost = diff > 0 ? diff : 0
  const above = diff < 0 ? -diff : 0
  const lostPct = contractValue > 0 ? Math.round((lost / contractValue) * 1000) / 10 : null
  return { net, lost, lostPct, above }
}

// Mês de referência que já deveria estar medido hoje (o mês anterior), e se o prazo venceu
export function pendingReference(today: Date, dueDay: number): { year: number; month: number; overdue: boolean } {
  const y = today.getFullYear()
  const m = today.getMonth() + 1           // 1..12
  const refMonth = m === 1 ? 12 : m - 1
  const refYear = m === 1 ? y - 1 : y
  return { year: refYear, month: refMonth, overdue: today.getDate() > dueDay }
}

// "Hoje" em Brasília, independente do fuso do servidor
export function todayBrasilia(): Date {
  const now = new Date()
  const br = new Date(now.getTime() - 3 * 60 * 60 * 1000)
  return new Date(br.getUTCFullYear(), br.getUTCMonth(), br.getUTCDate())
}
