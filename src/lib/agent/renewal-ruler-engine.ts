// ─── Régua de renovação: andamento por contrato ───────────────────────────────
// Rotina da plataforma (aviso enviado, cron, ações da tela): usa o admin e filtra
// tenant_id em tudo. Uma régua aberta por contrato (índice único).

import { createAdminClient } from '@/lib/supabase/admin'
import { createAgentActivity } from './agent-activity'
import { sendAgentEmail } from './notifications'
import { buildInternalEmailHtml } from './internal-settings'
import { getContractTenantName } from './tenant-name'
import {
  resolveRulerSettings, buildRunSteps, stepRecipients, renderRuler, brDate, shouldNotifyOverdue, daysBetween, openStepIndexes, stepGroup,
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
async function notifyStep(run: RulerRun, idx: number, kind: 'step' | 'overdue' | 'ready', peopleOverride?: boolean): Promise<{ sent: boolean; detail?: string }> {
  const { settings, companyName } = await loadSettings(run.tenant_id)
  const info = await contractInfo(run.contract_id)
  if (!info) return { sent: false, detail: 'contrato não encontrado' }
  const step = run.steps[Math.min(idx, run.steps.length - 1)]
  // Destinatários: áreas da empresa do passo (no "pronto para renovar", de todos os passos).
  // Chegada de passo encaminhado: coordenador e gerente já recebem pela tarefa → aqui só os e-mails de fora da área.
  const to = await areaEmails(run.tenant_id, kind === 'ready' ? run.steps.flatMap(s => s.areas) : step.areas,
    peopleOverride ?? !(kind === 'step' && (step.who ?? 'areas') !== 'owner'), settings)
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

// E-mails das áreas: e-mails de fora cadastrados na área + (people) coordenador e gerente; lista antiga, se ainda houver
async function areaEmails(tenantId: string, keys: string[], people: boolean, settings: RulerSettings): Promise<string[]> {
  const out = new Map<string, string>()
  for (const e of stepRecipients({ areas: keys }, settings.areas)) out.set(e.toLowerCase(), e)
  const ids = [...new Set(keys.filter(k => k.startsWith('area:')).map(k => k.slice(5)))]
  if (!ids.length) return [...out.values()]
  const admin = createAdminClient()
  const { data } = await admin.from('org_areas').select('lead_id, manager_id, emails').eq('tenant_id', tenantId).in('id', ids)
  const rows = (data ?? []) as { lead_id: string | null; manager_id: string | null; emails: string[] | null }[]
  for (const r of rows) for (const e of r.emails ?? []) out.set(e.toLowerCase(), e)
  const pids = people ? [...new Set(rows.flatMap(r => [r.lead_id, r.manager_id]).filter((x): x is string => !!x))] : []
  if (pids.length) {
    const { data: ps } = await admin.from('profiles').select('email').eq('tenant_id', tenantId).in('id', pids)
    for (const p of (ps ?? []) as { email: string | null }[]) if (p.email) out.set(p.email.toLowerCase(), p.email)
  }
  return [...out.values()]
}

// Depois da resposta (tela rápida): aviso, IA e envios rodam em seguida. Fora de uma requisição, roda na hora.
async function later(fn: () => Promise<void>) {
  try {
    const { after } = await import('next/server')
    after(() => fn().catch(e => console.error('[régua] em segundo plano:', e)))
  } catch { await fn() }
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

// O agente de IA prepara o material do passo (a pessoa revisa e conclui). Sem IA: devolve o motivo.
async function agentPrepare(run: RulerRun, idx: number, info: NonNullable<Awaited<ReturnType<typeof contractInfo>>>): Promise<{ text: string | null; why?: string }> {
  const step = run.steps[idx]
  const admin = createAdminClient()
  const { data: org } = await admin.from('organization_settings').select('ai_paused').eq('tenant_id', run.tenant_id).maybeSingle()
  if (org?.ai_paused) return { text: null, why: 'modo sem IA ligado' }
  const { loadTheoTenantAi, monthUsage } = await import('@/lib/ai/theo-server')
  const ai = await loadTheoTenantAi(run.tenant_id)
  if (!ai.provider || !ai.key || !ai.model) return { text: null, why: 'IA não configurada' }
  if ((await monthUsage(run.tenant_id)).total >= ai.budgetUsd) return { text: null, why: 'orçamento de IA do mês esgotado' }
  const done = run.steps.filter(s => s.done_at).map(s => `- ${s.label}${s.done_by_name ? ` (por ${s.done_by_name})` : ''}${s.note ? `: ${s.note}` : ''}`).join('\n')
  const { runTheo } = await import('@/lib/ai/theo-engine')
  const { estimateCostUsd } = await import('@/lib/ai/theo-catalog')
  const r = await runTheo({
    provider: ai.provider as never, model: ai.model, key: ai.key, tools: [],
    system: [
      'Você é o agente Farmer (carteira e contratos) de um CRM. Escreva em português do Brasil.',
      'Prepare o material pedido para uma pessoa da empresa revisar antes de usar. Seja direto, em tópicos curtos quando ajudar.',
      'Use apenas os dados informados; nunca invente valor, data ou nome. Datas dd/mm/aaaa.',
    ].join('\n'),
    history: [{ role: 'user', text: `Passo da renovação: ${step.label}\nInstruções: ${step.instructions || step.label}\n\nDados:\ncliente: ${info.c.client_name ?? ''}\ncontrato: ${info.c.process_number ?? ''}\nvencimento: ${brDate(run.period_end)}\nconsultor: ${info.consultor}\nprazo do passo: ${brDate(step.due_date)}\n\nO que já foi feito na renovação:\n${done || '(nada registrado ainda)'}` }],
    read: async () => '',
  })
  if (r.tokensIn || r.tokensOut) {
    const { scopeAdminClient } = await import('@/lib/tenant/scoped-admin')
    await scopeAdminClient(admin, run.tenant_id, null).from('assistant_usage_log').insert({
      user_id: null, input_tokens: r.tokensIn, output_tokens: r.tokensOut, provider: ai.provider, model: ai.model,
      cost_usd: estimateCostUsd(ai.provider as never, ai.model, r.tokensIn, r.tokensOut),
    })
  }
  if (r.error || !r.text.trim()) return { text: null, why: r.error ?? 'IA sem resposta' }
  return { text: r.text.trim().slice(0, 6000) }
}

// Passo chegou: tarefa para quem faz (consultor, coordenador da área ou revisão do que o agente preparou).
// Área: aviso (sino + WhatsApp + e-mail) ao coordenador e ao gerente; o dono da oportunidade acompanha e recebe o retorno.
async function handoffStep(run: RulerRun, idx: number): Promise<string> {
  const step = run.steps[idx]
  if (step.done_when === 'client_notice') return ''
  const who = step.who ?? (step.areas.some(a => a.startsWith('area:')) ? 'areas' : 'owner')
  const areaIds = step.areas.filter(a => a.startsWith('area:')).map(a => a.slice(5))
  const info = await contractInfo(run.contract_id)
  if (!info) return ''
  const admin = createAdminClient()
  const { data: areas } = areaIds.length && who !== 'owner'
    ? await admin.from('org_areas').select('id, name, lead_id, manager_id').eq('tenant_id', run.tenant_id).in('id', areaIds)
    : { data: [] as { id: string; name: string; lead_id: string | null; manager_id: string | null }[] }
  const list = ((areas ?? []) as { id: string; name: string; lead_id: string | null; manager_id: string | null }[])
    .sort((a, b) => areaIds.indexOf(a.id) - areaIds.indexOf(b.id))
  const to = list[0]?.lead_id ?? info.ownerId
  const also = [...new Set(list.flatMap(a => [a.lead_id, a.manager_id]).filter((x): x is string => !!x && x !== to))]
  let prepared = ''
  let agentNote = ''
  let draft: string | null = null
  if (who === 'agent') {
    const w = await agentPrepare(run, idx, info).catch(e => ({ text: null, why: String((e as Error)?.message ?? e) }))
    draft = w.text
    if (w.text) { prepared = `\n\n🤖 Preparado pelo agente (revise antes de usar):\n${w.text}`; agentNote = ' Agente preparou o material.' }
    else { prepared = `\n\n(O agente de IA não preparou: ${w.why}. Faça manualmente.)`; agentNote = ` Agente não preparou (${w.why}).` }
  }
  const { createHandoff } = await import('./handoff')
  const due = step.due_date ?? todayBr()
  const body = (areaNote: string) => `Contrato ${info.c.process_number ?? ''} (${info.c.client_name ?? ''}) vence em ${brDate(run.period_end)}. Passo ${idx + 1} de ${run.steps.length} da régua de renovação: ${step.label}.` +
    `${step.instructions ? ` O que fazer: ${step.instructions}` : ''}${areaNote} Consultor: ${info.consultor}.` +
    `${step.requires_file ? ' Para concluir: anexe o arquivo na aba Arquivos do contrato.' : ''}${prepared}`
  const base = { tenantId: run.tenant_id, contractId: run.contract_id, dueIso: due < todayBr() ? todayBr() : due, rulerRunId: run.id, stepId: step.id }
  if (list.length > 1) {
    // Várias áreas: cada uma recebe a sua tarefa (coordenador faz; gerente avisado). O passo fecha quando todas concluírem.
    for (const a of list) {
      const toA = a.lead_id ?? info.ownerId
      await createHandoff({
        ...base, toUserId: toA, watcherId: toA === info.ownerId ? null : info.ownerId,
        alsoNotify: [a.manager_id].filter((x): x is string => !!x && x !== toA), areaId: a.id, areaName: a.name,
        title: `Renovação · ${step.label} (${a.name}) — ${info.c.client_name ?? ''}`,
        content: body(` Sua parte: área ${a.name}. Também neste passo: ${list.filter(x => x.id !== a.id).map(x => x.name).join(', ')}; o passo fecha quando todas concluírem.`),
      })
    }
    return ` Uma tarefa para cada área: ${list.map(a => a.name).join(', ')}.` + agentNote
  }
  // Passo do agente com envio: quem revisa ajusta o texto ao concluir e ele vai para as áreas escolhidas
  let send: { userIds: string[]; emails: string[]; areaNames: string[]; draft: string } | null = null
  const sendIds = who === 'agent' ? (step.send_areas ?? []).map(k => k.slice(5)) : []
  if (sendIds.length) {
    const { data: sa } = await admin.from('org_areas').select('name, lead_id, manager_id, member_ids, emails').eq('tenant_id', run.tenant_id).in('id', sendIds)
    const rows = (sa ?? []) as { name: string; lead_id: string | null; manager_id: string | null; member_ids: string[] | null; emails: string[] | null }[]
    send = {
      userIds: [...new Set(rows.flatMap(r => [r.lead_id, r.manager_id, ...(r.member_ids ?? [])]).filter((x): x is string => !!x))],
      emails: [...new Set(rows.flatMap(r => r.emails ?? []))],
      areaNames: rows.map(r => r.name), draft: draft ?? '',
    }
    prepared += `\n\nAo concluir, o texto revisado vai para: ${send.areaNames.join(', ')}.`
  }
  await createHandoff({
    ...base, toUserId: to, watcherId: to === info.ownerId ? null : info.ownerId, alsoNotify: also,
    areaId: list[0]?.id ?? null, areaName: list[0]?.name ?? null, send,
    title: `Renovação · ${step.label} — ${info.c.client_name ?? ''}`,
    content: body(list.length ? ` Área: ${list[0].name}.` : ''),
  })
  return (list.length ? ` Tarefa encaminhada a ${list[0].name}.` : ' Tarefa ao consultor.') + agentNote
}

// Passo chegou junto com os que "começam junto com o anterior"
async function arriveGroup(run: RulerRun, idx: number) {
  for (const i of stepGroup(run.steps, idx)) await arrive(run, i)
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
export async function startRenewalRuler(contractId: string, opts: { userId?: string | null; firstDone?: boolean; periodEnd?: string | null; defer?: boolean } = {}):
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
  } else if (opts.defer) {
    await later(() => arriveGroup(run, 0))
  } else {
    await arriveGroup(run, 0)
  }
  return { ok: true, run, created: true }
}

async function completeStepInternal(run: RulerRun, idx: number, userId: string | null, note: string | null, silent = false, defer = false): Promise<boolean> {
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

  // Ainda há passo em andamento (paralelo): espera concluir. Senão, chega o próximo (com os que correm junto).
  if (steps.some(s => !s.done_at && s.notified_at)) return true
  const next = steps.findIndex(s => !s.done_at)
  if (next >= 0) {
    if (defer) await later(() => arriveGroup(run, next))
    else await arriveGroup(run, next)
    return true
  }

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
  const open = openStepIndexes(run.steps)
  if (!open.includes(idx)) return { ok: false, error: `Conclua antes: "${run.steps[open[0]].label}".` }
  const block = await fileBlock(run, idx)
  if (block) return { ok: false, error: block }
  // Passo dividido por áreas: cada área conclui a sua tarefa (para seguir sem alguma, "passar (fora do processo)")
  const st = run.steps[idx]
  if ((st.send_areas ?? []).length && st.who === 'agent' && (await pendingAreaTasks(run, stepId)).some(t => t.metadata?.send)) {
    return { ok: false, error: `"${st.label}" envia um texto para as áreas: conclua pela tarefa (Atividades) para revisar o texto antes de enviar.` }
  }
  const split = st.who !== 'owner' && st.areas.filter(a => a.startsWith('area:')).length > 1
  const waiting = split ? (await pendingAreaTasks(run, stepId)).filter(t => t.metadata?.area_id) : []
  if (waiting.length) {
    return { ok: false, error: `Aguardando as áreas: ${waiting.map(t => String(t.metadata?.area_name ?? 'área')).join(', ')}. Cada área conclui a sua tarefa; para seguir sem elas, use "passar (fora do processo)".` }
  }
  const ok = await completeStepInternal(run, idx, userId, note ?? null, false, true)
  return ok ? { ok: true } : { ok: false, error: 'A régua mudou enquanto você marcava (outra pessoa atualizou). Atualize a página.' }
}

// Passo que exige anexo: precisa de arquivo no contrato enviado depois que o passo chegou
async function fileBlock(run: RulerRun, idx: number, byUser?: string | null): Promise<string | null> {
  const step = run.steps[idx]
  if (!step.requires_file) return null
  const since = step.notified_at ?? run.started_at
  let q = createAdminClient().from('contract_files').select('id', { count: 'exact', head: true })
    .eq('tenant_id', run.tenant_id).eq('contract_id', run.contract_id).gte('created_at', since)
  if (byUser) q = q.eq('uploaded_by', byUser)   // passo com várias áreas: cada uma anexa o seu
  const { count } = await q
  return count ? null : `"${step.label}" pede um arquivo: anexe ${byUser ? 'o seu ' : ''}na aba Arquivos do contrato e depois conclua.`
}

// Tarefas por área ainda abertas neste passo
async function pendingAreaTasks(run: RulerRun, stepId: string) {
  const { data } = await createAdminClient().from('activities').select('id, assigned_to, metadata')
    .eq('tenant_id', run.tenant_id).eq('metadata->>kind', 'handoff').eq('metadata->>ruler_run_id', run.id).eq('metadata->>step_id', stepId).neq('status', 'done')
  return ((data ?? []) as { id: string; assigned_to: string | null; metadata: Record<string, unknown> | null }[])
}

// Pode concluir este passo agora? (usado antes de fechar a tarefa encaminhada)
export async function rulerStepBlock(tenantId: string, runId: string, stepId: string, byUser?: string | null): Promise<string | null> {
  const { data } = await createAdminClient().from('renewal_ruler_runs').select('*').eq('id', runId).eq('tenant_id', tenantId).maybeSingle()
  const run = data as RulerRun | null
  if (!run || run.status !== 'active') return null
  const idx = run.steps.findIndex(s => s.id === stepId)
  if (idx < 0 || run.steps[idx].done_at) return null
  return fileBlock(run, idx, byUser)
}

// Renovado marcado: encerra a régua. Lost/rescisão: cancela.
export async function finishRenewalRuler(contractId: string, how: 'done' | 'cancelled') {
  const admin = createAdminClient()
  const { data: c } = await admin.from('contracts').select('tenant_id').eq('id', contractId).maybeSingle()
  if (!c?.tenant_id) return
  const run = await openRun(c.tenant_id as string, contractId)
  if (!run) return
  await save(run, { status: how, finished_at: nowIso() })
  // Tarefas encaminhadas da régua que ficaram abertas: encerradas junto
  await admin.from('activities').update({ status: 'done', completed: true })
    .eq('tenant_id', run.tenant_id).eq('metadata->>kind', 'handoff').eq('metadata->>ruler_run_id', run.id).neq('status', 'done')
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
    for (const idx of openStepIndexes(run.steps)) {
    const step = run.steps[idx]
    if (!shouldNotifyOverdue(step, today, settings.overdue_repeat_days)) continue
    // Tarefas abertas do passo (por área): o agente cobra quem está devendo e avisa o gerente
    const pend = await pendingAreaTasks(run, step.id)
    const lateDays = step.due_date ? daysBetween(step.due_date, today) : 0
    // Gerente entra na cobrança a partir de N dias de atraso (editável)
    const escalate = lateDays >= settings.escalate_after_days
    let escalated: string[] = []
    if (pend.length) {
      const { notifyPerson } = await import('./handoff')
      const link = `${appUrl()}/contracts/${run.contract_id}`
      for (const t of pend) {
        const area = t.metadata?.area_name ? ` (${t.metadata.area_name})` : ''
        const text = `⏰ Farmer: a tarefa *${step.label}*${area} da renovação está atrasada há ${lateDays} dia(s) (prazo ${brDate(step.due_date)}). Escreva no CRM o que foi feito e conclua: ${link}`
        let managers = escalate ? ((t.metadata?.also_notify as string[] | undefined) ?? []) : []
        // Passo do consultor (sem área): gerente da área do consultor ou o escolhido na régua
        if (escalate && !t.metadata?.area_id && t.assigned_to) managers = await ownerManagers(run.tenant_id, t.assigned_to, settings.escalate_to)
        escalated = [...escalated, ...managers]
        const ids = [t.assigned_to, ...managers].filter((x): x is string => !!x)
        for (const u of [...new Set(ids)]) await notifyPerson(run.tenant_id, u, { text, subject: `Atrasado: ${step.label}${area}`, contractId: run.contract_id })
      }
    }
    const r = await notifyStep(run, idx, 'overdue', pend.length ? false : undefined)
    // Prévia ("Testar" na tela IA): o e-mail já foi anotado; não marca nem registra
    if ((await import('./agent-preview')).inPreview()) { if (r.sent) notified++; continue }
    const count = (step.overdue_count ?? 0) + 1
    const steps = run.steps.map((s, i) => (i === idx ? { ...s, overdue_notified_at: nowIso(), overdue_count: count } : s))
    await save(run, { steps })
    const late = step.due_date ? daysBetween(step.due_date, today) : 0
    await logActivity(run, `⏰ Régua de renovação: "${step.label}" atrasado há ${late} dia(s) (prazo ${brDate(step.due_date)})` +
      `${count > 1 ? ` · ${count}º aviso de atraso` : ''}.${pend.length ? ` Agente cobrou: ${pend.map(t => String(t.metadata?.area_name ?? 'responsável')).join(', ')}${escalated.length ? ' e o gerente' : ''}.` : ''}` +
      `${r.sent ? ' Áreas avisadas por e-mail.' : pend.length ? '' : ` E-mail não enviado (${r.detail}).`}`)
    if (r.sent || pend.length) notified++
    }
  }
  return { checked: data.length, notified }
}

// Gerente de quem é o consultor: área em que ele é coordenador ou do time; senão, o escolhido na régua
async function ownerManagers(tenantId: string, userId: string, fallback: string | null): Promise<string[]> {
  const { data } = await createAdminClient().from('org_areas').select('lead_id, manager_id, member_ids').eq('tenant_id', tenantId)
  const rows = (data ?? []) as { lead_id: string | null; manager_id: string | null; member_ids: string[] | null }[]
  const mine = rows.filter(r => r.lead_id === userId || (r.member_ids ?? []).includes(userId)).map(r => r.manager_id).filter((x): x is string => !!x && x !== userId)
  const out = mine.length ? mine : fallback && fallback !== userId ? [fallback] : []
  return [...new Set(out)]
}

// "Aguardando o cliente": sem cobrança até a data; registra quem e por quê. until = null encerra a espera.
export async function setRulerStepWaiting(tenantId: string, runId: string, stepId: string, userId: string, until: string | null, reason: string):
  Promise<{ ok: true } | { ok: false; error: string }> {
  const { data } = await createAdminClient().from('renewal_ruler_runs').select('*').eq('id', runId).eq('tenant_id', tenantId).maybeSingle()
  const run = data as RulerRun | null
  if (!run || run.status !== 'active') return { ok: false, error: 'Régua não está em andamento.' }
  const idx = run.steps.findIndex(s => s.id === stepId)
  if (idx < 0 || run.steps[idx].done_at) return { ok: false, error: 'Passo não encontrado ou já concluído.' }
  if (!openStepIndexes(run.steps).includes(idx)) return { ok: false, error: 'Só dá para marcar a espera em um passo em andamento.' }
  const today = todayBr()
  if (until !== null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(until) || until < today) return { ok: false, error: 'Escolha uma data de hoje em diante.' }
    if (daysBetween(today, until) > 90) return { ok: false, error: 'A espera pode ser de até 90 dias.' }
    if (reason.trim().length < 3) return { ok: false, error: 'Escreva o motivo (ex.: aguardando assinatura do cliente).' }
  }
  const steps = run.steps.map((s, i) => (i === idx ? { ...s, waiting_until: until, waiting_reason: until ? reason.trim().slice(0, 300) : null } : s))
  await save(run, { steps })
  const { data: me } = await createAdminClient().from('profiles').select('full_name').eq('id', userId).eq('tenant_id', tenantId).maybeSingle()
  await logActivity(run, until
    ? `⏸ Régua de renovação: "${run.steps[idx].label}" aguardando o cliente até ${brDate(until)} — ${reason.trim().slice(0, 300)} (por ${me?.full_name ?? 'alguém'}). Sem cobrança até lá.`
    : `▶ Régua de renovação: "${run.steps[idx].label}" não está mais aguardando o cliente (por ${me?.full_name ?? 'alguém'}).`)
  return { ok: true }
}

