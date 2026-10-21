// Soma meses a uma data (formato 'YYYY-MM-DD'), lidando corretamente com
// meses de tamanhos diferentes (28/29/30/31 dias). Ex: 31/01 + 1 mês não
// vira "3 de março" (que seria o comportamento padrão, errado, do
// JavaScript) — em vez disso, cai no último dia de fevereiro.
export function addMonthsToDateString(dateStr: string, months: number): string {
  const [year, month, day] = dateStr.split('-').map(Number)
  const d = new Date(year, month - 1, day)

  const targetMonth = d.getMonth() + months
  d.setMonth(targetMonth)

  // Se o dia "vazou" pro mês seguinte (ex: 31/jan + 1 mês vira 3/mar em
  // vez de ficar em fevereiro), volta pro último dia do mês certo.
  if (d.getMonth() !== ((targetMonth % 12) + 12) % 12) {
    d.setDate(0)
  }

  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

// ─── Datas só-dia ('YYYY-MM-DD') e vigência de contrato ───────────────────────
// Datas sem hora NUNCA passam por new Date('YYYY-MM-DD'): isso é meia-noite UTC
// e, no Brasil (UTC−3), vira o dia anterior na tela e nas contas de "dias".
// Tudo aqui trabalha com o texto da data e com o "hoje" de Brasília.

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})/

function parts(iso: string): [number, number, number] | null {
  const m = iso?.match(ISO_DAY)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}
const pad = (n: number) => String(n).padStart(2, '0')
const toIso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`
export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

// Hoje no fuso de Brasília, como 'YYYY-MM-DD'
export function todayIsoBR(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export function addDaysIso(iso: string, days: number): string {
  const p = parts(iso); if (!p) return iso
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + days))
  return toIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}

// Dias de 'from' até 'to' (positivo se 'to' é depois)
export function daysBetweenIso(from: string, to: string): number {
  const a = parts(from), b = parts(to)
  if (!a || !b) return NaN
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86_400_000)
}

// Dias até a data, contando a partir de hoje em Brasília (0 = hoje, negativo = já passou)
export function daysUntilIso(iso: string, now: Date = new Date()): number {
  return daysBetweenIso(todayIsoBR(now), iso)
}

// 'YYYY-MM-DD' → 'dd/mm/aaaa' (sem fuso)
export function formatDateOnlyBR(iso: string | null | undefined, empty = '—'): string {
  const p = iso ? parts(iso) : null
  return p ? `${pad(p[2])}/${pad(p[1])}/${p[0]}` : empty
}

// Último dia coberto por um contrato de N meses que começa em 'start'.
// Regra: véspera do mesmo dia, N meses depois. Se esse dia não existe no mês
// final (31/01 + 1 mês, 29/02 + 12 meses), vai até o último dia daquele mês.
//   01/01/2026 + 12 → 31/12/2026   ·   15/03/2026 + 6 → 14/09/2026
//   31/01/2026 + 1  → 28/02/2026   ·   29/02/2028 + 12 → 28/02/2029
export function contractEndDate(start: string, months: number): string {
  const p = parts(start); if (!p || !Number.isFinite(months) || months <= 0) return start
  const total = p[1] - 1 + Math.trunc(months)
  const y = p[0] + Math.floor(total / 12), m = (total % 12) + 1
  const last = daysInMonth(y, m)
  return p[2] <= last ? addDaysIso(toIso(y, m, p[2]), -1) : toIso(y, m, last)
}

// Início da renovação: dia seguinte ao fim da vigência anterior
export function renewalStartDate(previousEnd: string): string {
  return addDaysIso(previousEnd, 1)
}
