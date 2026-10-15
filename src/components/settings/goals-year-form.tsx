'use client'

// Meta de receita do ano, cadastrada mês a mês. A meta anual é a soma.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { saveYearGoals, saveMeasurementDueDay } from '@/lib/actions/goals'

const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
const brl = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)

// Aceita "145000", "145.000,50" ou "145000.50"
function parseMoney(s: string): number | null {
  const t = s.trim()
  if (!t) return null
  const norm = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t
  const n = Number(norm)
  return Number.isFinite(n) && n >= 0 ? n : NaN
}

export function GoalsYearForm({ year, initial, dueDay }: { year: number; initial: (number | null)[]; dueDay: number }) {
  const router = useRouter()
  const [values, setValues] = useState(initial.map(v => (v ? String(v).replace('.', ',') : '')))
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [day, setDay] = useState(String(dueDay))

  const parsed = values.map(parseMoney)
  const invalid = parsed.some(v => Number.isNaN(v))
  const total = parsed.reduce<number>((s, v) => s + (v && !Number.isNaN(v) ? v : 0), 0)

  function save() {
    if (invalid) { setMsg({ ok: false, text: 'Há valores inválidos. Use números, ex.: 145000 ou 145.000,00.' }); return }
    setMsg(null)
    start(async () => {
      const r = await saveYearGoals(year, parsed as (number | null)[])
      setMsg(r.ok ? { ok: true, text: 'Metas salvas.' } : { ok: false, text: r.error })
      if (r.ok) router.refresh()
    })
  }

  function saveDay() {
    start(async () => {
      const r = await saveMeasurementDueDay(Number(day))
      setMsg(r.ok ? { ok: true, text: 'Prazo da medição salvo.' } : { ok: false, text: r.error })
    })
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => router.push(`/settings/metas?ano=${year - 1}`)} className="rounded border border-gray-200 px-2 py-1 text-sm text-gray-600 hover:bg-gray-50" aria-label="Ano anterior">‹</button>
            <span className="text-base font-semibold text-gray-900">{year}</span>
            <button type="button" onClick={() => router.push(`/settings/metas?ano=${year + 1}`)} className="rounded border border-gray-200 px-2 py-1 text-sm text-gray-600 hover:bg-gray-50" aria-label="Próximo ano">›</button>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500">Meta anual (soma dos meses)</p>
            <p className="text-lg font-semibold text-gray-900">{brl(total)}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {MONTHS.map((m, i) => (
            <label key={m} className="block">
              <span className="text-xs font-medium text-gray-600">{m}</span>
              <div className="mt-1 flex items-center rounded-md border border-gray-300 focus-within:border-brand-700">
                <span className="pl-2 text-xs text-gray-400">R$</span>
                <input
                  inputMode="decimal"
                  value={values[i]}
                  onChange={e => setValues(v => v.map((x, j) => (j === i ? e.target.value : x)))}
                  placeholder="0,00"
                  className={`w-full rounded-md px-2 py-1.5 text-sm focus:outline-none ${Number.isNaN(parsed[i]) ? 'text-red-600' : ''}`}
                />
              </div>
            </label>
          ))}
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button type="button" onClick={save} disabled={pending} className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">
            {pending ? 'Salvando...' : `Salvar metas de ${year}`}
          </button>
          {msg && <span role="status" className={`text-sm ${msg.ok ? 'text-green-700' : 'text-red-600'}`}>{msg.text}</span>}
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <p className="text-sm font-semibold text-gray-900">Prazo da medição</p>
        <p className="mt-0.5 text-xs text-gray-500">
          Contratos por medição precisam do relatório do mês. Se até este dia do mês seguinte não houver medição validada, o Farmer avisa o responsável e o gestor.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <span className="text-sm text-gray-600">Dia</span>
          <select value={day} onChange={e => setDay(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm">
            {Array.from({ length: 28 }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <span className="text-sm text-gray-600">do mês seguinte</span>
          <button type="button" onClick={saveDay} disabled={pending} className="ml-2 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">Salvar prazo</button>
        </div>
      </div>
    </div>
  )
}