// Aviso ao cliente enviado: conclui o passo "aviso ao cliente" (abre a régua se ainda não abriu)
export async function markClientNoticeStep(contractId: string, opts: { userId?: string | null; periodEnd?: string | null } = {}) {
  const r = await startRenewalRuler(contractId, { userId: opts.userId ?? null, firstDone: false, periodEnd: opts.periodEnd ?? null })
  if (!r.ok) return r
  const run = r.run
  const idx = run.steps.findIndex(s => !s.done_at && s.done_when === 'client_notice')
  if (idx < 0) return { ok: true as const }
  if (openStepIndexes(run.steps).includes(idx)) await completeStepInternal(run, idx, opts.userId ?? null, 'Aviso ao cliente enviado', false, true)
  else {
    // Passo interno anterior ainda aberto: marca o aviso como feito sem pular a ordem dos outros
    const steps = run.steps.map((s, i) => (i === idx ? { ...s, done_at: nowIso(), done_by: opts.userId ?? null, note: 'Aviso ao cliente enviado' } : s))
    await save(run, { steps })
    await logActivity(run, `✅ Régua de renovação: "${run.steps[idx].label}" concluído (aviso enviado).`)
  }
  return { ok: true as const }
}

// Passar um passo fora da ordem ou que não se aplica (digitar "mudar"): fica registrado
export async function skipRulerStep(tenantId: string, runId: string, stepId: string, userId: string, reason: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data } = await createAdminClient().from('renewal_ruler_runs').select('*').eq('id', runId).eq('tenant_id', tenantId).maybeSingle()
  const run = data as RulerRun | null
  if (!run || run.status !== 'active') return { ok: false, error: 'Régua não está em andamento.' }
  const idx = run.steps.findIndex(s => s.id === stepId)
  if (idx < 0 || run.steps[idx].done_at) return { ok: false, error: 'Passo não encontrado ou já concluído.' }
  const pend = (await pendingAreaTasks(run, stepId)).map(t => String(t.metadata?.area_name ?? '')).filter(Boolean)
  if (pend.length) reason = `${reason} (sem concluir: ${pend.join(', ')})`
  if (openStepIndexes(run.steps).includes(idx)) {
    const ok = await completeStepInternal(run, idx, userId, `⚠ Passado fora do processo: ${reason}`, false, true)
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
