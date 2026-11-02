// ─── Régua de renovação: andamento por contrato ───────────────────────────────
// Rotina da plataforma (aviso enviado, cron, ações da tela): usa o admin e filtra
// tenant_id em tudo. Uma régua aberta por contrato (índice único).

import { createAdminClient } from '@/lib/supabase/admin'
import { createAgentActivity } from './agent-activity'
import { sendAgentEmail } from './notifications'
import { buildInternalEmailHtml } from './internal-settings'
import { getContractTenantName } from './tenant-name'
import {
  resolveRulerSettings, buildRunSteps, stepRecipients, renderRuler, brDate, shouldNotifyOverdue, daysBetween,
  type RunStep, type RulerSettings,
} from './renewal-ruler'

export type RulerRun = {
  id: string; tenant_id: string; contract_id: string; period_end: string | null
  status: 'active' | 'ready' | 'done' | 'cancelled'; steps: RunStep[]; current_index: number
  lock_renewed: boolean; started_at: string; ready_at: string | null; finished_at: string | null
  updated_at?: string
}

const nowIso = () => new Date().toISOString()
const todayBr = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)
const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL ?? 'https://crm-gestaocontratos-pi.vercel.app').replace(/\/+$/, '')

async function loadSettings(tenantId: string): Promise<{ settings: RulerSettings; companyName: string }> {
  const { data } = await createAdminClient().from('organization_settings')
    .select('copilot_settings, company_name').eq('tenant_id', tenantId).maybeSingle()
  return { settings: resolveRulerSettings(data?.copilot_settings), companyName: (data?.company_name as string | null) ?? '' }
}

async function contractInfo(contractId: string) {
  const admin = createAdminClient()
  const { data: c } = await admin.from('contracts')
    .select('id, tenant_id, process_number, client_name, valid_until, owner_id, current_assignee_id').eq('id', contractId).maybeSingle()
  if (!c) return null
  const ownerId = (c.owner_id ?? c.current_assignee_id ?? null) as string | null
  let consultor = '(a definir)'
  if (ownerId) {
    const { data: p } = await admin.from('profiles').select('full_name').eq('id', ownerId).maybeSingle()
    if (p?.full_name) consultor = p.full_name as string
  }
  return { c, ownerId, consultor, tenantName: await getContractTenantName(admin, contractId) }
}

export async function openRun(tenantId: string, contractId: string): Promise<RulerRun | null> {
  const { data } = await createAdminClient().from('renewal_ruler_runs').select('*')
    .eq('tenant_id', tenantId).eq('contract_id', contractId).in('status', ['active', 'ready']).maybeSingle()
  return (data as RulerRun | null) ?? null
}

// E-mail às áreas do passo (sem valores). Devolve se enviou.
async function notifyStep(run: RulerRun, idx: number, kind: 'step' | 'overdue' | 'ready'): Promise<{ sent: boolean; detail?: string }> {
  const { settings, companyName } = await loadSettings(run.tenant_id)
  const info = await contractInfo(run.contract_id)
  if (!info) return { sent: false, detail: 'contrato não encontrado' }
  const step = run.steps[Math.min(idx, run.steps.length - 1)]
  // Destinatários: áreas do passo; no "pronto para renovar", todas as áreas da régua
  const to = kind === 'ready'
    ? [...new Set(run.steps.flatMap(s => stepRecipients(s, settings.areas)))]
    : stepRecipients(step, settings.areas)
  if (!to.length) return { sent: false, detail: 'nenhum e-mail cadastrado nas áreas deste passo' }
  const prev = idx > 0 ? run.steps[idx - 1] : null
  const vars: Record<string, string> = {
    cliente: info.c.client_name ?? '',
    contrato: info.c.process_number ?? '(sem número)',
    vencimento: brDate(run.period_end),
    passo: step?.label ?? '',
    numero: `${idx + 1} de ${run.steps.length}`,
    prazo: brDate(step?.due_date),
    anterior: prev ? `${prev.label}${prev.done_by_name ? ` (por ${prev.done_by_name})` : ''}` : '—',
    consultor: info.consultor,
    empresa: info.tenantName || companyName || 'Equipe',
    link: `${appUrl()}/contracts/${run.contract_id}`,
    atraso: step?.due_date ? String(Math.max(0, daysBetween(step.due_date, todayBr()))) : '—',
  }
  const t = settings.templates
  const [subjectT, bodyT, badge] = kind === 'step' ? [t.step_subject, t.step_body, 'RÉGUA DE RENOVAÇÃO']
    : kind === 'overdue' ? [t.overdue_subject, t.overdue_body, 'PASSO ATRASADO'] : [t.ready_subject, t.ready_body, 'PRONTO PARA RENOVAR']
  const subject = renderRuler(subjectT, vars)
  const html = buildInternalEmailHtml({ badge, header: subject, messageText: renderRuler(bodyT, vars), companyName: vars.empresa })
  const r = await sendAgentEmail({ tenantId: run.tenant_id, to: to.join(', '), subject, htmlBody: html })
  return r.sent ? { sent: true } : { sent: false, detail: r.error }
}

