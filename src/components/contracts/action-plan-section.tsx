'use client'

// Plano de Ação: tratativas no ciclo PDCA, com as ferramentas que a empresa
// ligou em Configurações → Plano de ação (5W2H, 5 Porquês, Ishikawa, GUT).

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react'
import {
  createActionPlan, updateActionPlan, addPlanAction, setPlanActionStatus, deletePlanAction,
  advancePlan, checkPlanEfficacy, cancelActionPlan, reopenActionPlan, deleteActionPlan,
} from '@/lib/actions/action-plans'
import { updateActionPlanItemStatus, deleteActionPlanItem } from '@/lib/actions/workflow'
import {
  ORIGIN_LABEL, PHASE_LABEL, CAUSE_METHODS, availableMethods, gutScore, gutBand, nextPhaseCheck, sortPlans,
  type ActionPlanSettings, type CauseMethod, type PlanOrigin, type PlanPhase,
} from '@/lib/quality/action-plan'
import { DEPARTMENTS, departmentLabel } from '@/lib/constants/departments'
import { fmtBRL } from '@/lib/format'
import { CauseMethodExample } from '@/components/quality/cause-method-example'

export type PlanRow = {
  id: string; title: string; origin: PlanOrigin; description: string | null; phase: PlanPhase; cycle: number
  gut_g: number | null; gut_u: number | null; gut_t: number | null
  five_whys: string[] | null; ishikawa: Record<string, string[]> | null; root_cause: string | null; cause_method: CauseMethod | null
  efficacy_result: 'eficaz' | 'nao_eficaz' | null; efficacy_note: string | null; efficacy_checked_at: string | null
  standardization: string | null; created_at: string; closed_at: string | null; cancel_reason: string | null
}
export type ItemRow = {
  id: string; plan_id: string | null; description: string; responsible_department: string | null; status: string
  created_at: string; resolved_at: string | null
  why: string | null; where_text: string | null; due_date: string | null; assigned_to: string | null; how: string | null; how_much: number | null
}

type Res = { ok: true } | { ok: false; error: string }
const STATUS_LABELS: Record<string, string> = { pending: 'Pendente', in_progress: 'Em andamento', done: 'Concluído' }
const STATUS_LABEL_ALL: Record<string, string> = { ...STATUS_LABELS, cancelled: 'Cancelada' }
const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-600', in_progress: 'bg-accent-cream text-warn-700', done: 'bg-positive-100 text-positive-700',
}
const input = 'w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none'
const small = 'block text-[10px] font-medium uppercase tracking-wide text-gray-500'
const br = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—')
const PDCA: PlanPhase[] = ['plan', 'do', 'check', 'act']
const TONE: Record<string, string> = {
  neg: 'bg-negative-100 text-negative-700', warn: 'bg-warn-100 text-warn-700', ok: 'bg-positive-100 text-positive-700', none: 'bg-gray-100 text-gray-500',
}
const todayBr = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)

function useAct() {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const run = (fn: () => Promise<Res>, after?: () => void) => start(async () => {
    setError(null)
    const r = await fn()
    if (!r.ok) setError(r.error)
    else { after?.(); router.refresh() }
  })
  return { pending, error, run, setError }
}

function GutSelect({ label, value, onChange, help, disabled }: { label: string; value: number | null; onChange: (v: number | null) => void; help: string[]; disabled?: boolean }) {
  return (
    <label className="block">
      <span className={small}>{label}</span>
      <select className={input} value={value ?? ''} disabled={disabled} onChange={e => onChange(e.target.value ? Number(e.target.value) : null)}>
        <option value="">—</option>
        {help.map((h, i) => <option key={i} value={i + 1}>{i + 1} · {h}</option>)}
      </select>
    </label>
  )
}

