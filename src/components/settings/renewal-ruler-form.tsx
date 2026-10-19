'use client'

import { useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { saveRulerSettings } from '@/lib/actions/renewal-ruler'
import {
  RULER_VARIABLES, DEFAULT_RULER_TEMPLATES, renderRuler, brDate, dueDate,
  type RulerArea, type RulerSettings, type RulerStep, type RulerTemplates,
} from '@/lib/agent/renewal-ruler'

const box = 'rounded-xl border border-gray-200 bg-white p-5 space-y-4'
const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-700 focus:outline-none'
const SAMPLE_END = '2027-03-31'

const MAILS: { key: 'step' | 'overdue' | 'ready'; label: string; hint: string }[] = [
  { key: 'step', label: 'Chegou um passo', hint: 'Vai para as áreas do passo quando ele passa a ser o atual.' },
  { key: 'overdue', label: 'Passo atrasado', hint: 'Vai uma vez, no dia seguinte ao prazo, se o passo não foi marcado.' },
  { key: 'ready', label: 'Pronto para renovar', hint: 'Vai para todas as áreas da régua quando o último passo é concluído.' },
]

const newId = () => `passo-${Math.random().toString(36).slice(2, 8)}`
export function RenewalRulerForm({ initial, companyName }: { initial: RulerSettings; companyName: string }) {
  const [enabled, setEnabled] = useState(initial.enabled)
  const [lock, setLock] = useState(initial.lock_renewed)
  const [areas, setAreas] = useState<(RulerArea & { emailsText: string })[]>(
    initial.areas.map(a => ({ ...a, emailsText: a.emails.join(', ') })),
  )
  const [steps, setSteps] = useState<RulerStep[]>(initial.steps)
  const [templates, setTemplates] = useState<RulerTemplates>(initial.templates)
  const [mail, setMail] = useState<'step' | 'overdue' | 'ready'>('step')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const touch = () => setMsg(null)

  const ordered = [...steps].sort((a, b) => b.days_before - a.days_before)
  const outOfOrder = ordered.some((s, i) => s.id !== steps[i]?.id)

  function setStep(i: number, patch: Partial<RulerStep>) { touch(); setSteps(s => s.map((x, j) => (j === i ? { ...x, ...patch } : x))) }
  function move(i: number, d: -1 | 1) {
    touch()
    setSteps(s => { const n = [...s]; const j = i + d; if (j < 0 || j >= n.length) return s; [n[i], n[j]] = [n[j], n[i]]; return n })
  }
  function setArea(i: number, patch: Partial<RulerArea & { emailsText: string }>) { touch(); setAreas(a => a.map((x, j) => (j === i ? { ...x, ...patch } : x))) }
  function removeArea(i: number) {
    touch()
    const key = areas[i].key
    setAreas(a => a.filter((_, j) => j !== i))
    setSteps(s => s.map(x => ({ ...x, areas: x.areas.filter(k => k !== key) })))
  }

  async function save() {
    setSaving(true); setMsg(null)
    const res = await saveRulerSettings({
      enabled, lock_renewed: lock, templates,
      areas: areas.map(a => ({ key: a.key, label: a.label.trim(), emails: a.emailsText.split(/[,;\s]+/).map(e => e.trim()).filter(Boolean) })),
      steps: steps.map(s => ({ ...s, label: s.label.trim() })),
    })
    setSaving(false)
    setMsg(res.ok ? { ok: true, text: 'Régua salva. Vale para as próximas renovações; as que já estão em andamento seguem os passos de quando começaram.' } : { ok: false, text: res.error })
  }

  // Prévia do e-mail com dados de exemplo
  const sampleStep = ordered[1] ?? ordered[0]
  const sampleIdx = Math.max(0, ordered.indexOf(sampleStep))
  const vars: Record<string, string> = {
    cliente: 'Cliente Exemplo', contrato: 'CT-0001', vencimento: brDate(SAMPLE_END),
    passo: sampleStep?.label ?? 'Passo', numero: `${sampleIdx + 1} de ${ordered.length}`,
    prazo: brDate(dueDate(SAMPLE_END, sampleStep?.days_before ?? 0)),
    anterior: sampleIdx > 0 ? ordered[sampleIdx - 1].label : '—',
    consultor: 'Nome do consultor', empresa: companyName || 'Sua empresa', link: 'https://…/contracts/…',
  }
  const subjKey = `${mail}_subject` as keyof RulerTemplates
  const bodyKey = `${mail}_body` as keyof RulerTemplates

  return (
    <div className="space-y-5 max-w-4xl">
      <section className={box}>
        <h2 className="text-sm font-semibold text-gray-900">Funcionamento</h2>
        <p className="text-xs text-gray-500">
          A régua começa sozinha quando o consultor envia ao cliente o aviso de renovação (o 1º passo já fica feito).
          Também dá para iniciar manualmente na oportunidade. Dali em diante tudo é interno: o cliente não recebe nada da régua.
        </p>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={enabled} onChange={e => { touch(); setEnabled(e.target.checked) }} />
          <span><b>Usar a régua de renovação</b><br /><span className="text-xs text-gray-500">Desligada, nenhuma régua nova começa (as abertas continuam).</span></span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={lock} onChange={e => { touch(); setLock(e.target.checked) }} />
          <span><b>Só marcar &quot;Renovado&quot; depois de concluir todos os passos</b><br />
            <span className="text-xs text-gray-500">Ao concluir o último passo, a IA cria para o consultor a tarefa de revisar e marcar Renovado.</span></span>
        </label>
      </section>

      <section className={box}>
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Áreas e e-mails</h2>
          <p className="text-xs text-gray-500">Quem recebe os avisos. Separe vários e-mails por vírgula.</p>
        </div>
        <div className="space-y-2">
          {areas.map((a, i) => (
            <div key={a.key} className="grid gap-2 sm:grid-cols-[200px_1fr_auto] items-start">
              <input className={input} value={a.label} maxLength={60} placeholder="Nome da área" onChange={e => setArea(i, { label: e.target.value })} />
              <input className={input} value={a.emailsText} placeholder="pessoa@empresa.com, outra@empresa.com" onChange={e => setArea(i, { emailsText: e.target.value })} />
              <button type="button" onClick={() => removeArea(i)} className="rounded-lg p-2 text-gray-400 hover:bg-negative-100 hover:text-negative-700" title="Remover área">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => { touch(); setAreas(a => [...a, { key: `area-${Math.random().toString(36).slice(2, 8)}`, label: 'Nova área', emails: [], emailsText: '' }]) }}
          className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
          <Plus className="h-4 w-4" /> Adicionar área
        </button>
      </section>

      <section className={box}>
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Passos</h2>
          <p className="text-xs text-gray-500">
            O prazo de cada passo é contado a partir do vencimento do contrato. Os passos seguem do prazo mais distante para o mais próximo.
          </p>
        </div>
        {outOfOrder && (
          <p className="rounded-lg bg-warn-100 px-3 py-2 text-xs text-warn-700">
            A ordem da lista não bate com os dias: na oportunidade, os passos aparecem pelo prazo (mais dias antes primeiro).
          </p>
        )}
        <div className="space-y-3">
          {steps.map((s, i) => (
            <div key={s.id} className="rounded-lg border border-gray-200 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">{i + 1}</span>
                <input className={input} value={s.label} maxLength={120} placeholder="Nome do passo" onChange={e => setStep(i, { label: e.target.value })} />
                <div className="flex shrink-0 items-center gap-1">
                  <input type="number" className={`${input} w-20`} value={Number.isFinite(s.days_before) ? s.days_before : ''} min={-60} max={365}
                    onChange={e => setStep(i, { days_before: e.target.value === '' ? NaN : Math.round(Number(e.target.value)) })} />
                  <span className="text-xs text-gray-500 whitespace-nowrap">dias antes</span>
                </div>
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="rounded p-1 text-gray-400 hover:text-brand-700 disabled:opacity-30" title="Subir"><ArrowUp className="h-4 w-4" /></button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === steps.length - 1} className="rounded p-1 text-gray-400 hover:text-brand-700 disabled:opacity-30" title="Descer"><ArrowDown className="h-4 w-4" /></button>
                <button type="button" onClick={() => { touch(); setSteps(x => x.filter((_, j) => j !== i)) }} className="rounded p-1 text-gray-400 hover:text-negative-700" title="Remover passo"><Trash2 className="h-4 w-4" /></button>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-8">
                <span className="text-xs text-gray-500">Avisar:</span>
                {areas.map(a => (
                  <label key={a.key} className="flex items-center gap-1 text-xs text-gray-700">
                    <input type="checkbox" checked={s.areas.includes(a.key)}
                      onChange={e => setStep(i, { areas: e.target.checked ? [...s.areas, a.key] : s.areas.filter(k => k !== a.key) })} />
                    {a.label || '(sem nome)'}
                  </label>
                ))}
                {!s.areas.length && <span className="text-xs text-warn-700">nenhuma área: ninguém recebe e-mail neste passo</span>}
              </div>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => { touch(); setSteps(s => [...s, { id: newId(), label: '', days_before: 5, areas: [] }]) }}
          className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
          <Plus className="h-4 w-4" /> Adicionar passo
        </button>
      </section>

      <section className={box}>
        <div>
          <h2 className="text-sm font-semibold text-gray-900">E-mails às áreas</h2>
          <p className="text-xs text-gray-500">Use as variáveis entre chaves duplas; elas são trocadas pelos dados do contrato. *Texto entre asteriscos* sai em negrito.</p>
        </div>
        <div className="flex flex-wrap gap-1 border-b border-gray-200">
          {MAILS.map(m => (
            <button key={m.key} type="button" onClick={() => setMail(m.key)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm ${mail === m.key ? 'border-brand-700 font-semibold text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
              {m.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500">{MAILS.find(m => m.key === mail)?.hint}</p>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <label className="block text-xs font-medium text-gray-700">Assunto</label>
            <input className={input} value={templates[subjKey]} maxLength={200} onChange={e => { touch(); setTemplates(t => ({ ...t, [subjKey]: e.target.value })) }} />
            <label className="block text-xs font-medium text-gray-700">Texto</label>
            <textarea className={`${input} min-h-[220px] font-mono text-xs`} value={templates[bodyKey]} maxLength={3000}
              onChange={e => { touch(); setTemplates(t => ({ ...t, [bodyKey]: e.target.value })) }} />
            <div className="flex items-center justify-between text-xs text-gray-400">
              <button type="button" className="text-brand-700 hover:underline"
                onClick={() => { touch(); setTemplates(t => ({ ...t, [subjKey]: DEFAULT_RULER_TEMPLATES[subjKey], [bodyKey]: DEFAULT_RULER_TEMPLATES[bodyKey] })) }}>
                Voltar ao texto padrão
              </button>
              <span>{templates[bodyKey].length.toLocaleString('pt-BR')} / 3.000</span>
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium text-gray-700">Prévia (dados de exemplo)</p>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs">
              <p className="font-semibold text-gray-900">{renderRuler(templates[subjKey], vars)}</p>
              <p className="mt-2 whitespace-pre-wrap text-gray-700">{renderRuler(templates[bodyKey], vars)}</p>
            </div>
            <p className="text-xs font-medium text-gray-700">Variáveis</p>
            <ul className="grid grid-cols-1 gap-x-3 text-xs text-gray-500 sm:grid-cols-2">
              {RULER_VARIABLES.map(v => <li key={v.key}><code className="text-brand-700">{`{{${v.key}}}`}</code> {v.description}</li>)}
            </ul>
          </div>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={saving}
          className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">
          {saving ? 'Salvando…' : 'Salvar régua'}
        </button>
        {msg && <p className={`text-sm ${msg.ok ? 'text-positive-700' : 'text-negative-700'}`}>{msg.text}</p>}
      </div>
    </div>
  )
}