async function logActivity(run: RulerRun, content: string) {
  await createAdminClient().from('activities').insert({
    tenant_id: run.tenant_id, contract_id: run.contract_id, type: 'system', content,
    metadata: { kind: 'renewal_ruler', run_id: run.id },
  })
}

async function save(run: RulerRun, patch: Partial<RulerRun>) {
  const updated_at = nowIso()
  await createAdminClient().from('renewal_ruler_runs').update({ ...patch, updated_at }).eq('id', run.id).eq('tenant_id', run.tenant_id)
  Object.assign(run, patch, { updated_at })
}

// Passo das áreas da empresa: aviso (sino + WhatsApp + e-mail) ao coordenador e ao gerente e
// tarefa encaminhada ao coordenador da 1ª área; o dono da oportunidade acompanha e recebe o retorno.
async function handoffStep(run: RulerRun, idx: number): Promise<string> {
  const step = run.steps[idx]
  if (step.done_when === 'client_notice') return ''
  const areaIds = step.areas.filter(a => a.startsWith('area:')).map(a => a.slice(5))
  const info = await contractInfo(run.contract_id)
  if (!info) return ''
  const admin = createAdminClient()
  const { data: areas } = areaIds.length
    ? await admin.from('org_areas').select('id, name, lead_id, manager_id').eq('tenant_id', run.tenant_id).in('id', areaIds)
    : { data: [] as { id: string; name: string; lead_id: string | null; manager_id: string | null }[] }
  const list = ((areas ?? []) as { id: string; name: string; lead_id: string | null; manager_id: string | null }[])
    .sort((a, b) => areaIds.indexOf(a.id) - areaIds.indexOf(b.id))
  const to = list[0]?.lead_id ?? info.ownerId
  const also = [...new Set(list.flatMap(a => [a.lead_id, a.manager_id]).filter((x): x is string => !!x && x !== to))]
  const { createHandoff } = await import('./handoff')
  const due = step.due_date ?? todayBr()
  await createHandoff({
    tenantId: run.tenant_id, contractId: run.contract_id, toUserId: to, watcherId: to === info.ownerId ? null : info.ownerId, alsoNotify: also,
    title: `Renovação · ${step.label} — ${info.c.client_name ?? ''}`,
    content: `Contrato ${info.c.process_number ?? ''} (${info.c.client_name ?? ''}) vence em ${brDate(run.period_end)}. Passo ${idx + 1} de ${run.steps.length} da régua de renovação: ${step.label}.${list.length ? ` Áreas: ${list.map(a => a.name).join(', ')}.` : ''} Consultor: ${info.consultor}.`,
    dueIso: due < todayBr() ? todayBr() : due, rulerRunId: run.id, stepId: step.id,
  })
  return list.length ? ` Tarefa encaminhada a ${list[0].name}.` : ' Tarefa ao consultor.'
}

// Passo atual chegou: avisa as áreas e marca a data do aviso
async function arrive(run: RulerRun, idx: number) {
  let handoff = ''
  try { handoff = await handoffStep(run, idx) } catch (e) { console.error('[régua] encaminhamento:', e) }
  const r = await notifyStep(run, idx, 'step')
  const steps = run.steps.map((s, i) => (i === idx ? { ...s, notified_at: nowIso() } : s))
  await save(run, { steps, current_index: idx })
  await logActivity(run, `🧭 Régua de renovação: passo ${idx + 1} de ${run.steps.length} — ${run.steps[idx].label} (prazo ${brDate(run.steps[idx].due_date)}).` +
    (r.sent ? ' Áreas avisadas por e-mail.' : r.detail?.startsWith('nenhum e-mail') && handoff ? '' : ` E-mail às áreas não enviado (${r.detail}).`) + handoff)
}

/**
 * Inicia a régua do período atual. `firstDone`: o 1º passo já aconteceu
 * (ex.: o aviso ao cliente acabou de ser enviado).
 */
