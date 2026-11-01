'use client'
// Regras dos agentes: QUANDO [critério] E [condições] → FAÇA [ações] PARA [quem].
// Só opções do catálogo; a frase mostra exatamente o que a regra faz.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  RULE_CRITERIA, CONDITION_LABEL, RULE_VARIABLES, LEAD_SOURCES, TICKET_PRIORITIES, criterionDef, ruleSentence,
  type RuleActions, type RuleConditions, type RuleAgent,
} from '@/lib/agent/rules-catalog'
import { saveAgentRule, toggleAgentRule, deleteAgentRule, createSuggestedRules, previewAgentRule, type RulePreview } from '@/lib/actions/agent-rules'
import { Switch, DayPicker } from '@/components/ia/agent-tasks-panel'
import { fmtBRL } from '@/lib/format'

export type RuleView = {
  id: string; agent: RuleAgent; name: string; criterion: string; threshold: number
  conditions: RuleConditions; actions: RuleActions; days: number[]; enabled: boolean
  lastRunAt: string | null; lastStatus: string | null
}
type Opt = { id: string; name: string }
type Ctx = { features: string[]; only?: string[]; pipelines: Opt[]; stages: (Opt & { pipeline_id: string })[]; team: Opt[]; managerPhone: string }

const AGENT_LABEL: Record<RuleAgent, string> = { hunter: 'Hunter — novos negócios', farmer: 'Farmer — carteira de clientes' }
const input = 'mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900'

function names(ctx: Ctx, r: Pick<RuleView, 'conditions'>) {
  return {
    pipeline: ctx.pipelines.find(p => p.id === r.conditions.pipeline_id)?.name,
    stage: ctx.stages.find(s => s.id === r.conditions.stage_id)?.name,
    person: (id: string) => ctx.team.find(p => p.id === id)?.name ?? 'pessoa escolhida',
    fmtBRL: (v: number) => fmtBRL(v),
  }
}

function PreviewResult({ p }: { p: RulePreview }) {
  return (
    <div className="space-y-2 rounded-md border border-gray-200 bg-gray-50 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Prévia de hoje — nada foi criado nem enviado</p>
      {p.error && <p className="text-xs text-negative-600">{p.error}</p>}
      {!p.error && (
        <p className="text-xs text-gray-700">A regra pega <b>{p.found}</b> caso(s) hoje; <b>{p.fresh}</b> ainda não tratado(s){p.found > p.fresh ? ' (os outros já foram tratados antes e não repetem)' : ''}.</p>
      )}
      {p.cases.length > 0 && (
        <ul className="max-h-40 overflow-auto rounded border border-gray-100 bg-white px-2 py-1 text-xs text-gray-700">
          {p.cases.map((c, i) => <li key={i} className="py-0.5">• {c.name} <span className="text-gray-400">— {c.detail}</span></li>)}
        </ul>
      )}
      {p.items.map((it, i) => (
        <div key={i} className="rounded-md border border-gray-200 bg-white p-2">
          <p className="text-[11px] text-gray-500">{it.kind === 'tarefa' ? '📋 Tarefa' : it.kind === 'aviso' ? '🔔 Aviso' : '💬 WhatsApp'} para <b className="text-gray-700">{it.to}</b></p>
          {it.kind === 'tarefa' && <p className="text-sm text-gray-800">{it.title}</p>}
          <p className="whitespace-pre-wrap text-xs text-gray-600">{it.text}</p>
        </div>
      ))}
    </div>
  )
}

const EMPTY = (features: string[], only?: string[]): Omit<RuleView, 'id' | 'lastRunAt' | 'lastStatus'> => {
  const c = RULE_CRITERIA.find(x => features.includes(x.feature) && (!only || only.includes(x.key))) ?? RULE_CRITERIA[0]
  return { agent: c.agent, name: '', criterion: c.key, threshold: c.def, conditions: {}, days: [1, 2, 3, 4, 5], enabled: true,
    actions: { task: { enabled: true, title: 'Verificar — {{nome}}', text: '', due_days: 1, assignee: 'owner' } } }
}

