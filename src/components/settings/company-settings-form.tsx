'use client'

import { useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { saveCompanySettings } from '@/lib/actions/company-settings'
import { DEFAULT_SEGMENTS, type CompanySettings } from '@/lib/companies/settings'

const box = 'rounded-xl border border-gray-200 bg-white p-5 space-y-3'
const input = 'w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-brand-700 focus:outline-none'

export function CompanySettingsForm({ initial }: { initial: CompanySettings }) {
  const [segments, setSegments] = useState(initial.segments)
  const [months, setMonths] = useState(String(initial.inactive_months))
  const [weekly, setWeekly] = useState(initial.hunter_weekly)
  const [tasks, setTasks] = useState(initial.hunter_tasks)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const touch = () => setMsg(null)
  const move = (i: number, d: -1 | 1) => { touch(); setSegments(s => { const n = [...s]; const j = i + d; if (j < 0 || j >= n.length) return s; [n[i], n[j]] = [n[j], n[i]]; return n }) }

  async function save() {
    setSaving(true); setMsg(null)
    const r = await saveCompanySettings({ segments, inactive_months: Number(months), hunter_weekly: weekly, hunter_tasks: tasks })
    setSaving(false)
    setMsg(r.ok ? { ok: true, text: 'Salvo.' } : { ok: false, text: r.error })
  }

  return (
    <div className="max-w-2xl space-y-5">
      <section className={box}>
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Segmentos</h2>
          <p className="text-xs text-gray-500">Toda empresa nova precisa de um segmento. Use para filtrar a base e montar campanhas (ex.: só Grupo Hospitalar).</p>
        </div>
        {segments.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <input className={input} value={s} maxLength={80} onChange={e => { touch(); setSegments(x => x.map((y, j) => (j === i ? e.target.value : y))) }} />
            <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="p-1 text-gray-400 hover:text-brand-700 disabled:opacity-30" title="Subir"><ArrowUp className="h-4 w-4" /></button>
            <button type="button" onClick={() => move(i, 1)} disabled={i === segments.length - 1} className="p-1 text-gray-400 hover:text-brand-700 disabled:opacity-30" title="Descer"><ArrowDown className="h-4 w-4" /></button>
            <button type="button" onClick={() => { touch(); setSegments(x => x.filter((_, j) => j !== i)) }} className="p-1 text-gray-400 hover:text-negative-700" title="Remover"><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
        <div className="flex gap-4">
          <button type="button" onClick={() => { touch(); setSegments(x => [...x, '']) }} className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"><Plus className="h-4 w-4" /> Adicionar segmento</button>
          <button type="button" onClick={() => { touch(); setSegments(DEFAULT_SEGMENTS) }} className="text-sm text-gray-500 hover:underline">Voltar ao padrão</button>
        </div>
        <p className="text-[11px] text-gray-500">Renomear um segmento aqui não muda as empresas já cadastradas com o nome antigo.</p>
      </section>

      <section className={box}>
        <h2 className="text-sm font-semibold text-gray-900">Clientes inativos</h2>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>Inativo = já comprou, está <b>sem contrato ativo</b> e <b>sem compra</b> há</span>
          <input type="number" min={1} max={60} value={months} onChange={e => { touch(); setMonths(e.target.value) }} className="w-16 rounded-lg border border-gray-300 px-2 py-1 text-sm" />
          <span>meses.</span>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={weekly} onChange={e => { touch(); setWeekly(e.target.checked) }} />
          <span><b>Resumo semanal do Hunter ao gestor</b><br /><span className="text-xs text-gray-500">Toda segunda: quantos inativos por segmento e os de maior valor, para montar campanha.</span></span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={tasks} onChange={e => { touch(); setTasks(e.target.checked) }} />
          <span><b>Tarefa de reativação ao responsável da conta</b><br /><span className="text-xs text-gray-500">Uma por empresa quando ela fica inativa (não repete enquanto a tarefa estiver aberta).</span></span>
        </label>
      </section>

      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={saving} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">{saving ? 'Salvando…' : 'Salvar'}</button>
        {msg && <p className={`text-sm ${msg.ok ? 'text-positive-700' : 'text-negative-700'}`}>{msg.text}</p>}
      </div>
    </div>
  )
}
