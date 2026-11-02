'use client'
// Aba "Renovação" da oportunidade: a régua de renovação do contrato.
// Topo: quanto falta para o vencimento e o andamento; "Agora": os passos em andamento, com quem
// está com cada um e as ações; depois os próximos e os concluídos.

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ChevronRight, Clock, Hourglass, Paperclip, Sparkles, Flag } from 'lucide-react'
import {
  markRulerStepDone, startRulerManually, cancelRuler, skipRulerStepAction, rulerNoDealAction, setRulerStepWaitingAction,
} from '@/lib/actions/renewal-ruler'
import { ProcessOverrideModal } from '@/components/pipeline/process-override-modal'
import { brDate, daysBetween, openStepIndexes, isWaiting, MAX_WAIT_DAYS, type RunStep } from '@/lib/agent/renewal-ruler'

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
export type RulerTaskView = { stepId: string; area: string | null; person: string; done: boolean }

const fmtDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
const short = (iso: string | null | undefined) => (iso ? brDate(iso).slice(0, 5) : '—')
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '?'
const plusDays = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

const WHO_LABEL: Record<string, string> = { owner: 'Consultor', areas: 'Área', agent: 'Agente prepara · pessoa revisa' }

type Result = { ok: true } | { ok: false; error: string }

// Prazo do passo em linguagem de gente: "vence hoje", "vence em 3 dias", "atrasado há 2 dias", "aguardando o cliente"
function DueChip({ step, today }: { step: RunStep; today: string }) {
  if (isWaiting(step, today)) {
    return <span className="inline-flex items-center gap-1 rounded-full bg-accent-sky/25 px-2 py-0.5 text-[11px] font-medium text-brand-800"><Hourglass className="h-3 w-3" />aguardando o cliente até {short(step.waiting_until)}</span>
  }
  if (!step.due_date) return null
  const d = daysBetween(today, step.due_date)
  if (d < 0) return <span className="inline-flex items-center gap-1 rounded-full bg-negative-100 px-2 py-0.5 text-[11px] font-semibold text-negative-700"><Clock className="h-3 w-3" />atrasado há {-d} {-d === 1 ? 'dia' : 'dias'}</span>
  const txt = d === 0 ? 'vence hoje' : d === 1 ? 'vence amanhã' : `vence em ${d} dias`
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${d <= 3 ? 'bg-warn-100 text-warn-700' : 'bg-gray-100 text-gray-600'}`}><Clock className="h-3 w-3" />{txt} · {short(step.due_date)}</span>
}

function Person({ name, sub, done }: { name: string; sub?: string | null; done?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-gray-700">
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${done ? 'bg-positive-100 text-positive-700' : 'bg-brand-100 text-brand-700'}`}>
        {done ? <Check className="h-3.5 w-3.5" /> : initials(name)}
      </span>
      <span className="min-w-0"><span className="font-medium">{name}</span>{sub ? <span className="text-gray-400"> · {sub}</span> : null}</span>
    </span>
  )
}

function Tags({ step }: { step: RunStep }) {
  return (
    <>
      {step.who === 'agent' && step.done_when !== 'client_notice' && <span className="inline-flex items-center gap-1 rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-semibold text-accent-purple"><Sparkles className="h-3 w-3" />agente</span>}
      {step.done_when === 'client_notice' && <span className="inline-flex items-center gap-1 rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-semibold text-accent-purple"><Sparkles className="h-3 w-3" />Farmer escreve</span>}
      {step.requires_file && <span className="inline-flex items-center gap-1 rounded bg-warn-100 px-1.5 py-0.5 text-[10px] font-semibold text-warn-700"><Paperclip className="h-3 w-3" />anexo</span>}
    </>
  )
}