function RuleEditor({ initial, id, ctx, onDone }: { initial: Omit<RuleView, 'id' | 'lastRunAt' | 'lastStatus'>; id: string | null; ctx: Ctx; onDone: () => void }) {
  const router = useRouter()
  const [r, setR] = useState(initial)
  const [err, setErr] = useState<string | null>(null)
  const [prev, setPrev] = useState<RulePreview | null>(null)
  const [saving, startSave] = useTransition()
  const [testing, startTest] = useTransition()
  const def = criterionDef(r.criterion)
  const a = r.actions
  const setA = (k: keyof RuleActions, v: Record<string, unknown>) => setR({ ...r, actions: { ...a, [k]: { ...(a[k] ?? {}), ...v } } as RuleActions })
  const setC = (v: Partial<RuleConditions>) => setR({ ...r, conditions: { ...r.conditions, ...v } })
  const payload = () => ({ ...r, conditions: r.conditions })

  const pickCriterion = (key: string) => {
    const d = criterionDef(key)
    if (!d) return
    setR({ ...r, criterion: key, agent: d.agent, threshold: d.def, conditions: {} })
    setPrev(null)
  }
  const save = () => startSave(async () => {
    setErr(null)
    const res = await saveAgentRule(id, payload())
    if (!res.ok) { setErr(res.error); return }
    router.refresh(); onDone()
  })
  const test = () => startTest(async () => {
    setErr(null); setPrev(null)
    setPrev(await previewAgentRule(id, payload()).catch(() => ({ ok: false, error: 'Sem conexão. Tente de novo.', found: 0, fresh: 0, cases: [], items: [] })))
  })

  const assigneeSelect = (value: string, onChange: (v: string) => void) => (
    <select value={value} onChange={e => onChange(e.target.value)} className={input}>
      <option value="owner">{def?.ownerLabel ?? 'Responsável'}</option>
      {ctx.team.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  )

  return (
    <div className="space-y-3 rounded-md border border-brand-100 bg-brand-100/40 p-4">
      <label className="block text-xs font-medium text-gray-700">Nome da regra
        <input value={r.name} maxLength={80} onChange={e => setR({ ...r, name: e.target.value })} placeholder="Ex.: Retomar oportunidade parada" className={input} />
      </label>

      <div className="rounded-md bg-white p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-700">Quando</p>
        <div className="mt-1 grid gap-2 sm:grid-cols-[1fr_auto]">
          <select value={r.criterion} onChange={e => pickCriterion(e.target.value)} className={input}>
            {(['hunter', 'farmer'] as const).map(ag => (
              <optgroup key={ag} label={AGENT_LABEL[ag]}>
                {RULE_CRITERIA.filter(c => c.agent === ag && ctx.features.includes(c.feature) && (!ctx.only || ctx.only.includes(c.key))).map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
              </optgroup>
            ))}
          </select>
          {def && (
            <label className="flex items-center gap-1.5 text-xs text-gray-600">
              <input type="number" min={def.min} max={def.max} value={r.threshold} onChange={e => setR({ ...r, threshold: Number(e.target.value) })}
                className="w-20 rounded-md border border-gray-300 px-2 py-1.5 text-sm" /> {def.unit}
            </label>
          )}
        </div>
        {def && <p className="mt-1 text-[11px] text-gray-500">{def.explain}</p>}

        {def && def.conditions.length > 0 && (
          <>
            <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-brand-700">E (opcional)</p>
            <div className="mt-1 grid gap-2 sm:grid-cols-3">
              {def.conditions.includes('pipeline') && (
                <label className="text-[11px] text-gray-600">{CONDITION_LABEL.pipeline}
                  <select value={r.conditions.pipeline_id ?? ''} onChange={e => setC({ pipeline_id: e.target.value || null, stage_id: null })} className={input}>
                    <option value="">Todos</option>
                    {ctx.pipelines.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
              )}
              {def.conditions.includes('stage') && (
                <label className="text-[11px] text-gray-600">{CONDITION_LABEL.stage}
                  <select value={r.conditions.stage_id ?? ''} disabled={!r.conditions.pipeline_id} onChange={e => setC({ stage_id: e.target.value || null })} className={input}>
                    <option value="">{r.conditions.pipeline_id ? 'Todas' : 'Escolha o funil'}</option>
                    {ctx.stages.filter(s => s.pipeline_id === r.conditions.pipeline_id).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
              )}
              {def.conditions.includes('min_value') && (
                <label className="text-[11px] text-gray-600">{CONDITION_LABEL.min_value}
                  <input type="number" min={0} step="0.01" value={r.conditions.min_value ?? ''} placeholder="Qualquer valor"
                    onChange={e => setC({ min_value: e.target.value === '' ? null : Number(e.target.value) })} className={input} />
                </label>
              )}
              {def.conditions.includes('lead_source') && (
                <label className="text-[11px] text-gray-600">{CONDITION_LABEL.lead_source}
                  <select value={r.conditions.lead_source ?? ''} onChange={e => setC({ lead_source: e.target.value || null })} className={input}>
                    <option value="">Todas</option>
                    {Object.entries(LEAD_SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
              )}
              {def.conditions.includes('priority') && (
                <label className="text-[11px] text-gray-600">{CONDITION_LABEL.priority}
                  <select value={r.conditions.priority ?? ''} onChange={e => setC({ priority: e.target.value || null })} className={input}>
                    <option value="">Todas</option>
                    {Object.entries(TICKET_PRIORITIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
              )}
            </div>
          </>
        )}
      </div>

      <div className="rounded-md bg-white p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-700">Faça</p>
        <div className="mt-1 space-y-3">
          <div>
            <label className="flex items-center gap-2 text-sm text-gray-800">
              <input type="checkbox" checked={!!a.task?.enabled} onChange={e => setA('task', { enabled: e.target.checked, title: a.task?.title ?? 'Verificar — {{nome}}', text: a.task?.text ?? '', due_days: a.task?.due_days ?? 1, assignee: a.task?.assignee ?? 'owner' })} className="accent-brand-700" />
              Abrir uma tarefa
            </label>
            {a.task?.enabled && (
              <div className="mt-1 grid gap-2 pl-6 sm:grid-cols-2">
                <label className="text-[11px] text-gray-600">Título<input value={a.task.title} maxLength={120} onChange={e => setA('task', { title: e.target.value })} className={input} /></label>
                <label className="text-[11px] text-gray-600">Para{assigneeSelect(a.task.assignee, v => setA('task', { assignee: v }))}</label>
                <label className="text-[11px] text-gray-600 sm:col-span-2">Texto (opcional)<textarea rows={2} maxLength={1000} value={a.task.text} onChange={e => setA('task', { text: e.target.value })} className={input} /></label>
                <label className="text-[11px] text-gray-600">Prazo
                  <span className="flex items-center gap-1.5"><input type="number" min={0} max={60} value={a.task.due_days} onChange={e => setA('task', { due_days: Number(e.target.value) })} className="mt-0.5 w-20 rounded-md border border-gray-300 px-2 py-1.5 text-sm" /> dia(s) (0 = hoje)</span>
                </label>
              </div>
            )}
          </div>
          <div>
            <label className="flex items-center gap-2 text-sm text-gray-800">
              <input type="checkbox" checked={!!a.notify?.enabled} onChange={e => setA('notify', { enabled: e.target.checked, assignee: a.notify?.assignee ?? 'owner', message: a.notify?.message ?? '' })} className="accent-brand-700" />
              Avisar no sino do CRM
            </label>
            {a.notify?.enabled && (
              <div className="mt-1 grid gap-2 pl-6 sm:grid-cols-2">
                <label className="text-[11px] text-gray-600">Para{assigneeSelect(a.notify.assignee, v => setA('notify', { assignee: v }))}</label>
                <label className="text-[11px] text-gray-600">Mensagem (opcional)<input value={a.notify.message} maxLength={300} onChange={e => setA('notify', { message: e.target.value })} className={input} /></label>
              </div>
            )}
          </div>
          <div>
            <label className="flex items-center gap-2 text-sm text-gray-800">
              <input type="checkbox" checked={!!a.whatsapp?.enabled} onChange={e => setA('whatsapp', { enabled: e.target.checked, to: a.whatsapp?.to ?? null })} className="accent-brand-700" />
              Mandar a lista no WhatsApp (uma mensagem por rodada)
            </label>
            {a.whatsapp?.enabled && (
              <div className="mt-1 pl-6 sm:w-1/2">
                <label className="text-[11px] text-gray-600">Número<input value={a.whatsapp.to ?? ''} inputMode="tel" onChange={e => setA('whatsapp', { to: e.target.value })}
                  placeholder={ctx.managerPhone ? `Gestor: ${ctx.managerPhone}` : 'Gestor (Configurações → Agentes IA)'} className={input} /></label>
              </div>
            )}
          </div>
          <p className="text-[10px] text-gray-400">Nos textos: {RULE_VARIABLES.map(v => `{{${v.key}}} ${v.description.toLowerCase()}`).join(' · ')}. Nada é enviado ao cliente por estas regras.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div><p className="text-[11px] text-gray-600">Dias em que roda (por volta das 7h30)</p><DayPicker days={r.days} onChange={d => setR({ ...r, days: d })} /></div>
        <label className="flex items-center gap-2 text-xs text-gray-700"><Switch on={r.enabled} label="Regra ligada" onChange={v => setR({ ...r, enabled: v })} /> Ligada</label>
      </div>

      <p className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800">{ruleSentence(r, names(ctx, r))}</p>
      {err && <p className="text-xs text-negative-600">{err}</p>}
      {prev && <PreviewResult p={prev} />}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={save} disabled={saving} className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50">{saving ? 'Salvando…' : 'Salvar'}</button>
        <button type="button" onClick={test} disabled={testing} className="rounded-md border border-brand-700 px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-100 disabled:opacity-50">{testing ? 'Testando…' : 'Testar'}</button>
        <button type="button" onClick={onDone} className="rounded-md px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100">Fechar</button>
      </div>
    </div>
  )
}

function RuleCard({ r, ctx, onEdit }: { r: RuleView; ctx: Ctx; onEdit: () => void }) {
  const router = useRouter()
  const [on, setOn] = useState(r.enabled)
  const [msg, setMsg] = useState<string | null>(null)
  const [prev, setPrev] = useState<RulePreview | null>(null)
  const [pending, start] = useTransition()
  const toggle = (v: boolean) => { setOn(v); start(async () => { const x = await toggleAgentRule(r.id, v); if (!x.ok) { setOn(!v); setMsg(x.error) } }) }
  const test = () => start(async () => { setPrev(null); setPrev(await previewAgentRule(r.id, r)) })
  const remove = () => {
    if (!window.confirm(`Excluir a regra "${r.name}"?`)) return
    start(async () => { const x = await deleteAgentRule(r.id); if (x.ok) router.refresh(); else setMsg(x.error) })
  }
  return (
    <li className="py-3">
      <div className="flex gap-3">
        <Switch on={on} label={`Ligar ${r.name}`} onChange={toggle} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900">{r.name}</p>
          <p className="text-xs text-gray-600">{ruleSentence(r, names(ctx, r))}</p>
          <p className="mt-0.5 text-[11px] text-gray-400">
            {on ? 'Ligada' : 'Desligada'} · {r.days.length === 7 ? 'todos os dias' : r.days.length === 5 && !r.days.includes(0) && !r.days.includes(6) ? 'segunda a sexta' : `${r.days.length} dia(s) por semana`}
            {r.lastRunAt && ` · última rodada ${new Date(r.lastRunAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}: ${r.lastStatus ?? ''}`}
            {msg && <span className="ml-2 text-negative-600">{msg}</span>}
          </p>
          <div className="mt-1 flex gap-3 text-xs">
            <button type="button" onClick={onEdit} className="font-medium text-brand-700 hover:underline">Editar</button>
            <button type="button" onClick={test} disabled={pending} className="font-medium text-brand-700 hover:underline disabled:opacity-50">{pending ? 'Testando…' : 'Testar'}</button>
            <button type="button" onClick={remove} disabled={pending} className="text-negative-600 hover:underline">Excluir</button>
          </div>
          {prev && <div className="mt-2"><PreviewResult p={prev} /></div>}
        </div>
      </div>
    </li>
  )
}

// criteria: só os critérios deste tema da Central de regras (vazio = todos)
export function RulesManager({ rules: allRules, ctx: baseCtx, criteria }: { rules: RuleView[]; ctx: Ctx; criteria?: string[] }) {
  const ctx: Ctx = criteria?.length ? { ...baseCtx, only: criteria } : baseCtx
  const rules = criteria?.length ? allRules.filter(r => criteria.includes(r.criterion)) : allRules
  const router = useRouter()
  const [editing, setEditing] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const suggest = () => start(async () => { setErr(null); const r = await createSuggestedRules(); if (r.ok) router.refresh(); else setErr(r.error) })
  const available = RULE_CRITERIA.some(c => ctx.features.includes(c.feature) && (!ctx.only || ctx.only.includes(c.key)))
  if (!available) return null
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {editing !== 'new' && <button type="button" onClick={() => setEditing('new')} className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800">+ Nova regra do agente</button>}
        {!criteria?.length && <button type="button" onClick={suggest} disabled={pending} className="rounded-md border border-brand-700 px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-100 disabled:opacity-50">
          {pending ? 'Criando…' : 'Criar regras sugeridas'}
        </button>}
        {err && <span className="self-center text-xs text-negative-600">{err}</span>}
      </div>
      {editing === 'new' && <div className="mt-3"><RuleEditor initial={EMPTY(ctx.features, ctx.only)} id={null} ctx={ctx} onDone={() => setEditing(null)} /></div>}
      {(['hunter', 'farmer'] as const).map(ag => {
        const list = rules.filter(r => r.agent === ag)
        if (!list.length) return null
        return (
          <div key={ag} className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">🤖 Agente {AGENT_LABEL[ag]}</p>
            <ul className="divide-y divide-gray-100">
              {list.map(r => editing === r.id
                ? <li key={r.id} className="py-3"><RuleEditor initial={r} id={r.id} ctx={ctx} onDone={() => setEditing(null)} /></li>
                : <RuleCard key={r.id} r={r} ctx={ctx} onEdit={() => setEditing(r.id)} />)}
            </ul>
          </div>
        )
      })}
      {!rules.length && editing !== 'new' && <p className="mt-3 text-xs text-gray-400">Nenhuma regra própria neste tema ainda.</p>}
    </div>
  )
}
