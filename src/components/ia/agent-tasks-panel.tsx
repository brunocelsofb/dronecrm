'use client'
// Tarefas dos agentes (tela IA da empresa, só admin): liga/desliga, dias da semana,
// pausa e tarefas escritas pelo admin.
import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { WEEKDAYS, statusLabel, customStatusLabel, BRIEFING_SECTIONS, ALL_BRIEFING_SECTIONS, MAX_BRIEFING_EXTRA, MAX_CUSTOM_TASKS, MAX_PROMPT_CHARS, MAX_TITLE_CHARS, type TaskState, type TaskParam, type TaskOptions } from '@/lib/agent/agent-tasks'
import { saveBuiltinTask, saveCustomTask, deleteCustomTask, testCustomTask, saveTaskParams, saveTaskOptions, previewBuiltinTask, type PreviewView } from '@/lib/actions/agent-tasks'

export type BuiltinView = {
  key: string; agent: string; title: string; description: string; sends: string; state: TaskState; params: TaskParam[]; values: Record<string, number>
  recipients: ('assignee' | 'whatsapp' | 'email')[]; assigneeDefault: string; recipientsNote: string; monthly: boolean; options: TaskOptions
}
export type Person = { id: string; name: string }
type Ctx = { team: Person[]; managerPhone: string; managerEmail: string }
export type CustomView = TaskState & { id: string; title: string; prompt: string; recipientPhone: string; monthDay: number | null; lastRunAt: string | null; lastStatus: string | null }

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

export function Switch({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-brand-700' : 'bg-gray-300'}`}>
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  )
}

export function DayPicker({ days, onChange, disabled }: { days: number[]; onChange: (d: number[]) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label="Dias da semana">
      {DAY_ORDER.map(d => {
        const on = days.includes(d)
        return (
          <button key={d} type="button" disabled={disabled} aria-pressed={on}
            onClick={() => onChange(on ? days.filter(x => x !== d) : [...days, d].sort((a, b) => a - b))}
            className={`h-7 min-w-9 rounded-md border px-1.5 text-xs font-medium disabled:opacity-50 ${on ? 'border-brand-700 bg-brand-700 text-white' : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'}`}>
            {WEEKDAYS[d]}
          </button>
        )
      })}
    </div>
  )
}

function PauseControl({ value, onChange, disabled, today }: { value: string | null; onChange: (v: string | null) => void; disabled?: boolean; today: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-gray-600">
      <label className="flex items-center gap-1.5">
        Pausar até
        <input type="date" min={today} value={value ?? ''} disabled={disabled}
          onChange={e => onChange(e.target.value || null)}
          className="rounded-md border border-gray-300 px-1.5 py-1 text-xs" />
      </label>
      {value && <button type="button" disabled={disabled} onClick={() => onChange(null)} className="font-medium text-brand-700 hover:underline">Retomar</button>}
    </div>
  )
}

// Prazos da tarefa (ex.: avisos aos 90/60/30/15 dias): edita ali mesmo e salva no botão
function ParamsEditor({ taskKey, params, initial }: { taskKey: string; params: TaskParam[]; initial: Record<string, number> }) {
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(params.map(p => [p.key, String(initial[p.key] ?? p.def)])))
  const [saved, setSaved] = useState(v)
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const dirty = params.some(p => v[p.key] !== saved[p.key])
  const save = () => start(async () => {
    setMsg(null)
    const r = await saveTaskParams(taskKey, Object.fromEntries(params.map(p => [p.key, Number(v[p.key])])))
    if (r.ok) { setSaved(v); setMsg('Salvo') } else setMsg(r.error)
  })
  return (
    <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-2">
      {params.map(p => (
        <label key={p.key} className="text-[11px] text-gray-600">
          <span className="block">{p.label}</span>
          <span className="mt-0.5 flex items-center gap-1">
            <input type="number" inputMode="numeric" min={p.min} max={p.max} value={v[p.key]}
              onChange={e => { setV({ ...v, [p.key]: e.target.value }); setMsg(null) }}
              onKeyDown={e => { if (e.key === 'Enter' && dirty) save() }}
              className="w-16 rounded-md border border-gray-300 px-1.5 py-1 text-sm text-gray-900" />
            <span className="text-gray-400">{p.unit}</span>
          </span>
        </label>
      ))}
      {dirty && (
        <span className="flex items-center gap-2">
          <button type="button" onClick={save} disabled={pending} className="rounded-md bg-brand-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50">{pending ? 'Salvando…' : 'Salvar prazos'}</button>
          <button type="button" onClick={() => { setV(saved); setMsg(null) }} className="text-xs text-gray-500 hover:underline">Desfazer</button>
        </span>
      )}
      {msg && <span className={`text-xs ${msg === 'Salvo' ? 'text-gray-400' : 'text-negative-600'}`}>{msg}</span>}
    </div>
  )
}

