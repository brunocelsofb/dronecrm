'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Circle, Clock, Flag } from 'lucide-react'
import { markRulerStepDone, startRulerManually, cancelRuler, skipRulerStepAction, rulerNoDealAction } from '@/lib/actions/renewal-ruler'
import { ProcessOverrideModal } from '@/components/pipeline/process-override-modal'
import { brDate, openStepIndexes, type RunStep } from '@/lib/agent/renewal-ruler'

export type RulerRunView = {
  id: string
  status: 'active' | 'ready' | 'done' | 'cancelled'
  period_end: string | null
  steps: RunStep[]
  lock_renewed: boolean
  started_at: string
  ready_at: string | null
  finished_at: string | null
}

const fmtDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

export function RenewalRulerPanel({
  contractId, run, enabled, canAct, isAdmin, today, canSkip = true, areaTasks = [],
}: {
  contractId: string; run: RulerRunView | null; enabled: boolean; canAct: boolean; isAdmin: boolean; today: string
  canSkip?: boolean; areaTasks?: { stepId: string; area: string; person: string; done: boolean }[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [noteFor, setNoteFor] = useState<string | null>(null)
  const [note, setNote] = useState('')
  // digitar "mudar": passar um passo fora do processo ou registrar "sem acordo" (churn)
  const [ov, setOv] = useState<{ kind: 'skip' | 'nodeal'; stepId?: string; message: string; error: string | null } | null>(null)
  const [ovBusy, setOvBusy] = useState(false)

  const open = run && (run.status === 'active' || run.status === 'ready') ? run : null
  const act = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) => start(async () => {
    setError(null)
    const r = await fn()
    if (!r.ok) setError(r.error)
    else { setNoteFor(null); setNote(''); router.refresh() }
  })

  if (!open) {
    if (!enabled && !run) return null
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-gray-900">Régua de renovação</p>
            <p className="text-xs text-gray-500">
              {run
                ? run.status === 'done'
                  ? `Última régua concluída em ${fmtDateTime(run.finished_at)} (vencimento ${brDate(run.period_end)}).`
                  : `Última régua cancelada em ${fmtDateTime(run.finished_at)}.`
                : 'Começa sozinha junto com o "preparar a renovação" (Central de regras → Renovação).'}
            </p>
          </div>
          {enabled && canAct && (
            <button type="button" disabled={pending} onClick={() => act(() => startRulerManually(contractId))}
              className="rounded-lg border border-brand-700 px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-100 disabled:opacity-50">
              {pending ? 'Iniciando…' : 'Iniciar régua agora'}
            </button>
          )}
        </div>
        {error && <p className="mt-2 text-xs text-negative-700">{error}</p>}
      </div>
    )
  }

  const total = open.steps.length
  const done = open.steps.filter(s => s.done_at).length
  const current = openStepIndexes(open.steps)
  const WHO: Record<string, string> = { owner: '👤 consultor', areas: '👤 área', agent: '🤖 agente prepara · pessoa revisa' }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
      {ov && (
        <ProcessOverrideModal message={ov.message} busy={ovBusy} error={ov.error} onCancel={() => setOv(null)}
          onConfirm={async o => {
            setOvBusy(true)
            const r = ov.kind === 'skip' ? await skipRulerStepAction(contractId, open.id, ov.stepId!, o.word, o.reason) : await rulerNoDealAction(contractId, o.word, o.reason)
            setOvBusy(false)
            if (!r.ok) { setOv({ ...ov, error: r.error }); return }
            setOv(null); router.refresh()
          }} />
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">Régua de renovação <span className="font-normal text-gray-500">· interna</span></p>
          <p className="text-xs text-gray-500">
            Vencimento {brDate(open.period_end)} · {done} de {total} passos concluídos
            {open.lock_renewed && open.status === 'active' ? ' · "Renovado" liberado ao concluir todos' : ''}
          </p>
        </div>
        {canAct && open.status === 'active' && (
          <button type="button" disabled={pending} onClick={() => setOv({ kind: 'nodeal', error: null, message: 'Sem acordo comercial: a régua é encerrada e o consultor recebe a tarefa de registrar a perda (churn). As regras de churn da Central rodam quando a perda for marcada.' })}
            className="text-xs font-medium text-negative-700 hover:underline disabled:opacity-50">
            Sem acordo (churn)
          </button>
        )}
        {isAdmin && (
          <button type="button" disabled={pending} onClick={() => act(() => cancelRuler(contractId))}
            className="text-xs text-gray-400 hover:text-negative-700 disabled:opacity-50">
            Cancelar régua
          </button>
        )}
      </div>

      <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
        <div className="h-full rounded-full bg-positive-600" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
      </div>

      <ol className="space-y-0">
        {open.steps.map((s, i) => {
          const isDone = !!s.done_at
          const isCurrent = current.includes(i)
          const late = !isDone && !!s.due_date && s.due_date < today
          return (
            <li key={s.id} className="relative flex gap-3 pb-4 last:pb-0">
              {i < total - 1 && <span className={`absolute left-[9px] top-5 h-[calc(100%-12px)] w-px ${isDone ? 'bg-positive-600' : 'bg-gray-200'}`} />}
              <span className="relative mt-0.5 shrink-0">
                {isDone ? <CheckCircle2 className="h-5 w-5 text-positive-600" />
                  : isCurrent ? <Clock className={`h-5 w-5 ${late ? 'text-negative-600' : 'text-warn-600'}`} />
                  : <Circle className="h-5 w-5 text-gray-300" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2">
                  <p className={`text-sm ${isCurrent ? 'font-semibold text-gray-900' : isDone ? 'text-gray-700' : 'text-gray-500'}`}>{s.label}</p>
                  <span className={`text-xs ${late ? 'font-medium text-negative-700' : 'text-gray-400'}`}>
                    prazo {brDate(s.due_date)}{late ? ' · atrasado' : ''}
                  </span>
                  {s.done_when !== 'client_notice' && s.who && <span className="text-[11px] text-gray-400">{WHO[s.who]}</span>}
                  {s.requires_file && !isDone && <span className="rounded bg-warn-100 px-1.5 py-0.5 text-[10px] text-warn-700">pede anexo</span>}
                  {s.with_previous && !isDone && <span className="text-[11px] text-gray-400">· junto com o anterior</span>}
                </div>
                {isDone && (
                  <p className="text-xs text-gray-500">
                    Feito em {fmtDateTime(s.done_at)}{s.done_by_name ? ` por ${s.done_by_name}` : ''}{s.note ? ` · ${s.note}` : ''}
                  </p>
                )}
                {isCurrent && !isDone && s.instructions && <p className="text-xs text-gray-500">{s.instructions}</p>}
                {areaTasks.filter(t => t.stepId === s.id).length > 1 && (
                  <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs">
                    {areaTasks.filter(t => t.stepId === s.id).map(t => (
                      <span key={t.area} className={t.done ? 'text-positive-700' : 'text-warn-700'}>{t.done ? '✓' : '⏳'} {t.area} ({t.person})</span>
                    ))}
                  </p>
                )}
                {isCurrent && open.status === 'active' && canAct && (
                  noteFor === s.id ? (
                    <div className="mt-2 space-y-2">
                      <textarea value={note} onChange={e => setNote(e.target.value)} maxLength={500} rows={2}
                        placeholder="Observação (opcional): o que foi feito, combinado, próximo passo…"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs focus:border-brand-700 focus:outline-none" />
                      <div className="flex gap-2">
                        <button type="button" disabled={pending} onClick={() => act(() => markRulerStepDone(contractId, open.id, s.id, note))}
                          className="rounded-lg bg-brand-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-800 disabled:opacity-50">
                          {pending ? 'Salvando…' : 'Confirmar feito'}
                        </button>
                        <button type="button" onClick={() => { setNoteFor(null); setNote('') }} className="px-2 text-xs text-gray-500 hover:text-gray-800">Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setNoteFor(s.id)}
                      className="mt-1 rounded-lg border border-brand-700 px-3 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100">
                      Marcar feito
                    </button>
                  )
                )}
                {!isDone && open.status === 'active' && canAct && canSkip && (
                  <button type="button" onClick={() => setOv({ kind: 'skip', stepId: s.id, error: null, message: `Passar "${s.label}" fora do processo (não se aplica a este contrato ou já foi resolvido de outro jeito). Fica registrado quem passou e por quê.` })}
                    className="ml-2 mt-1 text-[11px] text-gray-400 hover:text-warn-700">
                    passar (fora do processo)
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ol>

      {open.status === 'ready' && (
        <div className="flex items-start gap-2 rounded-lg bg-positive-100 px-3 py-2 text-xs text-positive-700">
          <Flag className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Todos os passos concluídos em {fmtDateTime(open.ready_at)}. Falta revisar a nova vigência e o valor e marcar <b>Renovado</b> no funil.</span>
        </div>
      )}
      {error && <p className="text-xs text-negative-700">{error}</p>}
    </div>
  )
}