export async function startRenewalRuler(contractId: string, opts: { userId?: string | null; firstDone?: boolean; periodEnd?: string | null } = {}):
  Promise<{ ok: true; run: RulerRun; created: boolean } | { ok: false; error: string }> {
  const admin = createAdminClient()
  const { data: c } = await admin.from('contracts').select('id, tenant_id, valid_until').eq('id', contractId).maybeSingle()
  if (!c?.tenant_id) return { ok: false, error: 'Contrato não encontrado.' }
  const tenantId = c.tenant_id as string
  const existing = await openRun(tenantId, contractId)
  if (existing) return { ok: true, run: existing, created: false }
  const { settings } = await loadSettings(tenantId)
  if (!settings.enabled) return { ok: false, error: 'A régua de renovação está desligada nas configurações.' }
  if (!settings.steps.length) return { ok: false, error: 'Nenhum passo cadastrado na régua de renovação.' }
  const periodEnd = (c.valid_until as string | null)?.slice(0, 10) ?? null
  // Aviso de um período que já foi renovado (vigência mudou): não abre régua nova
  if (opts.periodEnd && opts.periodEnd.slice(0, 10) !== periodEnd) return { ok: false, error: 'O aviso é de um período anterior ao atual.' }
  const steps = buildRunSteps(settings.steps, periodEnd)
  const { data, error } = await admin.from('renewal_ruler_runs').insert({
    tenant_id: tenantId, contract_id: contractId, period_end: periodEnd, steps, current_index: 0,
    lock_renewed: settings.lock_renewed, started_by: opts.userId ?? null,
  }).select('*').single()
  if (error || !data) {
    const again = await openRun(tenantId, contractId)   // outra chamada abriu ao mesmo tempo
    return again ? { ok: true, run: again, created: false } : { ok: false, error: error?.message ?? 'Não foi possível iniciar.' }
  }
  const run = data as RulerRun
  await logActivity(run, `🧭 Régua de renovação iniciada (${steps.length} passos, vencimento ${brDate(periodEnd)}).`)
  if (opts.firstDone) {
    await completeStepInternal(run, 0, opts.userId ?? null, 'Aviso ao cliente enviado', true)
  } else {
    await arrive(run, 0)
  }
  return { ok: true, run, created: true }
}

async function completeStepInternal(run: RulerRun, idx: number, userId: string | null, note: string | null, silent = false): Promise<boolean> {
  const admin = createAdminClient()
  let name: string | null = null
  if (userId) name = ((await admin.from('profiles').select('full_name').eq('id', userId).maybeSingle()).data?.full_name as string | null) ?? null
  const steps = run.steps.map((s, i) => (i === idx ? { ...s, done_at: nowIso(), done_by: userId, done_by_name: name, note: note?.slice(0, 500) ?? null } : s))
  // Trava otimista: se outra pessoa marcou ao mesmo tempo, só uma vale (evita e-mail em dobro)
  const stamp = nowIso()
  let q = admin.from('renewal_ruler_runs').update({ steps, updated_at: stamp }).eq('id', run.id).eq('tenant_id', run.tenant_id)
  if (run.updated_at) q = q.eq('updated_at', run.updated_at)
  const { data: claimed } = await q.select('id')
  if (!claimed?.length) return false
  Object.assign(run, { steps, updated_at: stamp })
  // Tarefa encaminhada deste passo (se houver) fica concluída junto
  await admin.from('activities').update({ status: 'done', completed: true })
    .eq('tenant_id', run.tenant_id).eq('metadata->>kind', 'handoff').eq('metadata->>ruler_run_id', run.id).eq('metadata->>step_id', run.steps[idx].id).neq('status', 'done')
  if (!silent) await logActivity(run, `✅ Régua de renovação: "${run.steps[idx].label}" concluído${name ? ` por ${name}` : ''}.${note ? ` Obs.: ${note.slice(0, 300)}` : ''}`)

  const next = steps.findIndex(s => !s.done_at)
  if (next >= 0) { await arrive(run, next); return true }

  // Todos concluídos: pronto para renovar → tarefa ao consultor e aviso às áreas
  await save(run, { status: 'ready', ready_at: nowIso(), current_index: steps.length })
  const info = await contractInfo(run.contract_id)
  if (info) {
    await createAgentActivity(admin, {
      contractId: run.contract_id,
      dedupeKey: `ruler-ready:${run.id}`,
      dueInDays: 1,
      assignedTo: info.ownerId,
      activityType: 'task',
      agent: 'farmer',
      title: `Revisar e marcar Renovado — ${info.c.client_name ?? ''}`,
      content: '[Farmer] Todos os passos da régua de renovação foram concluídos. Confira a nova vigência e o valor e marque "Renovado" no funil de Gestão de Contratos.',
      metadata: { kind: 'renewal_ruler_ready', run_id: run.id },
    })
  }
  const r = await notifyStep(run, steps.length - 1, 'ready')
  await logActivity(run, `🏁 Régua de renovação concluída: pronto para marcar Renovado.${r.sent ? ' Áreas avisadas.' : ''}`)
  return true
}

