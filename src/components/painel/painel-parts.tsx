// Peças do Painel gerencial (Server Components, sem JS no navegador).
// Todo número abre a lista de contratos/oportunidades que o compõem.

import Link from 'next/link'
import type { ContractLine } from '@/lib/revenue/dashboard-compute'

export const brl = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v)
export const brl2 = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
export const pctTxt = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v.toLocaleString('pt-BR')}%`)

export function Section({ title, subtitle, badge, children }: { title: string; subtitle?: string; badge?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-2">
        {badge && <span className="rounded-full bg-[#1B556B] px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">{badge}</span>}
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
      </div>
      {children}
    </section>
  )
}

export function DrillList({ lines, empty = 'Nenhum item.' }: { lines: (ContractLine & { previous?: number | null })[]; empty?: string }) {
  if (lines.length === 0) return <p className="px-1 py-2 text-xs text-gray-400">{empty}</p>
  return (
    <ul className="mt-2 max-h-64 divide-y divide-gray-100 overflow-auto rounded-md border border-gray-100 bg-white">
      {lines.map((l, i) => (
        <li key={`${l.contractId}-${i}`} className="flex items-start justify-between gap-3 px-2.5 py-1.5 text-xs">
          <Link href={`/contracts/${l.contractId}`} className="min-w-0 text-gray-800 hover:text-[#1B556B] hover:underline">
            <span className="font-medium">{l.client}</span>
            {l.number && <span className="ml-1.5 font-mono text-[10px] text-gray-400">{l.number}</span>}
            {l.note && <span className="block text-[11px] text-gray-500">{l.note}</span>}
          </Link>
          <span className="shrink-0 tabular-nums text-gray-700">{brl2(l.value)}</span>
        </li>
      ))}
    </ul>
  )
}

export function Kpi({
  label, value, hint, tone = 'neutral', lines, linesLabel = 'Ver composição', empty,
}: {
  label: string
  value: string
  hint?: React.ReactNode
  tone?: 'neutral' | 'good' | 'bad' | 'warn'
  lines?: (ContractLine & { previous?: number | null })[]
  linesLabel?: string
  empty?: string
}) {
  const toneCls = tone === 'good' ? 'text-green-700' : tone === 'bad' ? 'text-red-700' : tone === 'warn' ? 'text-amber-700' : 'text-gray-900'
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${toneCls}`}>{value}</p>
      {hint && <div className="mt-0.5 text-xs text-gray-500">{hint}</div>}
      {lines && (
        <details className="mt-2 group">
          <summary className="cursor-pointer list-none text-xs font-medium text-[#1B556B] hover:underline">
            {linesLabel} ({lines.length}) <span className="inline-block transition-transform group-open:rotate-90">›</span>
          </summary>
          <DrillList lines={lines} empty={empty} />
        </details>
      )}
    </div>
  )
}

// Barras da receita por mês com a meta marcada (uma escala só)
export function RevenueGoalChart({ series, monthLabels }: { series: { month: number; total: number | null; goal: number }[]; monthLabels: string[] }) {
  const max = Math.max(1, ...series.map(s => Math.max(s.total ?? 0, s.goal)))
  const W = 720, H = 200, padL = 8, padB = 22, padT = 10
  const bw = (W - padL * 2) / 12
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max)
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-2 flex items-center gap-4 text-xs text-gray-600">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#1B556B]" />Receita realizada</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 bg-[#E08A2E]" />Meta do mês</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Receita realizada e meta por mês">
        <line x1={padL} x2={W - padL} y1={y(0)} y2={y(0)} stroke="#e5e7eb" strokeWidth={1} />
        {series.map((s, i) => {
          const x = padL + i * bw
          const barW = Math.min(28, bw * 0.55)
          const bx = x + (bw - barW) / 2
          const total = s.total ?? 0
          const top = y(total)
          const r = Math.min(4, (y(0) - top) / 2)
          return (
            <g key={s.month}>
              <title>{`${monthLabels[i]}: receita ${brl(s.total)} · meta ${brl(s.goal)}`}</title>
              <rect x={x} y={padT} width={bw} height={H - padT - padB} fill="transparent" />
              {s.total !== null && total > 0 && (
                <path d={`M${bx},${y(0)} V${top + r} Q${bx},${top} ${bx + r},${top} H${bx + barW - r} Q${bx + barW},${top} ${bx + barW},${top + r} V${y(0)} Z`} fill="#1B556B" />
              )}
              {s.goal > 0 && <line x1={bx - 4} x2={bx + barW + 4} y1={y(s.goal)} y2={y(s.goal)} stroke="#E08A2E" strokeWidth={2} strokeLinecap="round" />}
              <text x={x + bw / 2} y={H - 6} textAnchor="middle" fontSize={10} fill="#6b7280">{monthLabels[i]}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
