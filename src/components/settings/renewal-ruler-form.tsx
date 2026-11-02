'use client'

import { useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { saveRulerSettings } from '@/lib/actions/renewal-ruler'
import {
  RULER_VARIABLES, DEFAULT_RULER_TEMPLATES, RULER_MODEL_STEPS, RULER_PREP_STEP, RULER_WHO_LABEL, MAX_STEP_INSTRUCTIONS, renderRuler, brDate, dueDate,
  type RulerWho, type RulerSettings, type RulerStep, type RulerTemplates,
} from '@/lib/agent/renewal-ruler'

const box = 'rounded-xl border border-gray-200 bg-white p-5 space-y-4'
const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-700 focus:outline-none'
const SAMPLE_END = '2027-03-31'

const MAILS: { key: 'step' | 'overdue' | 'ready'; label: string; hint: string }[] = [
  { key: 'step', label: 'Chegou um passo', hint: 'Vai para os e-mails de fora cadastrados nas áreas do passo (coordenador e gerente já recebem pela tarefa; no passo do consultor, eles também recebem este e-mail).' },
  { key: 'overdue', label: 'Passo atrasado', hint: 'Vai para coordenador, gerente e e-mails de fora das áreas do passo no dia seguinte ao prazo, se o passo não foi marcado, e se repete a cada N dias (definido acima) até ser marcado.' },
  { key: 'ready', label: 'Pronto para renovar', hint: 'Vai para coordenador, gerente e e-mails de fora de todas as áreas da régua quando o último passo é concluído.' },
]

const newId = () => `passo-${Math.random().toString(36).slice(2, 8)}`
// orgAreas: áreas da empresa (Central de regras → Áreas e IA): coordenador recebe a tarefa, gerente o aviso
// levels: marcos da Central de regras → Renovação (preparar e avisos ao cliente)
export function RenewalRulerForm({ initial, companyName, orgAreas = [], levels }: {
  initial: RulerSettings; companyName: string; orgAreas?: { id: string; name: string; coordinator: string; manager: string }[]
  levels: { prep: number; a1: number; a2: number; a3: number }
}) {
  const [enabled, setEnabled] = useState(initial.enabled)
  const [lock, setLock] = useState(initial.lock_renewed)
  const [repeat, setRepeat] = useState(String(initial.overdue_repeat_days))
  const [skipBy, setSkipBy] = useState<'team' | 'admin'>(initial.skip_by)
  const [steps, setSteps] = useState<RulerStep[]>(initial.steps)
  const [templates, setTemplates] = useState<RulerTemplates>(initial.templates)
  const [mail, setMail] = useState<'step' | 'overdue' | 'ready'>('step')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [modelAsk, setModelAsk] = useState(false)
  const touch = () => setMsg(null)

  const ordered = [...steps].sort((a, b) => b.days_before - a.days_before)
  const outOfOrder = ordered.some((s, i) => s.id !== steps[i]?.id)

  function setStep(i: number, patch: Partial<RulerStep>) { touch(); setSteps(s => s.map((x, j) => (j === i ? { ...x, ...patch } : x))) }
  function move(i: number, d: -1 | 1) {
    touch()
    setSteps(s => { const n = [...s]; const j = i + d; if (j < 0 || j >= n.length) return s; [n[i], n[j]] = [n[j], n[i]]; return n })
  }

  async function save() {
    setSaving(true); setMsg(null)
    const res = await saveRulerSettings({
      enabled, lock_renewed: lock, skip_by: skipBy, overdue_repeat_days: repeat.trim() === '' ? NaN : Number(repeat), templates,
      areas: [], // lista antiga de e-mails (substituída pelas áreas da empresa)
      steps: steps.map(s => ({ ...s, label: s.label.trim(), areas: s.areas.filter(k => k.startsWith('area:')) })),
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
          A régua começa sozinha aos <b>{levels.prep} dias</b> do vencimento, junto com a tarefa &quot;preparar a renovação&quot; (o dia é editado na Central de regras → Renovação).
          Também dá para iniciar manualmente na oportunidade. A régua é interna: o cliente não recebe nada dela. Os avisos ao cliente ({levels.a1}, {levels.a2}, {levels.a3} dias e vencido)
          são escritos pelo agente Farmer e o consultor revisa e envia.
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
              <div className="flex flex-wrap items-center gap-2 text-sm">
          <span><b>Passo atrasado:</b> repetir o aviso às áreas a cada</span>
          <input type="number" min={0} max={30} value={repeat} onChange={e => { touch(); setRepeat(e.target.value) }}
            className="w-16 rounded-lg border border-gray-300 px-2 py-1 text-sm focus:border-brand-700 focus:outline-none" />
          <span>dias, até o passo ser marcado ou o contrato ser renovado.</span>
          <span className="w-full text-xs text-gray-500">Use 0 para avisar só uma vez. No atraso, o agente Farmer cobra quem está com a tarefa aberta (sino, WhatsApp e e-mail) e avisa o gerente da área.</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span><b>Seguir sem um passo</b> (&quot;passar fora do processo&quot;, digitando a palavra de confirmação):</span>
          <select value={skipBy} onChange={e => { touch(); setSkipBy(e.target.value as 'team' | 'admin') }} aria-label="Quem pode passar um passo fora do processo"
            className="rounded-lg border border-gray-300 px-2 py-1 text-sm focus:border-brand-700 focus:outline-none">
            <option value="team">qualquer pessoa da equipe</option>
            <option value="admin">só o administrador</option>
          </select>
          <span className="w-full text-xs text-gray-500">Fica registrado quem passou, o motivo e quais áreas não concluíram.</span>
        </div>
      </section>

      <section className={box}>
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Passos</h2>
          <p className="text-xs text-gray-500">
            O prazo de cada passo é contado a partir do vencimento do contrato. Os passos seguem do prazo mais distante para o mais próximo.
          </p>
        </div>
        {!steps.some(x => x.days_before >= levels.prep) && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-warn-100 px-3 py-2 text-xs text-warn-700">
            <span>A régua começa aos {levels.prep} dias, mas nenhum passo tem esse prazo: as áreas não recebem o aviso interno do início.</span>
            <button type="button" className="font-semibold underline" onClick={() => { touch(); setSteps(x => [{ ...RULER_PREP_STEP, days_before: levels.prep, id: x.some(y => y.id === 'preparar') ? newId() : 'preparar' }, ...x]) }}>
              Adicionar o passo &quot;Preparar a renovação&quot; ({levels.prep} dias)
            </button>
          </div>
        )}
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
              {s.done_when !== 'client_notice' && (
                <div className="space-y-2 pl-8">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span className="text-xs text-gray-500">Quem faz:</span>
                    <select value={s.who ?? 'owner'} onChange={e => setStep(i, { who: e.target.value as RulerWho })}
                      className="rounded border border-gray-300 px-1.5 py-0.5 text-xs" aria-label="Quem faz o passo">
                      {(Object.keys(RULER_WHO_LABEL) as RulerWho[]).map(k => <option key={k} value={k}>{k === 'agent' ? '🤖 ' : '👤 '}{RULER_WHO_LABEL[k]}</option>)}
                    </select>
                    <label className="flex items-center gap-1 text-xs text-gray-700">
                      <input type="checkbox" checked={!!s.requires_file} onChange={e => setStep(i, { requires_file: e.target.checked })} />
                      só conclui com arquivo anexado ao contrato
                    </label>
                    {i > 0 && (
                      <label className="flex items-center gap-1 text-xs text-gray-700" title="Os dois passos chegam no mesmo momento e correm em paralelo">
                        <input type="checkbox" checked={!!s.with_previous} onChange={e => setStep(i, { with_previous: e.target.checked })} />
                        começa junto com o passo anterior
                      </label>
                    )}
                  </div>
                  <textarea value={s.instructions ?? ''} maxLength={MAX_STEP_INSTRUCTIONS} rows={2} onChange={e => setStep(i, { instructions: e.target.value })}
                    placeholder={s.who === 'agent' ? 'O que o agente de IA deve preparar (ex.: pauta da reunião, texto da comunicação interna)…' : 'O que fazer neste passo (opcional; vai na tarefa)…'}
                    className={`${input} text-xs`} />
                  {s.who === 'agent' && (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <span className="text-xs text-gray-500">Ao concluir, enviar o texto revisado para (coordenador, gerente, time e e-mails de fora):</span>
                      {orgAreas.map(a => {
                        const k = `area:${a.id}`
                        const on = (s.send_areas ?? []).includes(k)
                        return (
                          <label key={k} className="flex items-center gap-1 text-xs text-gray-700">
                            <input type="checkbox" checked={on} onChange={e => setStep(i, { send_areas: e.target.checked ? [...(s.send_areas ?? []), k] : (s.send_areas ?? []).filter(x => x !== k) })} />
                            {a.name}
                          </label>
                        )
                      })}
                      {!orgAreas.length && <a href="/regras?tema=areas" className="text-xs text-brand-700 hover:underline">cadastre as áreas da empresa →</a>}
                      <span className="w-full text-[11px] text-gray-500">{(s.send_areas ?? []).length ? 'Quem revisa vê o texto do agente ao concluir, ajusta e envia.' : 'Nenhuma marcada: o texto fica só na tarefa (não é enviado).'}</span>
                    </div>
                  )}
                  {s.who === 'agent' && <p className="text-[11px] text-gray-500">O agente prepara com os dados do contrato e o que já foi feito nos passos anteriores; a pessoa revisa e conclui. Sem IA (modo sem IA, sem chave ou sem orçamento), vira tarefa comum.</p>}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-8">
                <span className="text-xs text-gray-500">{s.who === 'owner' ? 'Áreas (só recebem o e-mail; a tarefa é do consultor):' : 'Encaminhar para (cada área marcada recebe a sua tarefa; o passo fecha quando todas concluírem):'}</span>
                {orgAreas.map(a => {
                  const k = `area:${a.id}`
                  return (
                    <label key={k} className="flex items-center gap-1 text-xs text-gray-700" title={`Coordenador: ${a.coordinator} · Gerente: ${a.manager}`}>
                      <input type="checkbox" checked={s.areas.includes(k)}
                        onChange={e => setStep(i, { areas: e.target.checked ? [...s.areas, k] : s.areas.filter(x => x !== k) })} />
                      {a.name}
                    </label>
                  )
                })}
                {!orgAreas.length && <a href="/regras?tema=areas" className="text-xs text-brand-700 hover:underline">cadastre as áreas da empresa →</a>}
                {orgAreas.length > 0 && !s.areas.some(k => k.startsWith('area:')) && s.who !== 'owner' && s.done_when !== 'client_notice' && <span className="text-xs text-warn-700">nenhuma área: a tarefa vai para o consultor</span>}
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-8">
                <span className="text-xs text-gray-500">Concluído quando:</span>
                <select value={s.done_when ?? 'manual'} onChange={e => setStep(i, { done_when: e.target.value as 'manual' | 'client_notice' })}
                  className="rounded border border-gray-300 px-1.5 py-0.5 text-xs">
                  <option value="manual">quem recebeu escreve o que fez e conclui</option>
                  <option value="client_notice">o consultor envia o aviso ao cliente (marca sozinho)</option>
                </select>
                {s.done_when === 'client_notice' && (
                  <span className="w-full text-xs text-gray-500">
                    <span className="rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700">🤖 AGENTE FARMER</span> escreve o aviso aos {levels.a1} dias;
                    o consultor revisa e envia; este passo se marca sozinho quando o aviso sai. Texto do aviso: Configurações → Copiloto.
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <button type="button" onClick={() => { touch(); setSteps(s => [...s, { id: newId(), label: '', days_before: 5, areas: [], who: 'owner' }]) }}
            className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
            <Plus className="h-4 w-4" /> Adicionar passo
          </button>
          {modelAsk
            ? <span className="flex items-center gap-2 text-xs text-gray-700">Trocar os passos atuais pelo modelo?
                <button type="button" className="font-semibold text-brand-700 hover:underline" onClick={() => { setSteps(RULER_MODEL_STEPS.map(x => ({ ...x, days_before: x.id === 'preparar' ? levels.prep : x.days_before }))); setModelAsk(false); setMsg({ ok: true, text: 'Modelo carregado: escolha as áreas, ajuste o que quiser e clique em Salvar régua.' }) }}>Sim, carregar</button>
                <button type="button" className="text-gray-500 hover:underline" onClick={() => setModelAsk(false)}>Não</button></span>
            : <button type="button" onClick={() => setModelAsk(true)} className="text-sm text-gray-500 hover:text-brand-700 hover:underline">Usar modelo sugerido ({RULER_MODEL_STEPS.length} passos)</button>}
        </div>
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