export async function completeRulerStep(tenantId: string, runId: string, stepId: string, userId: string, note?: string | null):
  Promise<{ ok: true } | { ok: false; error: string }> {
  const { data } = await createAdminClient().from('renewal_ruler_runs').select('*').eq('id', runId).eq('tenant_id', tenantId).maybeSingle()
  const run = data as RulerRun | null
  if (!run || run.status !== 'active') return { ok: false, error: 'Régua não está em andamento.' }
  const idx = run.steps.findIndex(s => s.id === stepId)
  if (idx < 0) return { ok: false, error: 'Passo não encontrado.' }
  if (run.steps[idx].done_at) return { ok: false, error: 'Este passo já foi concluído.' }
  const firstOpen = run.steps.findIndex(s => !s.done_at)
  if (idx !== firstOpen) return { ok: false, error: `Conclua antes: "${run.steps[firstOpen].label}".` }
  const ok = await completeStepInternal(run, idx, userId, note ?? null)
  return ok ? { ok: true } : { ok: false, error: 'A régua mudou enquanto você marcava (outra pessoa atualizou). Atualize a página.' }
}

// Renovado marcado: encerra a régua. Lost/rescisão: cancela.
export async function finishRenewalRuler(contractId: string, how: 'done' | 'cancelled') {
  const admin = createAdminClient()
  const { data: c } = await admin.from('contracts').select('tenant_id').eq('id', contractId).maybeSingle()
  if (!c?.tenant_id) return
  const run = await openRun(c.tenant_id as string, contractId)
  if (!run) return
  await save(run, { status: how, finished_at: nowIso() })
  await logActivity(run, how === 'done' ? '🏁 Régua de renovação encerrada: contrato renovado.' : '⛔ Régua de renovação cancelada.')
}

// Pode marcar Renovado? (trava até concluir os passos, se a empresa usa a trava)
export async function renewalLockMessage(tenantId: string, contractId: string): Promise<string | null> {
  const run = await openRun(tenantId, contractId)
  if (!run || run.status !== 'active' || !run.lock_renewed) return null
  const pending = run.steps.filter(s => !s.done_at)
  if (!pending.length) return null
  return `Conclua a régua de renovação antes de marcar Renovado: faltam ${pending.length} passo(s), começando por "${pending[0].label}" (aba Visão Geral da oportunidade).`
}

// Cron diário: passo atual atrasado → avisa uma vez
export async function runRulerOverdue(tenantId: string): Promise<{ checked: number; notified: number }> {
  const admin = createAdminClient()
  const { data } = await admin.from('renewal_ruler_runs').select('*').eq('tenant_id', tenantId).eq('status', 'active').limit(500)
  if (!data?.length) return { checked: 0, notified: 0 }
  const { settings } = await loadSettings(tenantId)
  const today = todayBr()
  let notified = 0
  for (const run of data as RulerRun[]) {
    const idx = run.steps.findIndex(s => !s.done_at)
    if (idx < 0) continue
    const step = run.steps[idx]
    if (!shouldNotifyOverdue(step, today, settings.overdue_repeat_days)) continue
    const r = await notifyStep(run, idx, 'overdue')
    // Prévia ("Testar" na tela IA): o e-mail já foi anotado; não marca nem registra
    if ((await import('./agent-preview')).inPreview()) { if (r.sent) notified++; continue }
    const count = (step.overdue_count ?? 0) + 1
    const steps = run.steps.map((s, i) => (i === idx ? { ...s, overdue_notified_at: nowIso(), overdue_count: count } : s))
    await save(run, { steps })
    const late = step.due_date ? daysBetween(step.due_date, today) : 0
    await logActivity(run, `⏰ Régua de renovação: "${step.label}" atrasado há ${late} dia(s) (prazo ${brDate(step.due_date)})` +
      `${count > 1 ? ` · ${count}º aviso de atraso` : ''}.${r.sent ? ' Áreas avisadas.' : ` E-mail não enviado (${r.detail}).`}`)
    if (r.sent) notified++
  }
  return { checked: data.length, notified }
}