// Testar: mostra o que a tarefa criaria e enviaria hoje, sem criar nem enviar nada
function PreviewBox({ taskKey, costly }: { taskKey: string; costly: boolean }) {
  const [p, setP] = useState<PreviewView | null>(null)
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const run = () => start(async () => {
    setOpen(true); setP(null)
    setP(await previewBuiltinTask(taskKey).catch(() => ({ ok: false, error: 'Sem conexão. Tente de novo.', notes: [], messages: [], activities: [], totalActivities: 0 })))
  })
  return (
    <div className="mt-2">
      <button type="button" onClick={run} disabled={pending}
        className="rounded-md border border-brand-700 px-2.5 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-100 disabled:opacity-50">
        {pending ? 'Testando…' : 'Testar'}
      </button>
      <span className="ml-2 text-[10px] text-gray-400">Mostra o que sairia hoje; nada é criado nem enviado.{costly ? ' Usa a IA (tem custo).' : ''}</span>
      {open && (
        <div className="mt-2 space-y-2 rounded-md border border-gray-200 bg-gray-50 p-3">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Prévia — nada foi enviado</p>
            <button type="button" onClick={() => setOpen(false)} className="text-xs text-gray-500 hover:underline">Fechar</button>
          </div>
          {pending && <p className="text-xs text-gray-500">Rodando a tarefa em modo prévia…</p>}
          {p?.error && <p className="text-xs text-negative-600">{p.error}</p>}
          {p?.notes.map(n => <p key={n} className="text-xs text-gray-600">• {n}</p>)}
          {p?.messages.map((m, i) => (
            <div key={i} className="rounded-md border border-gray-200 bg-white p-2.5">
              <p className="text-[11px] text-gray-500">{m.kind === 'whatsapp' ? '💬 WhatsApp' : '✉️ E-mail'} para <span className="font-medium text-gray-700">{m.to}</span>{m.subject ? ` · ${m.subject}` : ''}</p>
              {m.kind === 'whatsapp'
                ? <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap font-sans text-sm text-gray-800">{m.text}</pre>
                : <iframe title={m.subject ?? 'E-mail'} sandbox="" srcDoc={m.html} className="mt-1 h-80 w-full rounded border border-gray-100 bg-white" />}
            </div>
          ))}
          {p && p.totalActivities > 0 && (
            <div className="rounded-md border border-gray-200 bg-white p-2.5">
              <p className="text-[11px] text-gray-500">📋 {p.totalActivities} atividade(s) que seriam abertas{p.totalActivities > p.activities.length ? ` (mostrando ${p.activities.length})` : ''}</p>
              <ul className="mt-1 divide-y divide-gray-100">
                {p.activities.map((a, i) => (
                  <li key={i} className="py-1.5">
                    <p className="text-sm text-gray-800">{a.title}</p>
                    <p className="text-[11px] text-gray-500">Para {a.who}{a.due ? ` · ${a.due.split('-').reverse().join('/')}` : ''}</p>
                    <details className="text-[11px] text-gray-500"><summary className="cursor-pointer">ver texto</summary><p className="mt-1 whitespace-pre-wrap">{a.content}</p></details>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {p && p.ok && !p.messages.length && !p.totalActivities && !p.notes.length && <p className="text-xs text-gray-500">Nada sairia hoje.</p>}
        </div>
      )}
    </div>
  )
}

// Quem faz, quem recebe e (no resumo do dia) o que aparece: edita ali mesmo e salva no botão
function OptionsEditor({ t, ctx }: { t: BuiltinView; ctx: Ctx }) {
  const isBriefing = t.key === 'briefing'
  const initial = {
    assignee: t.options.assignee ?? '',
    notify_whatsapp: t.options.notify_whatsapp ?? '',
    notify_email: t.options.notify_email ?? '',
    briefing_sections: t.options.briefing_sections ?? ALL_BRIEFING_SECTIONS,
    briefing_extra: t.options.briefing_extra ?? '',
  }
  const [v, setV] = useState(initial)
  const [saved, setSaved] = useState(initial)
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const dirty = JSON.stringify(v) !== JSON.stringify(saved)
  const save = () => start(async () => {
    setMsg(null)
    const r = await saveTaskOptions(t.key, v)
    if (r.ok) { setSaved(v); setMsg('Salvo') } else setMsg(r.error)
  })
  const has = (k: 'assignee' | 'whatsapp' | 'email') => t.recipients.includes(k)
  if (!t.recipients.length && !isBriefing) return t.recipientsNote ? <p className="mt-1 text-[11px] text-gray-400">{t.recipientsNote}</p> : null
  const toggle = (k: string) => setV({ ...v, briefing_sections: v.briefing_sections.includes(k) ? v.briefing_sections.filter(x => x !== k) : [...v.briefing_sections, k] })
  const input = 'mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-900'
  return (
    <div className="mt-2 space-y-2">
      {(has('assignee') || has('whatsapp') || has('email')) && (
        <div className="grid gap-2 sm:grid-cols-3">
          {has('assignee') && (
            <label className="text-[11px] text-gray-600">Quem faz a tarefa
              <select value={v.assignee} onChange={e => { setV({ ...v, assignee: e.target.value }); setMsg(null) }} className={input}>
                <option value="">{t.assigneeDefault || 'Padrão'} (padrão)</option>
                {ctx.team.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          )}
          {has('whatsapp') && (
            <label className="text-[11px] text-gray-600">WhatsApp que recebe
              <input value={v.notify_whatsapp} inputMode="tel" onChange={e => { setV({ ...v, notify_whatsapp: e.target.value }); setMsg(null) }}
                placeholder={ctx.managerPhone ? `Gestor: ${ctx.managerPhone}` : 'Gestor (Configurações → Agentes IA)'} className={input} />
            </label>
          )}
          {has('email') && (
            <label className="text-[11px] text-gray-600">E-mail que recebe
              <input value={v.notify_email} type="email" onChange={e => { setV({ ...v, notify_email: e.target.value }); setMsg(null) }}
                placeholder={ctx.managerEmail ? `Gestor: ${ctx.managerEmail}` : 'Gestor (Configurações → Agentes IA)'} className={input} />
            </label>
          )}
        </div>
      )}
      {isBriefing && (
        <div className="rounded-md border border-gray-100 p-2.5">
          <p className="text-[11px] font-semibold text-gray-600">O que aparece no resumo</p>
          {(['dados', 'blocos'] as const).map(g => (
            <div key={g} className="mt-1.5">
              <p className="text-[10px] uppercase tracking-wide text-gray-400">{g === 'dados' ? 'Assuntos' : 'Blocos que a IA escreve'}</p>
              <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-1">
                {BRIEFING_SECTIONS.filter(x => x.group === g).map(x => (
                  <label key={x.key} className="flex items-center gap-1.5 text-xs text-gray-700">
                    <input type="checkbox" checked={v.briefing_sections.includes(x.key)} onChange={() => { toggle(x.key); setMsg(null) }} className="h-3.5 w-3.5 accent-brand-700" />
                    {x.label}
                  </label>
                ))}
              </div>
            </div>
          ))}
          <label className="mt-2 block text-[11px] text-gray-600">Quero ver também (opcional)
            <textarea value={v.briefing_extra} maxLength={MAX_BRIEFING_EXTRA} rows={2} onChange={e => { setV({ ...v, briefing_extra: e.target.value }); setMsg(null) }}
              placeholder="Ex.: destaque os 5 contratos de maior valor que vencem nos próximos 60 dias."
              className={input} />
            <span className="text-[10px] text-gray-400">A IA responde com os dados do resumo. Para outros dados, crie uma tarefa escrita abaixo.</span>
          </label>
        </div>
      )}
      {t.recipientsNote && <p className="text-[11px] text-gray-400">{t.recipientsNote}</p>}
      {(dirty || msg) && (
        <span className="flex items-center gap-2">
          {dirty && <button type="button" onClick={save} disabled={pending} className="rounded-md bg-brand-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50">{pending ? 'Salvando…' : isBriefing ? 'Salvar resumo' : 'Salvar destinatários'}</button>}
          {dirty && <button type="button" onClick={() => { setV(saved); setMsg(null) }} className="text-xs text-gray-500 hover:underline">Desfazer</button>}
          {msg && <span className={`text-xs ${msg === 'Salvo' ? 'text-gray-400' : 'text-negative-600'}`}>{msg}</span>}
        </span>
      )}
    </div>
  )
}

function BuiltinRow({ t, today, ctx }: { t: BuiltinView; today: string; ctx: Ctx }) {
  // A tela muda na hora; salva um instante depois do último clique (vários dias de uma vez = um envio só)
  const [s, setS] = useState<TaskState>(t.state)
  const [msg, setMsg] = useState<string | null>(null)
  const saved = useRef<TaskState>(t.state)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seq = useRef(0)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const save = (next: TaskState) => {
    setS(next); setMsg('Salvando…')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      timer.current = null
      const mine = ++seq.current
      const r = await saveBuiltinTask(t.key, next).catch(() => ({ ok: false as const, error: 'Sem conexão. Tente de novo.' }))
      if (mine !== seq.current || timer.current) return // houve outro clique depois: o envio mais novo vale
      if (r.ok) { saved.current = next; setMsg('Salvo') }
      else { setS(saved.current); setMsg(r.error) }
    }, 600)
  }
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 gap-3">
        <Switch on={s.enabled} label={`Ligar ${t.title}`} onChange={v => save({ ...s, enabled: v })} />
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900">{t.title} <span className="text-[11px] font-normal text-gray-400">· {t.agent}</span></p>
          <p className="text-xs text-gray-500">{t.description} <span className="text-gray-400">Envia: {t.sends}.</span></p>
          {t.params.length > 0 && <ParamsEditor taskKey={t.key} params={t.params} initial={t.values} />}
          <OptionsEditor t={t} ctx={ctx} />
          <PreviewBox taskKey={t.key} costly={t.key === 'briefing'} />
          <p className={`mt-0.5 text-[11px] font-medium ${s.enabled && !(s.pausedUntil && s.pausedUntil >= today) ? 'text-brand-700' : 'text-gray-400'}`}>
            {statusLabel(s, today)}{msg && <span className={msg === 'Salvo' || msg === 'Salvando…' ? 'ml-2 text-gray-400' : 'ml-2 text-negative-600'}>{msg}</span>}
          </p>
        </div>
      </div>
      <div className={`flex flex-col gap-1.5 sm:items-end ${s.enabled ? '' : 'opacity-50'}`}>
        {t.monthly
          ? <p className="text-xs text-gray-600">Uma vez por mês{t.values.due_day ? `, a partir do dia ${t.values.due_day}` : t.values.report_day ? `, a partir do dia ${t.values.report_day}` : ''}</p>
          : <DayPicker days={s.days} disabled={!s.enabled} onChange={d => save({ ...s, days: d })} />}
        <PauseControl value={s.pausedUntil} today={today} disabled={!s.enabled} onChange={v => save({ ...s, pausedUntil: v })} />
      </div>
    </li>
  )
}

const EMPTY: Omit<CustomView, 'id'> = { title: '', prompt: '', recipientPhone: '', monthDay: null, enabled: true, days: [1, 2, 3, 4, 5], pausedUntil: null, lastRunAt: null, lastStatus: null }

function CustomForm({ initial, today, onDone }: { initial: Omit<CustomView, 'id'> & { id?: string }; today: string; onDone: () => void }) {
  const router = useRouter()
  const [f, setF] = useState(initial)
  const [err, setErr] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const [testing, startTest] = useTransition()

  const save = () => start(async () => {
    setErr(null)
    const r = await saveCustomTask({ id: f.id ?? null, title: f.title, prompt: f.prompt, recipientPhone: f.recipientPhone, monthDay: f.monthDay, enabled: f.enabled, days: f.days, pausedUntil: f.pausedUntil })
    if (!r.ok) { setErr(r.error); return }
    router.refresh(); onDone()
  })
  const test = () => startTest(async () => {
    setErr(null); setResult(null)
    if (!f.id) { setErr('Salve a tarefa antes de testar.'); return }
    const r = await testCustomTask(f.id)
    if (r.ok) setResult(r.text); else setErr(r.error)
  })
  const remove = () => {
    if (!f.id || !window.confirm(`Excluir a tarefa "${f.title}"?`)) return
    start(async () => {
      const r = await deleteCustomTask(f.id!)
      if (!r.ok) { setErr(r.error); return }
      router.refresh(); onDone()
    })
  }

  return (
    <div className="space-y-3 rounded-md border border-brand-100 bg-brand-100/40 p-4">
      <label className="block text-xs font-medium text-gray-700">Nome da tarefa
        <input value={f.title} maxLength={MAX_TITLE_CHARS} onChange={e => setF({ ...f, title: e.target.value })}
          placeholder="Ex.: Contratos que vencem no mês"
          className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm" />
      </label>
      <label className="block text-xs font-medium text-gray-700">O que a IA deve fazer
        <textarea value={f.prompt} maxLength={MAX_PROMPT_CHARS} rows={4} onChange={e => setF({ ...f, prompt: e.target.value })}
          placeholder="Ex.: Liste os contratos que vencem nos próximos 30 dias, com cliente, data e valor mensal, do mais próximo ao mais distante."
          className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm" />
        <span className="mt-0.5 block text-[11px] font-normal text-gray-400">{f.prompt.length}/{MAX_PROMPT_CHARS} · a IA só consulta os dados que o Théo da licença consulta; não cria nem altera nada.</span>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium text-gray-700">Quando</p>
          <div className="mt-1 flex gap-3 text-xs text-gray-700">
            <label className="flex items-center gap-1"><input type="radio" checked={f.monthDay == null} onChange={() => setF({ ...f, monthDay: null })} className="accent-brand-700" /> Dias da semana</label>
            <label className="flex items-center gap-1"><input type="radio" checked={f.monthDay != null} onChange={() => setF({ ...f, monthDay: f.monthDay ?? 1 })} className="accent-brand-700" /> Uma vez por mês</label>
          </div>
          <div className="mt-1.5">
            {f.monthDay == null
              ? <DayPicker days={f.days} onChange={d => setF({ ...f, days: d })} />
              : <label className="flex items-center gap-1.5 text-xs text-gray-600">No dia
                  <input type="number" min={1} max={28} value={f.monthDay} onChange={e => setF({ ...f, monthDay: e.target.value === '' ? 1 : Number(e.target.value) })}
                    className="w-16 rounded-md border border-gray-300 px-1.5 py-1 text-sm" /> de cada mês (1 a 28)</label>}
          </div>
        </div>
        <label className="block text-xs font-medium text-gray-700">WhatsApp que recebe (opcional)
          <input value={f.recipientPhone} inputMode="tel" onChange={e => setF({ ...f, recipientPhone: e.target.value })}
            placeholder="Vazio = WhatsApp do gestor"
            className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm" />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-xs text-gray-700">
          <Switch on={f.enabled} label="Tarefa ligada" onChange={v => setF({ ...f, enabled: v })} /> Ligada
        </label>
        <PauseControl value={f.pausedUntil} today={today} onChange={v => setF({ ...f, pausedUntil: v })} />
      </div>
      {err && <p className="text-xs text-negative-600">{err}</p>}
      {result && (
        <div className="rounded-md border border-gray-200 bg-white p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Resultado do teste (não foi enviado)</p>
          <pre className="mt-1 whitespace-pre-wrap font-sans text-sm text-gray-800">{result}</pre>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={save} disabled={pending} className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50">{pending ? 'Salvando…' : 'Salvar'}</button>
        {f.id && <button type="button" onClick={test} disabled={testing} className="rounded-md border border-brand-700 px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-100 disabled:opacity-50">{testing ? 'Testando…' : 'Testar agora'}</button>}
        <button type="button" onClick={onDone} className="rounded-md px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100">Fechar</button>
        {f.id && <button type="button" onClick={remove} disabled={pending} className="ml-auto rounded-md px-3 py-1.5 text-xs text-negative-600 hover:bg-negative-100">Excluir</button>}
      </div>
    </div>
  )
}

export function AgentTasksPanel({ builtins, customs, today, customAllowed, theoOn, team, managerPhone, managerEmail }: {
  builtins: BuiltinView[]; customs: CustomView[]; today: string; customAllowed: boolean; theoOn: boolean
  team: Person[]; managerPhone: string; managerEmail: string
}) {
  const ctx: Ctx = { team, managerPhone, managerEmail }
  const [editing, setEditing] = useState<string | null>(null) // id ou 'new'
  const groups = [...new Set(builtins.map(b => b.agent))]
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="text-base font-semibold text-gray-900">Tarefas agendadas</h2>
      <p className="mt-1 text-sm text-gray-600">Ligue ou desligue cada tarefa, escolha os dias da semana ou pause até uma data. Os horários continuam os de sempre.</p>

      {builtins.length > 0 && groups.map(g => (
        <div key={g} className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">{g}</p>
          <ul className="divide-y divide-gray-100">{builtins.filter(b => b.agent === g).map(t => <BuiltinRow key={t.key} t={t} today={today} ctx={ctx} />)}</ul>
        </div>
      ))}

      {customAllowed && (
        <div className="mt-6 border-t border-gray-100 pt-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Tarefas escritas por você</p>
              <p className="text-xs text-gray-500">Escreva o pedido; nos dias marcados, por volta das 7h30, a IA do Théo consulta o CRM e manda a resposta no WhatsApp. O custo é da conta de IA da empresa.</p>
            </div>
            {editing !== 'new' && customs.length < MAX_CUSTOM_TASKS && (
              <button type="button" onClick={() => setEditing('new')} className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800">+ Nova tarefa</button>
            )}
          </div>
          {!theoOn && <p className="mt-2 rounded-md bg-warn-100 px-3 py-2 text-xs text-warn-700">O Théo está desligado: as tarefas escritas só rodam depois de ligar a IA em Configurações → Assistente Théo.</p>}
          {editing === 'new' && <div className="mt-3"><CustomForm initial={EMPTY} today={today} onDone={() => setEditing(null)} /></div>}
          <ul className="mt-2 divide-y divide-gray-100">
            {customs.map(c => (
              <li key={c.id} className="py-3">
                {editing === c.id ? <CustomForm initial={c} today={today} onDone={() => setEditing(null)} /> : (
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">{c.title}</p>
                      <p className="line-clamp-2 text-xs text-gray-500">{c.prompt}</p>
                      <p className="mt-0.5 text-[11px] text-gray-400">
                        {customStatusLabel(c, today)} · {c.recipientPhone ? `para ${c.recipientPhone}` : 'para o gestor'}
                        {c.lastRunAt && ` · última vez ${new Date(c.lastRunAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}: ${c.lastStatus ?? ''}`}
                      </p>
                    </div>
                    <button type="button" onClick={() => setEditing(c.id)} className="text-xs font-medium text-brand-700 hover:underline">Editar</button>
                  </div>
                )}
              </li>
            ))}
            {!customs.length && editing !== 'new' && <li className="py-3 text-xs text-gray-400">Nenhuma tarefa escrita ainda.</li>}
          </ul>
        </div>
      )}
    </section>
  )
}
