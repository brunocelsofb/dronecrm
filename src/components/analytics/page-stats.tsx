// Peças das telas de estatísticas de página (site e vitrine): período, cartões com comparação,
// gráfico Visitas × Resultados por dia e tabela de origens. Sem interatividade: links e SVG.
import Link from 'next/link'
import { fmtNum1, fmtPct } from '@/lib/format'
import type { Delta, DayPoint, SourceRow } from '@/lib/analytics/visits-data'
import type { Period } from '@/lib/analytics/visits'

export function PeriodTabs({ period, base, extra = {} }: { period: Period; base: string; extra?: Record<string, string> }) {
  const opts: [Period['key'], string][] = [['mes', 'Este mês'], ['mes-passado', 'Mês passado'], ['30d', 'Últimos 30 dias']]
  return (
    <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Período">
      {opts.map(([k, label]) => (
        <Link key={k} href={`${base}?${new URLSearchParams({ ...extra, periodo: k })}`} role="tab" aria-selected={period.key === k}
          className={`rounded-full px-3 py-1 text-xs ${period.key === k ? 'bg-brand-700 text-white' : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>{label}</Link>
      ))}
    </div>
  )
}

const dt = (s: string) => s.split('-').reverse().join('/')
export function periodText(p: Period) {
  const last = new Date(`${p.to}T00:00:00Z`); last.setUTCDate(last.getUTCDate() - 1)
  const pl = new Date(`${p.prevTo}T00:00:00Z`); pl.setUTCDate(pl.getUTCDate() - 1)
  return `${dt(p.from)} até ${dt(last.toISOString().slice(0, 10))} · comparado com ${dt(p.prevFrom)} até ${dt(pl.toISOString().slice(0, 10))}`
}

export const fmtInt = (n: number | null) => (n === null ? '—' : n.toLocaleString('pt-BR'))
export const fmtDur = (ms: number | null) => {
  if (ms === null) return '—'
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`
}
export const fmtRate = (r: number | null) => (r === null ? '—' : fmtPct(r * 100))

// Cartão com o número e a variação contra o período anterior. lowerIsBetter: abandono.
export function StatCard({ label, value, d, lowerIsBetter, hint }: { label: string; value: string; d: Delta; lowerIsBetter?: boolean; hint?: string }) {
  const c = d.change
  const good = c === null || c === 0 ? null : lowerIsBetter ? c < 0 : c > 0
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3" title={hint}>
      <p className="text-xs text-gray-600">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-gray-900">{value}</p>
      <p className={`mt-0.5 text-[11px] ${good === null ? 'text-gray-500' : good ? 'text-positive-700' : 'text-negative-700'}`}>
        {c === null ? 'sem base para comparar' : `${c > 0 ? '▲' : c < 0 ? '▼' : '='} ${fmtNum1(Math.abs(c) * 100)}% vs. período anterior`}
      </p>
    </div>
  )
}

// Barras = visitas por dia; linha = resultados (leads ou pedidos) por dia, na escala da direita
export function VisitsChart({ days, resultLabel }: { days: DayPoint[]; resultLabel: string }) {
  const W = 720, H = 200, padL = 32, padR = 32, padT = 12, padB = 26
  const maxV = Math.max(1, ...days.map(d => d.visits)), maxR = Math.max(1, ...days.map(d => d.results))
  const iw = W - padL - padR, ih = H - padT - padB, step = iw / Math.max(days.length, 1), bw = Math.max(2, step * 0.62)
  const y = (v: number, m: number) => padT + ih - (v / m) * ih
  const line = days.map((d, i) => `${i ? 'L' : 'M'}${(padL + step * i + step / 2).toFixed(1)},${y(d.results, maxR).toFixed(1)}`).join(' ')
  const ticks = days.length <= 10 ? days.map((_, i) => i) : [0, Math.floor(days.length / 3), Math.floor((2 * days.length) / 3), days.length - 1]
  const totalV = days.reduce((t, d) => t + d.visits, 0), totalR = days.reduce((t, d) => t + d.results, 0)
  return (
    <figure className="rounded-xl border border-gray-200 bg-white p-3">
      <figcaption className="mb-2 flex flex-wrap items-center gap-3 text-xs text-gray-600">
        <span className="font-medium text-gray-900">Visitas × {resultLabel} por dia</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-brand-700" aria-hidden /> Visitas ({fmtInt(totalV)})</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-0.5 w-3 bg-warn-600" aria-hidden /> {resultLabel} ({fmtInt(totalR)})</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Gráfico de visitas e ${resultLabel.toLowerCase()} por dia`}>
        <line x1={padL} x2={W - padR} y1={padT + ih} y2={padT + ih} stroke="#d1d5db" />
        <text x={padL - 4} y={padT + 8} textAnchor="end" fontSize="10" fill="#6b7280">{maxV}</text>
        <text x={W - padR + 4} y={padT + 8} fontSize="10" fill="#e98c5f">{maxR}</text>
        {days.map((d, i) => (
          <rect key={d.day} x={padL + step * i + (step - bw) / 2} y={y(d.visits, maxV)} width={bw} height={Math.max(0, padT + ih - y(d.visits, maxV))} rx="1.5" fill="#1b556b" opacity="0.85">
            <title>{`${d.day.split('-').reverse().join('/')}: ${d.visits} visita(s), ${d.results} ${resultLabel.toLowerCase()}`}</title>
          </rect>
        ))}
        <path d={line} fill="none" stroke="#e98c5f" strokeWidth="2" strokeLinejoin="round" />
        {ticks.map(i => days[i] && <text key={i} x={padL + step * i + step / 2} y={H - 8} textAnchor="middle" fontSize="10" fill="#6b7280">{days[i].day.slice(8, 10)}/{days[i].day.slice(5, 7)}</text>)}
      </svg>
    </figure>
  )
}

export function SourcesTable({ rows, resultLabel }: { rows: SourceRow[]; resultLabel?: string }) {
  const total = rows.reduce((t, r) => t + r.visits, 0)
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="min-w-full text-sm">
        <caption className="px-3 pt-3 text-left text-sm font-semibold text-gray-900">De onde vieram</caption>
        <thead><tr className="text-left text-xs text-gray-500"><th className="px-3 py-2 font-medium">Origem</th><th className="px-3 py-2 text-right font-medium">Visitas</th>
          {resultLabel ? <><th className="px-3 py-2 text-right font-medium">{resultLabel}</th><th className="px-3 py-2 text-right font-medium">Conversão</th></> : <th className="px-3 py-2 text-right font-medium">% das visitas</th>}</tr></thead>
        <tbody className="divide-y divide-gray-100">
          {rows.length === 0 && <tr><td colSpan={resultLabel ? 4 : 3} className="px-3 py-3 text-gray-500">Sem visitas no período.</td></tr>}
          {rows.map(r => (
            <tr key={r.label}><td className="px-3 py-2 text-gray-900">{r.label}</td><td className="px-3 py-2 text-right">{fmtInt(r.visits)}</td>
              {resultLabel
                ? <><td className="px-3 py-2 text-right">{fmtInt(r.results)}</td><td className="px-3 py-2 text-right">{r.visits ? fmtPct((r.results / r.visits) * 100) : '—'}</td></>
                : <td className="px-3 py-2 text-right">{total ? fmtPct((r.visits / total) * 100) : '—'}</td>}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