export function RenewalRulerPanel({
  contractId, run, enabled, canAct, isAdmin, today, canSkip = true, tasks = [],
}: {
  contractId: string; run: RulerRunView | null; enabled: boolean; canAct: boolean; isAdmin: boolean; today: string
  canSkip?: boolean; tasks?: RulerTaskView[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [noteFor, setNoteFor] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [waitFor, setWaitFor] = useState<string | null>(null)
  const [waitUntil, setWaitUntil] = useState('')
  const [waitReason, setWaitReason] = useState('')
  const [showDone, setShowDone] = useState(false)
  const [ov, setOv] = useState<{ kind: 'skip' | 'nodeal'; stepId?: string; message: string; error: string | null } | null>(null)
  const [ovBusy, setOvBusy] = useState(false)

  const open = run && (run.status === 'active' || run.status === 'ready') ? run : null
  const act = (fn: () => Promise<Result>) => start(async () => {
    setError(null)
    const r = await fn()
    if (!r.ok) setError(r.error)
    else { setNoteFor(null); setNote(''); setWaitFor(null); setWaitReason(''); router.refresh() }
  })

  // ── Sem régua aberta ──────────────────────────────────────────────────────
  if (!open) {
    if (!enabled && !run) {
      return <p className="rounded-xl border border-dashed border-gray-300 bg-white p-6 text-sm text-gray-500">A régua de renovação está desligada. Um administrador liga em Configurações → Régua de renovação.</p>
    }
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="max-w-xl space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Régua de renovação</p>
            <p className="text-base font-semibold text-gray-900">
              {run ? (run.status === 'done' ? 'Última renovação concluída' : 'Última régua cancelada') : 'A régua ainda não começou'}
            </p>
            <p className="text-sm text-gray-500">
              {run
                ? run.status === 'done' ? `Concluída em ${fmtDateTime(run.finished_at)} (vencimento ${brDate(run.period_end)}).` : `Cancelada em ${fmtDateTime(run.finished_at)}.`
                : 'Ela começa sozinha junto com o "preparar a renovação" (Central de regras → Renovação). Se precisar adiantar, inicie agora.'}
            </p>
          </div>
          {enabled && canAct && (
            <button type="button" disabled={pending} onClick={() => act(() => startRulerManually(contractId))}
              className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-60">
              {pending ? 'Iniciando…' : 'Iniciar régua agora'}
            </button>
          )}
        </div>
        {error && <p className="mt-3 text-xs text-negative-700">{error}</p>}
      </div>
    )
  }

  // ── Régua em andamento ────────────────────────────────────────────────────
  const steps = open.steps
  const total = steps.length
  const doneCount = steps.filter(s => s.done_at).length
  const current = open.status === 'active' ? openStepIndexes(steps) : []
  const daysLeft = open.period_end ? daysBetween(today, open.period_end.slice(0, 10)) : null
  const tasksOf = (id: string) => tasks.filter(t => t.stepId === id)
  const upcoming = steps.map((s, i) => ({ s, i })).filter(({ s, i }) => !s.done_at && !current.includes(i))
  const done = steps.map((s, i) => ({ s, i })).filter(({ s }) => s.done_at)
  const segColor = (s: RunStep, i: number) =>
    s.done_at ? 'bg-positive-600'
      : current.includes(i) ? (isWaiting(s, today) ? 'bg-accent-sky' : s.due_date && s.due_date < today ? 'bg-negative-600' : 'bg-warn-600')
      : 'bg-gray-200'

  return (
    <div className="space-y-5">
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

      {/* Topo: vencimento, andamento */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Régua de renovação · interna</p>
            <p className="text-lg font-semibold text-gray-900">Vencimento em {brDate(open.period_end)}</p>
            <p className="text-sm text-gray-500">
              {doneCount} de {total} passos concluídos · iniciada em {brDate(open.started_at.slice(0, 10))}
              {open.lock_renewed && open.status === 'active' ? ' · "Renovado" libera ao concluir todos' : ''}
            </p>
          </div>
          {daysLeft !== null && (
            <div className="text-right">
              <p className={`text-3xl font-semibold tabular-nums leading-none ${daysLeft < 0 ? 'text-negative-600' : daysLeft <= 30 ? 'text-warn-700' : 'text-brand-700'}`}>{Math.abs(daysLeft)}</p>
              <p className="text-xs text-gray-500">{daysLeft < 0 ? 'dias vencido' : daysLeft === 1 ? 'dia para vencer' : 'dias para vencer'}</p>
            </div>
          )}
        </div>
        <div className="mt-4 flex gap-1" role="img" aria-label={`${doneCount} de ${total} passos concluídos`}>
          {steps.map((s, i) => <span key={s.id} title={`${i + 1}. ${s.label}`} className={`h-2 flex-1 rounded-full ${segColor(s, i)}`} />)}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-positive-600" />concluído</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-warn-600" />em andamento</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-negative-600" />atrasado</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-accent-sky" />aguardando o cliente</span>
        </div>
      </section>

      {/* Pronto para renovar */}
      {open.status === 'ready' && (
        <div className="flex items-start gap-3 rounded-xl bg-positive-100 p-4 text-sm text-positive-700">
          <Flag className="mt-0.5 h-5 w-5 shrink-0" />
          <span>Todos os passos concluídos em {fmtDateTime(open.ready_at)}. Falta revisar a nova vigência e o valor e marcar <b>Renovado</b> no funil.</span>
        </div>
      )}

      {/* Agora */}
      {current.length > 0 && (
        <section className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Agora {current.length > 1 ? `· ${current.length} passos em paralelo` : ''}</p>
          <div className={`grid gap-3 ${current.length > 1 ? 'lg:grid-cols-2' : ''}`}>
            {current.map(i => {
              const s = steps[i]
              const ts = tasksOf(s.id)
              const waiting = isWaiting(s, today)
              return (
                <article key={s.id} className="flex min-w-0 flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium text-gray-400">Passo {i + 1} de {total}</p>
                      <p className="text-sm font-semibold text-gray-900">{s.label}</p>
                    </div>
                    <DueChip step={s} today={today} />
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    {ts.length
                      ? ts.map(t => <Person key={`${t.area}-${t.person}`} name={t.person} sub={t.area} done={t.done} />)
                      : <span className="text-xs text-gray-500">{s.done_when === 'client_notice' ? 'Consultor revisa e envia o aviso; o passo se marca sozinho.' : WHO_LABEL[s.who ?? 'owner']}</span>}
                    <span className="flex flex-wrap gap-1"><Tags step={s} /></span>
                  </div>

                  {s.instructions && <p className="text-xs leading-relaxed text-gray-500">{s.instructions}</p>}
                  {waiting && s.waiting_reason && <p className="rounded-lg bg-accent-sky/15 px-3 py-2 text-xs text-brand-800">Aguardando o cliente: {s.waiting_reason}</p>}

                  {open.status === 'active' && canAct && s.done_when !== 'client_notice' && (
                    noteFor === s.id ? (
                      <div className="space-y-2">
                        <textarea value={note} onChange={e => setNote(e.target.value)} maxLength={500} rows={2} autoFocus
                          placeholder="O que foi feito, combinado ou próximo passo (opcional)"
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs focus:border-brand-700 focus:outline-none" />
                        <div className="flex gap-2">
                          <button type="button" disabled={pending} onClick={() => act(() => markRulerStepDone(contractId, open.id, s.id, note))}
                            className="rounded-lg bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50">{pending ? 'Salvando…' : 'Confirmar'}</button>
                          <button type="button" onClick={() => { setNoteFor(null); setNote('') }} className="px-2 text-xs text-gray-500 hover:text-gray-800">Cancelar</button>
                        </div>
                      </div>
                    ) : waitFor === s.id ? (
                      <div className="space-y-2 rounded-lg border border-gray-200 p-3">
                        <p className="text-xs font-medium text-gray-700">Aguardando o cliente: o agente não cobra até a data.</p>
                        <div className="flex flex-wrap gap-2">
                          <input type="date" value={waitUntil} min={today} max={plusDays(today, MAX_WAIT_DAYS)} onChange={e => setWaitUntil(e.target.value)} aria-label="Aguardar até"
                            className="rounded-lg border border-gray-300 px-2 py-1 text-xs focus:border-brand-700 focus:outline-none" />
                          <input value={waitReason} onChange={e => setWaitReason(e.target.value)} maxLength={300} placeholder="Motivo (ex.: aguardando assinatura do cliente)"
                            className="min-w-0 flex-1 rounded-lg border border-gray-300 px-2 py-1 text-xs focus:border-brand-700 focus:outline-none" />
                        </div>
                        <div className="flex gap-2">
                          <button type="button" disabled={pending || !waitUntil || waitReason.trim().length < 3} onClick={() => act(() => setRulerStepWaitingAction(contractId, open.id, s.id, waitUntil, waitReason))}
                            className="rounded-lg bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50">{pending ? 'Salvando…' : 'Salvar'}</button>
                          <button type="button" onClick={() => setWaitFor(null)} className="px-2 text-xs text-gray-500 hover:text-gray-800">Cancelar</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
                        <button type="button" onClick={() => { setNoteFor(s.id); setWaitFor(null) }}
                          className="inline-flex items-center gap-1 rounded-lg bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800"><Check className="h-3.5 w-3.5" />Marcar feito</button>
                        {waiting
                          ? <button type="button" disabled={pending} onClick={() => act(() => setRulerStepWaitingAction(contractId, open.id, s.id, null, ''))}
                              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">Não está mais aguardando</button>
                          : <button type="button" onClick={() => { setWaitFor(s.id); setNoteFor(null); setWaitUntil(plusDays(today, 7)); setWaitReason('') }}
                              className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"><Hourglass className="h-3.5 w-3.5" />Aguardando o cliente</button>}
                        {canSkip && (
                          <button type="button" onClick={() => setOv({ kind: 'skip', stepId: s.id, error: null, message: `Seguir sem "${s.label}" (não se aplica a este contrato ou foi resolvido de outro jeito). Fica registrado quem passou, o motivo e quais áreas não concluíram.` })}
                            className="ml-auto text-[11px] text-gray-400 hover:text-warn-700">seguir sem este passo</button>
                        )}
                      </div>
                    )
                  )}
                </article>
              )
            })}
          </div>
        </section>
      )}
      {error && <p className="text-xs text-negative-700">{error}</p>}

      {/* Próximos */}
      {upcoming.length > 0 && (
        <section className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Próximos</p>
          <ol className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
            {upcoming.map(({ s, i }) => (
              <li key={s.id} className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-start gap-3 px-4 py-3 sm:grid-cols-[3.5rem_minmax(0,1fr)_auto]">
                <span className="pt-0.5 text-xs font-semibold tabular-nums text-brand-700">{short(s.due_date)}</span>
                <span className="min-w-0">
                  <span className="block text-sm text-gray-800">{s.with_previous && <span className="mr-1 text-gray-300">↳</span>}{s.label}</span>
                  <span className="mt-0.5 block text-[11px] text-gray-400">
                    Passo {i + 1} · {s.done_when === 'client_notice' ? 'Farmer escreve, consultor envia' : WHO_LABEL[s.who ?? 'owner']}{s.with_previous ? ' · começa junto com o anterior' : ''}
                  </span>
                </span>
                <span className="col-start-2 flex flex-wrap gap-1 sm:col-start-auto sm:justify-end"><Tags step={s} /></span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Concluídos */}
      {done.length > 0 && (
        <section className="space-y-2">
          <button type="button" onClick={() => setShowDone(v => !v)} aria-expanded={showDone}
            className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-gray-400 hover:text-gray-600">
            <ChevronRight className={`h-3.5 w-3.5 transition-transform ${showDone ? 'rotate-90' : ''}`} />Concluídos ({done.length})
          </button>
          {showDone && (
            <ol className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
              {done.map(({ s }) => (
                <li key={s.id} className="flex gap-3 px-4 py-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-positive-100 text-positive-700"><Check className="h-3 w-3" /></span>
                  <span className="min-w-0 text-sm">
                    <span className="text-gray-800">{s.label}</span>
                    <span className="block text-[11px] text-gray-400">{fmtDateTime(s.done_at)}{s.done_by_name ? ` · ${s.done_by_name}` : ''}</span>
                    {s.note && <span className="mt-1 block whitespace-pre-wrap text-xs text-gray-600">{s.note}</span>}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      {/* Rodapé */}
      <div className="flex flex-wrap items-center justify-end gap-4 border-t border-gray-100 pt-3">
        {canAct && open.status === 'active' && (
          <button type="button" onClick={() => setOv({ kind: 'nodeal', error: null, message: 'Sem acordo comercial: a régua é encerrada e o consultor recebe a tarefa de registrar a perda (churn). As regras de churn da Central rodam quando a perda for marcada.' })}
            className="text-xs font-medium text-negative-700 hover:underline">Sem acordo (churn)</button>
        )}
        {isAdmin && (
          <button type="button" disabled={pending} onClick={() => act(() => cancelRuler(contractId))}
            className="text-xs text-gray-400 hover:text-negative-700 disabled:opacity-50">Cancelar régua</button>
        )}
      </div>
    </div>
  )
}

// Resumo na Visão Geral: uma linha com o andamento e o atalho para a aba
export function RenewalRulerSummary({ run, today }: { run: RulerRunView | null; today: string }) {
  const open = run && (run.status === 'active' || run.status === 'ready') ? run : null
  if (!open) return null
  const done = open.steps.filter(s => s.done_at).length
  const cur = open.status === 'active' ? openStepIndexes(open.steps).map(i => open.steps[i]) : []
  const late = cur.some(s => s.due_date && s.due_date < today && !isWaiting(s, today))
  return (
    <Link href="?tab=renovacao" className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-gray-200 bg-white px-5 py-3 hover:border-brand-700">
      <span className="text-sm font-semibold text-gray-900">Régua de renovação</span>
      <span className="text-xs text-gray-500">{done} de {open.steps.length} passos</span>
      <span className="min-w-0 flex-1 truncate text-xs text-gray-600">
        {open.status === 'ready' ? 'Pronta: falta marcar Renovado' : cur.length ? `Agora: ${cur.map(s => s.label).join(' · ')}` : ''}
      </span>
      {late && <span className="rounded-full bg-negative-100 px-2 py-0.5 text-[11px] font-semibold text-negative-700">atrasado</span>}
      <span className="inline-flex items-center text-xs font-medium text-brand-700">abrir<ChevronRight className="h-3.5 w-3.5" /></span>
    </Link>
  )
}
