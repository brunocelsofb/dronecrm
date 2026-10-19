'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Circle, Clock, Flag } from 'lucide-react'
import { markRulerStepDone, startRulerManually, cancelRuler } from '@/lib/actions/renewal-ruler'
import { brDate, type RunStep } from '@/lib/agent/renewal-ruler'

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
  contractId, run, enabled, canAct, isAdmin, today,
}: { contractId: string; run: RulerRunView | null; enabled: boolean; canAct: boolean; isAdmin: boolean; today: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [noteFor, setNoteFor] = useState<string | null>(null)
  const [note, setNote] = useState('')

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
                : 'Começa sozinha quando o aviso de renovação é enviado ao cliente.'}
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
  const currentIdx = open.steps.findIndex(s => !s.done_at)

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">Régua de renovação <span className="font-normal text-gray-500">· interna</span></p>
          <p className="text-xs text-gray-500">
            Vencimento {brDate(open.period_end)} · {done} de {total} passos concluídos
            {open.lock_renewed && open.status === 'active' ? ' · "Renovado" liberado ao concluir todos' : ''}
          </p>
        </div>
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
          const isCurrent = i === currentIdx
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
                </div>
                {isDone && (
                  <p className="text-xs text-gray-500">
                    Feito em {fmtDateTime(s.done_at)}{s.done_by_name ? ` por ${s.done_by_name}` : ''}{s.note ? ` · ${s.note}` : ''}
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