export function ActionPlanSection({ contractId, plans, items, settings, people, isAdmin = false }: {
  contractId: string; plans: PlanRow[]; items: ItemRow[]; settings: ActionPlanSettings; people: { id: string; name: string }[]; isAdmin?: boolean
}) {
  const sorted = useMemo(() => sortPlans(plans), [plans])
  const [openId, setOpenId] = useState<string | null>(sorted.find(p => p.phase !== 'closed' && p.phase !== 'cancelled')?.id ?? null)
  const [creating, setCreating] = useState(false)
  const loose = items.filter(i => !i.plan_id)
  const tools = [settings.tools.w5h2 && '5W2H', settings.tools.cinco_porques && '5 Porquês', settings.tools.ishikawa && 'Ishikawa', settings.tools.gut && 'GUT'].filter(Boolean)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Plano de Ação</h2>
          <p className="text-xs text-gray-500">
            Tratativas no ciclo PDCA: Planejar → Executar → Checar → Agir.{tools.length ? ` Ferramentas: ${tools.join(', ')}.` : ''}
          </p>
        </div>
        {!creating && (
          <button type="button" onClick={() => setCreating(true)} className="inline-flex items-center gap-1 rounded-lg bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800">
            <Plus className="h-4 w-4" /> Nova tratativa
          </button>
        )}
      </div>

      {creating && <NewPlanForm contractId={contractId} settings={settings} onDone={id => { setCreating(false); if (id) setOpenId(id) }} />}

      {sorted.length === 0 && !creating && (
        <p className="rounded-xl border border-dashed border-gray-300 bg-white p-4 text-sm text-gray-500">
          Nenhuma tratativa. Abra uma quando houver um problema a resolver com o cliente (reclamação, SLA, pesquisa, auditoria, risco na renovação).
        </p>
      )}

      {sorted.map(p => (
        <PlanCard key={p.id} contractId={contractId} plan={p} items={items.filter(i => i.plan_id === p.id)} settings={settings} people={people} isAdmin={isAdmin}
          open={openId === p.id} onToggle={() => setOpenId(openId === p.id ? null : p.id)} />
      ))}

      {loose.length > 0 && <LooseItems contractId={contractId} items={loose} />}
    </div>
  )
}

