'use client'

// Escolha dos meses do consolidado: clique para marcar/desmarcar meses soltos
// ou use um atalho (ano todo, trimestres, semestres, até hoje).

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

const SHORT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const PRESETS: { label: string; months: number[] }[] = [
  { label: 'Ano todo', months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
  { label: '1º tri', months: [1, 2, 3] },
  { label: '2º tri', months: [4, 5, 6] },
  { label: '3º tri', months: [7, 8, 9] },
  { label: '4º tri', months: [10, 11, 12] },
  { label: '1º sem', months: [1, 2, 3, 4, 5, 6] },
  { label: '2º sem', months: [7, 8, 9, 10, 11, 12] },
]

export function MonthPicker({ year, selected, currentMonth }: { year: number; selected: number[]; currentMonth: number | null }) {
  const router = useRouter()
  const [sel, setSel] = useState<number[]>(selected)
  const [pending, start] = useTransition()

  function apply(next: number[]) {
    const clean = [...new Set(next)].sort((a, b) => a - b)
    if (clean.length === 0) return            // sempre pelo menos um mês
    setSel(clean)
    const meses = clean.length === 12 ? '' : `&meses=${clean.join(',')}`
    start(() => router.push(`/painel?visao=ano&ano=${year}${meses}`, { scroll: false }))
  }

  const toggle = (m: number) => apply(sel.includes(m) ? sel.filter(x => x !== m) : [...sel, m])
  const same = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i])
  const ytd = currentMonth ? Array.from({ length: currentMonth }, (_, i) => i + 1) : null

  return (
    <div className={`rounded-2xl border border-gray-200 bg-white p-4 transition-opacity ${pending ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Meses do consolidado</p>
        <p className="text-xs text-gray-500" aria-live="polite">
          {sel.length === 12 ? 'Ano todo' : `${sel.length} ${sel.length === 1 ? 'mês' : 'meses'}: ${sel.map(m => SHORT[m - 1]).join(', ')}`}
        </p>
      </div>

      <div className="mt-3 grid grid-cols-6 gap-1.5 sm:grid-cols-12" role="group" aria-label="Meses">
        {SHORT.map((label, i) => {
          const m = i + 1
          const on = sel.includes(m)
          const future = currentMonth !== null && m > currentMonth
          return (
            <button
              key={label}
              type="button"
              onClick={() => toggle(m)}
              aria-pressed={on}
              title={on ? `Tirar ${label} do período` : `Incluir ${label} no período`}
              className={`rounded-lg px-1 py-2 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1B556B]/40 ${
                on ? 'bg-[#1B556B] text-white shadow-sm hover:bg-brand-800' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
              } ${future && !on ? 'text-gray-300' : ''}`}
            >
              {label}
            </button>
          )
        })}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {ytd && (
          <button type="button" onClick={() => apply(ytd)}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${same(sel, ytd) ? 'border-[#1B556B] bg-[#1B556B]/10 text-[#1B556B]' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            Até hoje
          </button>
        )}
        {PRESETS.map(p => (
          <button key={p.label} type="button" onClick={() => apply(p.months)}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${same(sel, p.months) ? 'border-[#1B556B] bg-[#1B556B]/10 text-[#1B556B]' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            {p.label}
          </button>
        ))}
      </div>
    </div>
  )
}