// Aviso ao cliente enviado: conclui o passo "aviso ao cliente" (abre a régua se ainda não abriu)
export async function markClientNoticeStep(contractId: string, opts: { userId?: string | null; periodEnd?: string | null } = {}) {
  const r = await startRenewalRuler(contractId, { userId: opts.userId ?? null, firstDone: false, periodEnd: opts.periodEnd ?? null })
  if (!r.ok) return r
  const run = r.run
  const idx = run.steps.findIndex(s => !s.done_at && s.done_when === 'client_notice')
  if (idx < 0) return { ok: true as const }
  const firstOpen = run.steps.findIndex(s => !s.done_at)
  if (idx === firstOpen) await completeStepInternal(run, idx, opts.userId ?? null, 'Aviso ao cliente enviado')
  else {
    // Passo interno anterior ainda aberto: marca o aviso como feito sem pular a ordem dos outros
    const steps = run.steps.map((s, i) => (i === idx ? { ...s, done_at: nowIso(), done_by: opts.userId ?? null, note: 'Aviso ao cliente enviado' } : s))
    await save(run, { steps })
    await logActivity(run, `✅ Régua de renovação: "${run.steps[idx].label}" concluído (aviso enviado).`)
  }
  return { ok: true as const }
}

// Passar um passo fora da ordem ou que não se aplica (MUDAR + motivo): fica registrado
export async function skipRulerStep(tenantId: string, runId: string, stepId: string, userId: string, reason: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data } = await createAdminClient().from('renewal_ruler_runs').select('*').eq('id', runId).eq('tenant_id', tenantId).maybeSingle()
  const run = data as RulerRun | null
  if (!run || run.status !== 'active') return { ok: false, error: 'Régua não está em andamento.' }
  const idx = run.steps.findIndex(s => s.id === stepId)
  if (idx < 0 || run.steps[idx].done_at) return { ok: false, error: 'Passo não encontrado ou já concluído.' }
  const firstOpen = run.steps.findIndex(s => !s.done_at)
  if (idx === firstOpen) {
    const ok = await completeStepInternal(run, idx, userId, `⚠ Passado fora do processo: ${reason}`)
    return ok ? { ok: true } : { ok: false, error: 'A régua mudou. Atualize a página.' }
  }
  const steps = run.steps.map((s, i) => (i === idx ? { ...s, done_at: nowIso(), done_by: userId, note: `⚠ Passado fora do processo: ${reason}` } : s))
  await save(run, { steps })
  await logActivity(run, `⚠ Régua de renovação: "${run.steps[idx].label}" passado fora da ordem. Motivo: ${reason}`)
  return { ok: true }
}

// Sem acordo comercial: cancela a régua e pede ao consultor para registrar a perda (churn)
export async function rulerNoDeal(tenantId: string, contractId: string, userId: string, reason: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const run = await openRun(tenantId, contractId)
  if (!run) return { ok: false, error: 'Não há régua aberta.' }
  const admin = createAdminClient()
  await save(run, { status: 'cancelled', finished_at: nowIso() })
  await admin.from('activities').update({ status: 'done', completed: true })
    .eq('tenant_id', tenantId).eq('metadata->>kind', 'handoff').eq('metadata->>ruler_run_id', run.id).neq('status', 'done')
  const { data: me } = await admin.from('profiles').select('full_name').eq('id', userId).eq('tenant_id', tenantId).maybeSingle()
  await logActivity(run, `❌ Renovação sem acordo comercial — registrado por ${me?.full_name ?? 'alguém'}. Motivo: ${reason}`)
  const info = await contractInfo(contractId)
  if (info) {
    await createAgentActivity(admin, {
      contractId, dedupeKey: `ruler-nodeal:${run.id}`, dueInDays: 0, assignedTo: info.ownerId, activityType: 'task', agent: 'farmer',
      title: `Registrar a perda (churn) — ${info.c.client_name ?? ''}`,
      content: `[Farmer] A renovação ficou sem acordo comercial (${reason}). Marque a perda no funil de Gestão de Contratos com o motivo: as regras de churn da Central rodam na hora.`,
      metadata: { kind: 'renewal_no_deal', run_id: run.id },
    })
  }
  return { ok: true }
}
