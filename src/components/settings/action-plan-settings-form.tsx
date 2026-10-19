'use client'

import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { saveActionPlanSettings } from '@/lib/actions/action-plans'
import { DEFAULT_ISHIKAWA, type ActionPlanSettings } from '@/lib/quality/action-plan'

const box = 'rounded-xl border border-gray-200 bg-white p-5 space-y-3'

const TOOLS: { key: keyof ActionPlanSettings['tools']; label: string; text: string }[] = [
  { key: 'w5h2', label: '5W2H', text: 'Cada ação com o quê, por quê, onde, quando, quem, como e quanto custa. Desligado, a ação pede só o quê, quem e quando.' },
  { key: 'cinco_porques', label: '5 Porquês', text: 'Pergunta "por quê?" até 5 vezes para chegar à causa raiz. Bom para reclamação, detrator e SLA estourado.' },
  { key: 'ishikawa', label: 'Ishikawa (espinha de peixe)', text: 'Lista possíveis causas por categoria. Bom para problema que se repete ou tem várias causas.' },
  { key: 'gut', label: 'Matriz GUT', text: 'Gravidade × Urgência × Tendência (1 a 5 cada). Ordena as tratativas pela prioridade.' },
]

export function ActionPlanSettingsForm({ initial }: { initial: ActionPlanSettings }) {
  const [tools, setTools] = useState(initial.tools)
  const [requireEff, setRequireEff] = useState(initial.require_efficacy)
  const [cats, setCats] = useState(initial.ishikawa_categories)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const touch = () => setMsg(null)

  async function save() {
    setSaving(true); setMsg(null)
    const r = await saveActionPlanSettings({ tools, require_efficacy: requireEff, ishikawa_categories: cats })
    setSaving(false)
    setMsg(r.ok ? { ok: true, text: 'Salvo. Vale para todas as tratativas da empresa.' } : { ok: false, text: r.error })
  }

  return (
    <div className="max-w-3xl space-y-5">
      <section className={box}>
        <h2 className="text-sm font-semibold text-gray-900">Como funciona</h2>
        <p className="text-xs text-gray-600">
          Cada problema com o cliente vira uma <b>tratativa</b> no ciclo <b>PDCA</b>: <b>Planejar</b> (problema, prioridade, causa e ações) →
          <b> Executar</b> (as ações) → <b>Checar</b> (resolveu?) → <b>Agir</b> (padronizar para não voltar a acontecer).
          Detratores de pesquisa abrem uma tratativa sozinhos. Para ocultar a aba em algum funil, use Configurações → Layout das abas.
        </p>
      </section>

      <section className={box}>
        <h2 className="text-sm font-semibold text-gray-900">Ferramentas da qualidade</h2>
        {TOOLS.map(t => (
          <label key={t.key} className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={tools[t.key]} onChange={e => { touch(); setTools({ ...tools, [t.key]: e.target.checked }) }} />
            <span><b>{t.label}</b><br /><span className="text-xs text-gray-500">{t.text}</span></span>
          </label>
        ))}
      </section>

      <section className={box}>
        <h2 className="text-sm font-semibold text-gray-900">Verificação de eficácia</h2>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={requireEff} onChange={e => { touch(); setRequireEff(e.target.checked) }} />
          <span><b>Obrigatória para encerrar</b><br />
            <span className="text-xs text-gray-500">Ligada, a tratativa só encerra depois de registrar se resolveu e o que foi padronizado (exigência comum da ISO 9001). Desligada, pode encerrar quando as ações terminam.</span></span>
        </label>
      </section>

      {tools.ishikawa && (
        <section className={box}>
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Categorias do Ishikawa</h2>
            <p className="text-xs text-gray-500">Padrão: os 6M adaptados a serviços. Ajuste para a realidade da empresa (2 a 8 categorias).</p>
          </div>
          {cats.map((c, i) => (
            <div key={c.key} className="flex items-center gap-2">
              <input className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-brand-700 focus:outline-none" value={c.label} maxLength={40}
                onChange={e => { touch(); setCats(cats.map((x, j) => (j === i ? { ...x, label: e.target.value } : x))) }} />
              <button type="button" onClick={() => { touch(); setCats(cats.filter((_, j) => j !== i)) }} className="rounded p-1.5 text-gray-400 hover:text-negative-700" title="Remover"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          <div className="flex gap-4">
            {cats.length < 8 && (
              <button type="button" onClick={() => { touch(); setCats([...cats, { key: `cat-${Math.random().toString(36).slice(2, 7)}`, label: 'Nova categoria' }]) }}
                className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"><Plus className="h-4 w-4" /> Adicionar categoria</button>
            )}
            <button type="button" onClick={() => { touch(); setCats(DEFAULT_ISHIKAWA) }} className="text-sm text-gray-500 hover:underline">Voltar ao padrão</button>
          </div>
        </section>
      )}

      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={saving} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">
          {saving ? 'Salvando…' : 'Salvar'}
        </button>
        {msg && <p className={`text-sm ${msg.ok ? 'text-positive-700' : 'text-negative-700'}`}>{msg.text}</p>}
      </div>
    </div>
  )
}
