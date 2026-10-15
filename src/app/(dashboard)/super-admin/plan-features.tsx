'use client'

// Super Admin → Planos e abas: matriz plano × aba, e ajustes por cliente.

import { useState, useTransition } from 'react'
import { FEATURES, PLANS, resolveFeatures, type PlanId } from '@/lib/config/plans'
import { savePlanFeatures, saveTenantFeatures } from '@/lib/actions/super-admin'

export function PlanFeaturesMatrix({ initial }: { initial: Record<PlanId, string[]> }) {
  const [matrix, setMatrix] = useState(initial)
  const [dirty, setDirty] = useState<Set<PlanId>>(new Set())
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)

  function toggle(plan: PlanId, key: string) {
    setMatrix(m => {
      const has = m[plan].includes(key)
      return { ...m, [plan]: has ? m[plan].filter(k => k !== key) : [...m[plan], key] }
    })
    setDirty(d => new Set(d).add(plan))
    setMsg(null)
  }

  function save() {
    start(async () => {
      for (const plan of dirty) {
        const r = await savePlanFeatures(plan, matrix[plan])
        if (r.error) { setMsg(`Erro em ${plan}: ${r.error}`); return }
      }
      setDirty(new Set())
      setMsg('✓ Planos salvos. Vale na próxima página que cada cliente abrir.')
    })
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100">
        <h2 className="text-base font-semibold text-gray-800">Planos e abas</h2>
        <p className="text-xs text-gray-400 mt-0.5">
          Marque as abas de cada plano. Configurações é sempre liberada. Ajustes de um cliente específico ficam em “Abas” na linha dele.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
            <tr>
              <th className="px-6 py-3 text-left">Aba</th>
              {PLANS.map(p => <th key={p.id} className="px-6 py-3 text-center">{p.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {FEATURES.map(f => (
              <tr key={f.key} className="border-t border-gray-100">
                <td className="px-6 py-2 text-gray-800">{f.label}</td>
                {PLANS.map(p => (
                  <td key={p.id} className="px-6 py-2 text-center">
                    <input
                      type="checkbox"
                      aria-label={`${f.label} no plano ${p.label}`}
                      checked={matrix[p.id].includes(f.key)}
                      onChange={() => toggle(p.id, f.key)}
                      className="h-4 w-4 accent-[#1b556b]"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3 px-6 py-4 border-t border-gray-100">
        <button
          onClick={save}
          disabled={pending || dirty.size === 0}
          className="rounded-lg bg-[#1b556b] px-5 py-2 text-sm font-medium text-white hover:bg-[#154459] disabled:opacity-50"
        >
          {pending ? 'Salvando…' : 'Salvar planos'}
        </button>
        {msg && <span className="text-sm text-gray-600">{msg}</span>}
      </div>
    </div>
  )
}

type Mode = 'plan' | 'add' | 'remove'

export function TenantFeaturesEditor({
  tenantId,
  tenantName,
  planFeatures,
  initialAdd,
  initialRemove,
}: {
  tenantId: string
  tenantName: string
  planFeatures: string[]
  initialAdd: string[]
  initialRemove: string[]
}) {
  const [modes, setModes] = useState<Record<string, Mode>>(() => {
    const m: Record<string, Mode> = {}
    for (const f of FEATURES) m[f.key] = initialAdd.includes(f.key) ? 'add' : initialRemove.includes(f.key) ? 'remove' : 'plan'
    return m
  })
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)

  const add = FEATURES.filter(f => modes[f.key] === 'add').map(f => f.key)
  const remove = FEATURES.filter(f => modes[f.key] === 'remove').map(f => f.key)
  const final = resolveFeatures(planFeatures, add, remove)

  function save() {
    start(async () => {
      const r = await saveTenantFeatures(tenantId, add, remove)
      setMsg(r.error ? `Erro: ${r.error}` : '✓ Salvo.')
    })
  }

  return (
    <div className="bg-slate-50 border-b border-slate-200 px-6 py-4">
      <p className="text-xs font-semibold text-slate-700 mb-3 uppercase tracking-wide">Abas de {tenantName}</p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map(f => {
          const inPlan = planFeatures.includes(f.key)
          const on = final.includes(f.key)
          return (
            <label key={f.key} className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
              <span className={on ? 'text-gray-900' : 'text-gray-400 line-through'}>{f.label}</span>
              <select
                value={modes[f.key]}
                onChange={e => { setModes(m => ({ ...m, [f.key]: e.target.value as Mode })); setMsg(null) }}
                className="rounded border border-gray-300 px-1.5 py-1 text-xs"
              >
                <option value="plan">Do plano ({inPlan ? 'sim' : 'não'})</option>
                <option value="add">Liberar</option>
                <option value="remove">Bloquear</option>
              </select>
            </label>
          )
        })}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={save}
          disabled={pending}
          className="rounded bg-[#1b556b] px-4 py-1.5 text-xs font-medium text-white hover:bg-[#154459] disabled:opacity-50"
        >
          {pending ? 'Salvando…' : 'Salvar abas do cliente'}
        </button>
        <span className="text-xs text-gray-500">{final.length} aba(s) liberada(s) + Configurações</span>
        {msg && <span className="text-xs text-gray-600">{msg}</span>}
      </div>
    </div>
  )
}
