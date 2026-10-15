// Formatação padrão brasileira usada em todo o CRM:
//   porcentagem sempre com 1 casa decimal (85,8% · 100,0%)
//   dinheiro sempre com centavos (R$ 187.900,00)

const PCT = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 })

// v já em pontos percentuais (ex.: 85.83 → "85,8%"). signed: mostra "+" nos positivos.
export function fmtPct(v: number | null | undefined, opts?: { signed?: boolean; empty?: string }): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return opts?.empty ?? '—'
  const txt = PCT.format(v)
  return `${opts?.signed && v > 0 ? '+' : ''}${txt}%`
}

// Parte ÷ total em % com 1 casa (total 0 → "—")
export function fmtRatio(part: number, total: number, empty = '—'): string {
  return total > 0 ? fmtPct((part / total) * 100) : empty
}

export function fmtBRL(v: number | null | undefined, empty = '—'): string {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return empty
  return BRL.format(Number(v))
}

// Número com 1 casa decimal (ex.: 4,5 · 2,0)
const NUM1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
export function fmtNum1(v: number | null | undefined, empty = '—'): string {
  return v === null || v === undefined || !Number.isFinite(v) ? empty : NUM1.format(v)
}