function NewPlanForm({ contractId, settings, onDone }: { contractId: string; settings: ActionPlanSettings; onDone: (id?: string) => void }) {
  const [title, setTitle] = useState('')
  const [origin, setOrigin] = useState<PlanOrigin>('reclamacao')
  const [desc, setDesc] = useState('')
  const [g, setG] = useState<number | null>(null)
  const [u, setU] = useState<number | null>(null)
  const [t, setT] = useState<number | null>(null)
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const score = gutScore(g, u, t)
  return (
    <div className="space-y-3 rounded-xl border border-brand-700/30 bg-white p-4">
      <p className="text-sm font-semibold text-gray-900">Nova tratativa · Planejar</p>
      <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
        <label className="block"><span className={small}>Problema</span>
          <input className={input} value={title} maxLength={200} onChange={e => setTitle(e.target.value)} placeholder="Ex.: Atraso no atendimento corretivo da UTI" /></label>
        <label className="block"><span className={small}>Origem</span>
          <select className={input} value={origin} onChange={e => setOrigin(e.target.value as PlanOrigin)}>
            {(Object.keys(ORIGIN_LABEL) as PlanOrigin[]).map(o => <option key={o} value={o}>{ORIGIN_LABEL[o]}</option>)}
          </select></label>
      </div>
      <label className="block"><span className={small}>O que aconteceu (fatos)</span>
        <textarea className={`${input} min-h-[60px]`} value={desc} maxLength={2000} onChange={e => setDesc(e.target.value)} /></label>
      {settings.tools.gut && (
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
          <GutSelect label="Gravidade" value={g} onChange={setG} help={settings.gut_scale.g} />
          <GutSelect label="Urgência" value={u} onChange={setU} help={settings.gut_scale.u} />
          <GutSelect label="Tendência" value={t} onChange={setT} help={settings.gut_scale.t} />
          <span className={`rounded-lg px-3 py-2 text-xs font-semibold ${TONE[gutBand(score, settings.gut_bands).tone]}`}>GUT {score ?? '—'}</span>
        </div>
      )}
      {error && <p className="text-xs text-negative-700">{error}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={pending} onClick={() => start(async () => {
          setError(null)
          const r = await createActionPlan(contractId, { title, origin, description: desc, gut_g: g, gut_u: u, gut_t: t })
          if (!r.ok) setError(r.error); else { onDone(r.id); router.refresh() }
        })} className="rounded-lg bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">
          {pending ? 'Abrindo…' : 'Abrir tratativa'}
        </button>
        <button type="button" onClick={() => onDone()} className="px-2 text-sm text-gray-500 hover:text-gray-800">Cancelar</button>
      </div>
    </div>
  )
}

function PhaseBar({ phase }: { phase: PlanPhase }) {
  const idx = PDCA.indexOf(phase)
  const finished = phase === 'closed'
  return (
    <div className="flex items-center gap-1">
      {PDCA.map((ph, i) => {
        const on = finished || i < idx
        const cur = i === idx
        return (
          <span key={ph} title={PHASE_LABEL[ph]}
            className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${
              cur ? 'bg-warn-600 text-white' : on ? 'bg-positive-600 text-white' : phase === 'cancelled' ? 'bg-gray-100 text-gray-300' : 'bg-gray-100 text-gray-400'}`}>
            {'PDCA'[i]}
          </span>
        )
      })}
    </div>
  )
}

function PlanCard({ contractId, plan, items, settings, people, isAdmin, open, onToggle }: {
  contractId: string; plan: PlanRow; items: ItemRow[]; settings: ActionPlanSettings; people: { id: string; name: string }[]; isAdmin: boolean; open: boolean; onToggle: () => void
}) {
  const score = gutScore(plan.gut_g, plan.gut_u, plan.gut_t)
  const band = gutBand(score, settings.gut_bands)
  const ended = plan.phase === 'closed' || plan.phase === 'cancelled'
  const doneCount = items.filter(i => i.status === 'done').length
  const a = useAct()
  const [cancelling, setCancelling] = useState(false)
  const [reason, setReason] = useState('')
  const [deleting, setDeleting] = useState(false)
  const next = nextPhaseCheck(plan.phase, items, settings.require_efficacy)

  return (
    <div className={`rounded-xl border bg-white ${ended ? 'border-gray-200 opacity-80' : 'border-gray-200'}`}>
      <button type="button" onClick={onToggle} className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left">
        {open ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
        <PhaseBar phase={plan.phase} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-gray-900">
            {plan.title}
            {plan.phase === 'cancelled' && <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-gray-500">Cancelada</span>}
            {plan.phase === 'closed' && <span className="ml-2 rounded-full bg-positive-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-positive-700">Encerrada</span>}
          </p>
          <p className="text-[11px] text-gray-500">
            {ORIGIN_LABEL[plan.origin]} · {PHASE_LABEL[plan.phase]}{plan.cycle > 1 ? ` · ciclo ${plan.cycle}` : ''} · {doneCount}/{items.length} ações · aberta em {br(plan.created_at)}
          </p>
        </div>
        {settings.tools.gut && <span title={band.label} className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${TONE[band.tone]}`}>GUT {score ?? '—'}</span>}
      </button>

      {open && (
        <div className="space-y-4 border-t border-gray-100 px-4 py-4">
          {plan.phase === 'cancelled' && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-gray-100 px-3 py-2 text-xs text-gray-700">
              <span className="flex-1">
                <b>Tratativa cancelada</b> em {br(plan.closed_at)}{plan.cancel_reason ? `: ${plan.cancel_reason}` : ''}. Os campos ficam só para consulta.
              </span>
              <button type="button" disabled={a.pending} onClick={() => a.run(() => reopenActionPlan(contractId, plan.id))}
                className="rounded-lg border border-brand-700 bg-white px-3 py-1 font-medium text-brand-700 hover:bg-brand-100 disabled:opacity-50">Reabrir</button>
            </div>
          )}
          <ProblemBlock contractId={contractId} plan={plan} settings={settings} disabled={ended} />
          <CauseBlock contractId={contractId} plan={plan} settings={settings} disabled={ended} />
          <ActionsBlock contractId={contractId} planId={plan.id} items={items} settings={settings} people={people} disabled={ended} />
          {(plan.phase === 'check' || plan.efficacy_result) && <EfficacyBlock contractId={contractId} plan={plan} />}
          {(plan.phase === 'act' || (plan.phase === 'closed' && plan.standardization)) && <StandardBlock contractId={contractId} plan={plan} />}

          {!ended && (
            <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
              {next.map(o => (
                <button key={o.to} type="button" disabled={a.pending || !!o.blocked} title={o.blocked ?? ''}
                  onClick={() => a.run(() => advancePlan(contractId, plan.id, o.to))}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-40 ${o.to === 'closed' && next.length > 1 ? 'border border-gray-300 text-gray-700 hover:bg-gray-50' : 'bg-brand-700 text-white hover:bg-brand-800'}`}>
                  {o.label}
                </button>
              ))}
              {next.find(o => o.blocked) && <span className="text-[11px] text-gray-500">{next.find(o => o.blocked)!.blocked}</span>}
              <span className="flex-1" />
              {cancelling ? (
                <span className="flex items-center gap-2">
                  <input className={`${input} w-56`} value={reason} onChange={e => setReason(e.target.value)} placeholder="Motivo do cancelamento" maxLength={500} />
                  <button type="button" disabled={a.pending} onClick={() => a.run(() => cancelActionPlan(contractId, plan.id, reason))} className="text-xs font-medium text-negative-700">Confirmar</button>
                  <button type="button" onClick={() => setCancelling(false)} className="text-xs text-gray-500">Voltar</button>
                </span>
              ) : (
                <button type="button" onClick={() => setCancelling(true)} className="text-xs text-gray-400 hover:text-negative-700">Cancelar tratativa</button>
              )}
            </div>
          )}
          {plan.phase === 'closed' && <p className="text-[11px] text-positive-700">Encerrada em {br(plan.closed_at)}.</p>}
          {isAdmin && (
            <div className="flex items-center justify-end gap-2 text-xs">
              {deleting ? (
                <>
                  <span className="text-negative-700">Excluir a tratativa e as {items.length} ação(ões)? Não dá para desfazer.</span>
                  <button type="button" disabled={a.pending} onClick={() => a.run(() => deleteActionPlan(contractId, plan.id))}
                    className="rounded-lg bg-negative-600 px-3 py-1 font-medium text-white hover:bg-negative-700 disabled:opacity-50">Excluir</button>
                  <button type="button" onClick={() => setDeleting(false)} className="text-gray-500">Voltar</button>
                </>
              ) : (
                <button type="button" onClick={() => setDeleting(true)} className="inline-flex items-center gap-1 text-gray-400 hover:text-negative-700">
                  <Trash2 className="h-3.5 w-3.5" /> Excluir tratativa (admin)
                </button>
              )}
            </div>
          )}
          {a.error && <p className="text-xs text-negative-700">{a.error}</p>}
        </div>
      )}
    </div>
  )
}

function SaveBar({ dirty, pending, onSave, error }: { dirty: boolean; pending: boolean; onSave: () => void; error: string | null }) {
  if (!dirty && !error) return null
  return (
    <div className="flex items-center gap-2">
      {dirty && <button type="button" disabled={pending} onClick={onSave} className="rounded-lg bg-brand-700 px-3 py-1 text-xs font-medium text-white hover:bg-brand-800 disabled:opacity-50">{pending ? 'Salvando…' : 'Salvar'}</button>}
      {error && <span className="text-xs text-negative-700">{error}</span>}
    </div>
  )
}

function ProblemBlock({ contractId, plan, settings, disabled }: { contractId: string; plan: PlanRow; settings: ActionPlanSettings; disabled: boolean }) {
  const [title, setTitle] = useState(plan.title)
  const [desc, setDesc] = useState(plan.description ?? '')
  const [g, setG] = useState(plan.gut_g); const [u, setU] = useState(plan.gut_u); const [t, setT] = useState(plan.gut_t)
  const a = useAct()
  const dirty = title !== plan.title || desc !== (plan.description ?? '') || g !== plan.gut_g || u !== plan.gut_u || t !== plan.gut_t
  return (
    <section className="space-y-2">
      <p className="text-xs font-semibold text-brand-700">1. Problema{settings.tools.gut ? ' e prioridade (GUT)' : ''}</p>
      <input className={input} value={title} disabled={disabled} maxLength={200} onChange={e => setTitle(e.target.value)} />
      <textarea className={`${input} min-h-[50px]`} value={desc} disabled={disabled} maxLength={2000} placeholder="Fatos: o que, onde, quando, quem foi afetado" onChange={e => setDesc(e.target.value)} />
      {settings.tools.gut && (
        <div className="grid gap-2 sm:grid-cols-3">
          <GutSelect label="Gravidade" value={g} onChange={setG} help={settings.gut_scale.g} disabled={disabled} />
          <GutSelect label="Urgência" value={u} onChange={setU} help={settings.gut_scale.u} disabled={disabled} />
          <GutSelect label="Tendência" value={t} onChange={setT} help={settings.gut_scale.t} disabled={disabled} />
        </div>
      )}
      <SaveBar dirty={dirty} pending={a.pending} error={a.error}
        onSave={() => a.run(() => updateActionPlan(contractId, plan.id, { title, description: desc, gut_g: g, gut_u: u, gut_t: t }))} />
    </section>
  )
}

function CauseBlock({ contractId, plan, settings, disabled }: { contractId: string; plan: PlanRow; settings: ActionPlanSettings; disabled: boolean }) {
  const initWhys = [...(plan.five_whys ?? [])]; while (initWhys.length < 5) initWhys.push('')
  const [whys, setWhys] = useState<string[]>(initWhys)
  const initIsh = Object.fromEntries(settings.ishikawa_categories.map(c => [c.key, (plan.ishikawa?.[c.key] ?? []).join('\n')]))
  const [ish, setIsh] = useState<Record<string, string>>(initIsh)
  const [root, setRoot] = useState(plan.root_cause ?? '')
  // Métodos que a empresa liberou; o já escolhido continua visível mesmo se a ferramenta foi desligada depois
  const methods = availableMethods(settings)
  if (plan.cause_method && !methods.includes(plan.cause_method)) methods.unshift(plan.cause_method)
  const initMethod = plan.cause_method ?? settings.default_method
  const [method, setMethod] = useState<CauseMethod>(initMethod)
  const [example, setExample] = useState<CauseMethod | null>(null)
  const a = useAct()
  const changed = method !== initMethod || whys.join('|') !== initWhys.join('|') || JSON.stringify(ish) !== JSON.stringify(initIsh) || root !== (plan.root_cause ?? '')
  // A próxima pergunta só aparece depois de responder a anterior
  const firstEmpty = whys.findIndex(w => !w.trim())
  const visibleWhys = firstEmpty === -1 ? 5 : Math.max(1, firstEmpty + 1)
  return (
    <section className="space-y-3">
      <p className="text-xs font-semibold text-brand-700">2. Causa raiz</p>
      {methods.length > 1 && (
        <div>
          <p className={small}>Qual análise fazer?</p>
          <div className="mt-1 grid gap-2 sm:grid-cols-3">
            {methods.map(m => (
              <div key={m} className={`rounded-lg border p-2.5 ${method === m ? 'border-brand-700 bg-brand-100/60' : 'border-gray-200 bg-white'}`}>
                <label className="flex items-center gap-2 text-sm font-medium text-gray-900">
                  <input type="radio" checked={method === m} disabled={disabled} onChange={() => setMethod(m)} />
                  {CAUSE_METHODS[m].label}
                </label>
                <p className="mt-1 text-[11px] text-gray-600">{CAUSE_METHODS[m].when}</p>
                <button type="button" onClick={() => setExample(example === m ? null : m)} className="mt-1 text-[11px] font-medium text-brand-700 hover:underline">
                  {example === m ? 'Fechar exemplo' : 'Ver exemplo'}
                </button>
              </div>
            ))}
          </div>
          {example && <div className="mt-2"><CauseMethodExample method={example} /></div>}
        </div>
      )}
      {method === 'cinco_porques' && (
        <div className="space-y-1.5">
          {whys.slice(0, visibleWhys).map((w, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-24 shrink-0 text-[11px] font-medium text-gray-500">{i + 1}º por quê?</span>
              <input className={input} value={w} disabled={disabled} maxLength={300} onChange={e => setWhys(x => x.map((y, j) => (j === i ? e.target.value : y)))} />
            </div>
          ))}
        </div>
      )}
      {method === 'ishikawa' && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {settings.ishikawa_categories.map(c => (
            <label key={c.key} className="block rounded-lg border border-gray-200 bg-gray-50 p-2">
              <span className="text-[11px] font-semibold text-gray-700">{c.label}</span>
              <textarea className={`${input} mt-1 min-h-[56px] bg-white text-xs`} value={ish[c.key] ?? ''} disabled={disabled} placeholder="Uma causa por linha"
                onChange={e => setIsh(x => ({ ...x, [c.key]: e.target.value }))} />
            </label>
          ))}
        </div>
      )}
      <label className="block"><span className={small}>Causa raiz identificada</span>
        <textarea className={`${input} min-h-[44px]`} value={root} disabled={disabled} maxLength={1000} onChange={e => setRoot(e.target.value)} /></label>
      {!disabled && (
        <SaveBar dirty={changed} pending={a.pending} error={a.error}
          onSave={() => a.run(() => updateActionPlan(contractId, plan.id, {
            cause_method: method,
            five_whys: whys,
            ishikawa: Object.fromEntries(Object.entries(ish).map(([k, v]) => [k, v.split('\n')])),
            root_cause: root,
          }))} />
      )}
    </section>
  )
}

function ActionsBlock({ contractId, planId, items, settings, people, disabled }: {
  contractId: string; planId: string; items: ItemRow[]; settings: ActionPlanSettings; people: { id: string; name: string }[]; disabled: boolean
}) {
  const w = settings.tools.w5h2
  const empty = { what: '', why: '', where: '', due_date: '', assigned_to: '', department: '', how: '', how_much: '' }
  const [f, setF] = useState(empty)
  const [adding, setAdding] = useState(false)
  const a = useAct()
  const name = (id: string | null) => people.find(p => p.id === id)?.name ?? null
  const today = todayBr()
  return (
    <section className="space-y-2">
      <p className="text-xs font-semibold text-brand-700">3. Ações{w ? ' (5W2H)' : ''}</p>
      {items.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-2 py-1.5">O quê</th>
                {w && <th className="px-2 py-1.5">Por quê</th>}
                {w && <th className="px-2 py-1.5">Onde</th>}
                <th className="px-2 py-1.5">Quando</th>
                <th className="px-2 py-1.5">Quem</th>
                {w && <th className="px-2 py-1.5">Como</th>}
                {w && <th className="px-2 py-1.5">Quanto</th>}
                <th className="px-2 py-1.5">Status</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {items.map(i => {
                const late = i.status !== 'done' && i.due_date && i.due_date < today
                return (
                  <tr key={i.id} className="align-top">
                    <td className="px-2 py-1.5 font-medium text-gray-900">{i.description}</td>
                    {w && <td className="px-2 py-1.5 text-gray-600">{i.why ?? '—'}</td>}
                    {w && <td className="px-2 py-1.5 text-gray-600">{i.where_text ?? '—'}</td>}
                    <td className={`whitespace-nowrap px-2 py-1.5 ${late ? 'font-semibold text-negative-700' : 'text-gray-600'}`}>{br(i.due_date)}{late ? ' · atrasada' : ''}</td>
                    <td className="px-2 py-1.5 text-gray-600">{[name(i.assigned_to), i.responsible_department ? departmentLabel(i.responsible_department) : null].filter(Boolean).join(' · ') || '—'}</td>
                    {w && <td className="px-2 py-1.5 text-gray-600">{i.how ?? '—'}</td>}
                    {w && <td className="whitespace-nowrap px-2 py-1.5 text-gray-600">{i.how_much !== null ? fmtBRL(Number(i.how_much)) : '—'}</td>}
                    <td className="px-2 py-1.5">
                      {disabled ? (
                        <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${STATUS_STYLES[i.status] ?? ''}`}>{STATUS_LABEL_ALL[i.status] ?? i.status}</span>
                      ) : (
                        <select value={i.status} disabled={a.pending} onChange={e => a.run(() => setPlanActionStatus(contractId, i.id, e.target.value as 'pending'))}
                          className={`rounded-md border-0 px-1.5 py-0.5 text-[11px] font-medium ${STATUS_STYLES[i.status] ?? ''}`}>
                          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                      )}
                    </td>
                    <td className="px-1 py-1.5">
                      {!disabled && <button type="button" onClick={() => a.run(() => deletePlanAction(contractId, i.id))} className="text-gray-300 hover:text-negative-700" title="Excluir ação"><Trash2 className="h-3.5 w-3.5" /></button>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {!disabled && (adding ? (
        <div className="space-y-2 rounded-lg border border-dashed border-gray-300 p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block sm:col-span-2"><span className={small}>O quê (ação)</span>
              <input className={input} value={f.what} maxLength={500} onChange={e => setF({ ...f, what: e.target.value })} placeholder="Ex.: Remanejar técnico volante para cobrir a UTI" /></label>
            {w && <label className="block"><span className={small}>Por quê</span><input className={input} value={f.why} maxLength={500} onChange={e => setF({ ...f, why: e.target.value })} /></label>}
            {w && <label className="block"><span className={small}>Onde</span><input className={input} value={f.where} maxLength={200} onChange={e => setF({ ...f, where: e.target.value })} placeholder="Setor, unidade, equipamento" /></label>}
            <label className="block"><span className={small}>Quando (prazo)</span><input type="date" className={input} value={f.due_date} onChange={e => setF({ ...f, due_date: e.target.value })} /></label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block"><span className={small}>Quem (pessoa)</span>
                <select className={input} value={f.assigned_to} onChange={e => setF({ ...f, assigned_to: e.target.value })}>
                  <option value="">—</option>{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select></label>
              <label className="block"><span className={small}>Área</span>
                <select className={input} value={f.department} onChange={e => setF({ ...f, department: e.target.value })}>
                  <option value="">—</option>{DEPARTMENTS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select></label>
            </div>
            {w && <label className="block sm:col-span-2"><span className={small}>Como</span><input className={input} value={f.how} maxLength={1000} onChange={e => setF({ ...f, how: e.target.value })} /></label>}
            {w && <label className="block"><span className={small}>Quanto custa (R$)</span><input className={input} value={f.how_much} inputMode="decimal" onChange={e => setF({ ...f, how_much: e.target.value })} placeholder="0,00" /></label>}
          </div>
          <div className="flex gap-2">
            <button type="button" disabled={a.pending} onClick={() => a.run(() => addPlanAction(contractId, planId, f), () => { setF(empty); setAdding(false) })}
              className="rounded-lg bg-brand-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-800 disabled:opacity-50">{a.pending ? 'Salvando…' : 'Adicionar ação'}</button>
            <button type="button" onClick={() => setAdding(false)} className="px-2 text-xs text-gray-500">Cancelar</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"><Plus className="h-3.5 w-3.5" /> Adicionar ação</button>
      ))}
      {a.error && <p className="text-xs text-negative-700">{a.error}</p>}
    </section>
  )
}

function EfficacyBlock({ contractId, plan }: { contractId: string; plan: PlanRow }) {
  const [result, setResult] = useState<'eficaz' | 'nao_eficaz' | ''>('')
  const [note, setNote] = useState('')
  const a = useAct()
  return (
    <section className="space-y-2 rounded-lg bg-gray-50 p-3">
      <p className="text-xs font-semibold text-brand-700">4. Checar · verificação de eficácia</p>
      {plan.efficacy_result && (
        <p className={`text-xs ${plan.efficacy_result === 'eficaz' ? 'text-positive-700' : 'text-negative-700'}`}>
          Última verificação ({br(plan.efficacy_checked_at)}): <b>{plan.efficacy_result === 'eficaz' ? 'eficaz' : 'não eficaz'}</b>{plan.efficacy_note ? ` · ${plan.efficacy_note}` : ''}
        </p>
      )}
      {plan.phase === 'check' && (
        <>
          <p className="text-[11px] text-gray-500">O problema foi resolvido de verdade? Confira com dados (nova pesquisa, indicador de SLA, conversa com o cliente).</p>
          <div className="flex flex-wrap gap-3 text-sm">
            <label className="flex items-center gap-1.5"><input type="radio" checked={result === 'eficaz'} onChange={() => setResult('eficaz')} /> Eficaz: resolveu</label>
            <label className="flex items-center gap-1.5"><input type="radio" checked={result === 'nao_eficaz'} onChange={() => setResult('nao_eficaz')} /> Não eficaz: volta a Planejar</label>
          </div>
          <textarea className={`${input} min-h-[50px] bg-white`} value={note} maxLength={1000} placeholder="Como verificou e o que encontrou" onChange={e => setNote(e.target.value)} />
          <button type="button" disabled={a.pending || !result} onClick={() => a.run(() => checkPlanEfficacy(contractId, plan.id, result as 'eficaz', note))}
            className="rounded-lg bg-brand-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-800 disabled:opacity-40">Registrar verificação</button>
          {a.error && <p className="text-xs text-negative-700">{a.error}</p>}
        </>
      )}
    </section>
  )
}

function StandardBlock({ contractId, plan }: { contractId: string; plan: PlanRow }) {
  const [text, setText] = useState(plan.standardization ?? '')
  const a = useAct()
  const disabled = plan.phase !== 'act'
  return (
    <section className="space-y-2">
      <p className="text-xs font-semibold text-brand-700">5. Agir · padronizar</p>
      <p className="text-[11px] text-gray-500">O que muda no processo para não voltar a acontecer (procedimento, treinamento, checklist, outros contratos com o mesmo risco).</p>
      <textarea className={`${input} min-h-[50px]`} value={text} disabled={disabled} maxLength={2000} onChange={e => setText(e.target.value)} />
      <SaveBar dirty={text !== (plan.standardization ?? '')} pending={a.pending} error={a.error}
        onSave={() => a.run(() => updateActionPlan(contractId, plan.id, { standardization: text }))} />
    </section>
  )
}

// Itens antigos, de antes das tratativas
function LooseItems({ contractId, items }: { contractId: string; items: ItemRow[] }) {
  const router = useRouter()
  const [, start] = useTransition()
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-gray-500">Ações sem tratativa (anteriores)</p>
      {items.map(item => (
        <div key={item.id} className="flex items-start justify-between gap-3 rounded-lg border border-gray-200 bg-white p-3">
          <div className="min-w-0">
            <p className={`text-sm ${item.status === 'done' ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{item.description}</p>
            <p className="mt-0.5 text-[11px] text-gray-500">{departmentLabel(item.responsible_department)} · {br(item.created_at)}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <select value={item.status} onChange={e => start(async () => { await updateActionPlanItemStatus(item.id, contractId, e.target.value); router.refresh() })}
              className={`rounded-md border-0 px-2 py-1 text-xs font-medium ${STATUS_STYLES[item.status] ?? ''}`}>
              {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <button type="button" onClick={() => start(async () => { await deleteActionPlanItem(item.id, contractId); router.refresh() })} className="text-gray-300 hover:text-negative-700" title="Excluir"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      ))}
    </div>
  )
}
