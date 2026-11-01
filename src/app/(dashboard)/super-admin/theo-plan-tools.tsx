'use client'

// Super Admin → Ações do Théo por plano. Só aparecem as ferramentas das abas do plano;
// a empresa (nem o admin dela) não muda isso. Sem nada salvo, o plano tem todas as do plano.

import { useState, useTransition } from 'react'
import { PLANS, type PlanId } from '@/lib/config/plans'
import { THEO_TOOLS, toolsForPlanFeatures } from '@/lib/ai/theo-catalog'
import { setPlanTheoTools } from '@/lib/actions/theo'

export function TheoPlanTools({ planFeatures, initial }: { planFeatures: Record<PlanId, string[]>; initial: Record<PlanId, string[] | null> }) {
  const start0 = () => {
    const m = {} as Record<PlanId, Set<string>>
    for (const p of PLANS) m[p.id] = new Set(initial[p.id] ?? toolsForPlanFeatures(planFeatures[p.id]).map(t => t.name))
    return m
  }
  const [sel, setSel] = useState(start0)
  const [dirty, setDirty] = useState<Set<PlanId>>(new Set())
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const groups = [...new Set(THEO_TOOLS.map(t => t.group))]

  function toggle(plan: PlanId, name: string) {
    setSel(s => { const n = new Set(s[plan]); if (n.has(name)) n.delete(name); else n.add(name); return { ...s, [plan]: n } })
    setDirty(d => new Set(d).add(plan)); setMsg(null)
  }
  function save() {
    start(async () => {
      for (const plan of dirty) {
        const allowed = new Set(toolsForPlanFeatures(planFeatures[plan]).map(t => t.name))
        const r = await setPlanTheoTools(plan, [...sel[plan]].filter(n => allowed.has(n)))
        if (!r.ok) { setMsg(`Erro em ${plan}: ${r.error}`); return }
      }
      setDirty(new Set())
      setMsg('✓ Ações do Théo salvas. Vale na próxima pergunta de cada empresa.')
    })
  }

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 px-6 py-4">
        <h2 className="text-base font-semibold text-gray-800">🤖 Ações do Théo por plano</h2>
        <p className="mt-0.5 text-xs text-gray-400">
          O que o assistente pode consultar e fazer em cada licença. Só dá para marcar o que é de uma aba que o plano tem (cinza = aba fora do plano).
          Ações só acontecem depois que a pessoa confirma na tela. A empresa paga o uso com a própria chave de IA.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-6 py-3 text-left">Ferramenta</th>
              {PLANS.map(p => <th key={p.id} className="px-4 py-3 text-center">{p.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {groups.map(g => (
              <FragmentRows key={g} group={g}>
                {THEO_TOOLS.filter(t => t.group === g).map(t => (
                  <tr key={t.name} className="border-t border-gray-100">
                    <td className="px-6 py-2 text-gray-800">
                      <span className={`mr-2 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${t.kind === 'acao' ? 'bg-warn-100 text-warn-700' : 'bg-brand-100 text-brand-700'}`}>{t.kind === 'acao' ? 'AÇÃO' : 'CONSULTA'}</span>
                      {t.label}
                    </td>
                    {PLANS.map(p => {
                      const inPlan = t.feature === '*' || planFeatures[p.id].includes(t.feature)
                      return (
                        <td key={p.id} className="px-4 py-2 text-center">
                          <input type="checkbox" disabled={!inPlan} checked={inPlan && sel[p.id].has(t.name)} onChange={() => toggle(p.id, t.name)}
                            aria-label={`${t.label} no plano ${p.label}`} className="h-4 w-4 accent-[#1b556b] disabled:opacity-30" />
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </FragmentRows>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 px-6 py-4">
        <button onClick={save} disabled={pending || dirty.size === 0}
          className="rounded-lg bg-[#1b556b] px-5 py-2 text-sm font-medium text-white hover:bg-[#154459] disabled:opacity-50">
          {pending ? 'Salvando…' : 'Salvar ações do Théo'}
        </button>
        {msg && <span className="text-sm text-gray-600">{msg}</span>}
      </div>
    </div>
  )
}

function FragmentRows({ group, children }: { group: string; children: React.ReactNode }) {
  return (
    <>
      <tr className="bg-gray-50/60"><td colSpan={PLANS.length + 1} className="px-6 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500">{group}</td></tr>
      {children}
    </>
  )
}
