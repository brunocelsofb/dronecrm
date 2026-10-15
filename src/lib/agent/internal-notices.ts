// ─── Copiloto IA — rodadas internas (time Orbis) ─────────────────────────────
// 1. Contrato fechado / renovado → atividade de E-MAIL para o consultor revisar
//    destinatário e cópia e enviar ao time interno (sem valores).
// 2. Implantação:
//    - no ganho: "Acionar time técnico" (iniciar implantação, informações de
//      acompanhamento e tabela de aplicabilidade);
//    - ao iniciar o cronograma: "Acompanhar evolução" (+30 dias) e
//      "Solicitar relatório final" (início + N semanas, padrão 16).
// 3. Relatório mensal consolidado das implantações → atividade para revisar e
//    enviar ao time técnico (sem contrato; tela Copiloto → Relatórios).

import { fmtPct, fmtNum1 } from '@/lib/format'
import { createAdminClient } from '@/lib/supabase/admin'
import { createAgentActivity } from './agent-activity'
import { getContractTenantName } from './tenant-name'
import { renderRenewalTemplate } from './renewal-templates'
import { resolveInternalSettings, type InternalKey } from './internal-settings'
import { resolveTenantId } from '@/lib/tenant/context'

function brDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = String(iso).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.split('-').reverse().join('/') : null
}

function todayBrIso(): string {
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10)
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((new Date(`${toIso}T12:00:00Z`).getTime() - new Date(`${fromIso}T12:00:00Z`).getTime()) / 86_400_000)
}

async function loadSettingsForTenant(tenantId: string) {
  const admin = createAdminClient()
  const { data } = await admin
    .from('organization_settings').select('company_name, copilot_settings, tenant_id').eq('tenant_id', tenantId).maybeSingle()
  return { admin, org: data, settings: resolveInternalSettings(data?.copilot_settings) }
}

async function loadSettings(contractId?: string | null) {
  const admin = createAdminClient()
  const { data } = await admin
    .from('organization_settings').select('company_name, copilot_settings, tenant_id').eq('tenant_id', await resolveTenantId({ contractId })).maybeSingle()
  return { admin, org: data, settings: resolveInternalSettings(data?.copilot_settings) }
}

async function profileLabel(admin: ReturnType<typeof createAdminClient>, id: string | null): Promise<string> {
  if (!id) return '(a definir)'
  const { data } = await admin.from('profiles').select('full_name, job_title').eq('id', id).maybeSingle()
  if (!data?.full_name) return '(a definir)'
  return data.job_title ? `${data.full_name} - ${data.job_title}` : data.full_name
}

// ─── 1. E-mail interno de ganho / renovação ───────────────────────────────────

export async function createInternalNotice(contractId: string, key: InternalKey): Promise<{ ok: boolean; detail?: string }> {
  const { admin, org, settings } = await loadSettings(contractId)
  const { data: c, error } = await admin
    .from('contracts')
    .select('id, process_number, client_name, valid_from, valid_until, owner_id, current_assignee_id')
    .eq('id', contractId)
    .maybeSingle()
  if (error || !c) return { ok: false, detail: error?.message ?? 'contrato não encontrado' }

  const ownerId = (c.owner_id ?? c.current_assignee_id ?? null) as string | null
  const tenantName = await getContractTenantName(admin, contractId)
  const vars = {
    cliente:    c.client_name ?? '',
    contrato:   c.process_number ?? '(sem número)',
    inicio:     brDate(c.valid_from) ?? '(a definir)',
    vencimento: brDate(c.valid_until) ?? '(a definir)',
    consultor:  await profileLabel(admin, ownerId),
    empresa:    tenantName || org?.company_name?.trim() || 'Equipe Comercial',
  }
  const draft = renderRenewalTemplate(settings.templates[key], vars)
  const subject = renderRenewalTemplate(settings.subjects[key], vars)
  const label = key === 'ganho' ? 'fechamento do contrato' : 'renovação do contrato'

  const r = await createAgentActivity(admin, {
    contractId,
    dedupeKey: `internal:${key}:${String(c.valid_until ?? 'sem-vigencia').slice(0, 10)}`,
    dueInDays: 1,
    assignedTo: ownerId,
    activityType: 'email',
    title: `Comunicar ${label} ao time interno — ${c.client_name}`,
    content:
      `[Farmer] E-mail interno pronto para revisão (cliente, número e período — sem valores). ` +
      `Confira destinatários e cópia e clique em "Revisar e enviar".`,
    metadata: {
      kind:          'internal_notice',
      internal_key:  key,
      draft_message: draft,
      draft_subject: subject,
      draft_to:      settings.to,
      draft_cc:      settings.cc,
      approval:      'pending',
    },
  })
  if (r.status === 'error') return { ok: false, detail: r.error }
  return { ok: true, detail: r.status === 'skipped' ? r.reason : undefined }
}

// ─── 2. Implantação ───────────────────────────────────────────────────────────

// No ganho (funil de vendas): consultor aciona o time técnico
export async function createImplementationKickoff(contractId: string): Promise<{ ok: boolean; detail?: string }> {
  const { admin, settings } = await loadSettings(contractId)
  const { data: c } = await admin
    .from('contracts').select('client_name, process_number, owner_id, current_assignee_id').eq('id', contractId).maybeSingle()
  if (!c) return { ok: false, detail: 'contrato não encontrado' }
  const ownerId = (c.owner_id ?? c.current_assignee_id ?? null) as string | null

  const r = await createAgentActivity(admin, {
    contractId,
    dedupeKey: 'impl:kickoff',
    dueInDays: 2,
    assignedTo: ownerId,
    activityType: 'task',
    title: `Acionar time técnico para a implantação — ${c.client_name}`,
    content:
      `[Farmer] Contrato ${c.process_number ?? ''} fechado. Avise o time técnico para:\n` +
      `• iniciar a implantação no CRM (aba Implantação → Iniciar Implantação);\n` +
      `• enviar as informações para o acompanhamento do contrato;\n` +
      `• montar a tabela de aplicabilidade.\n\n` +
      `Prazo médio da implantação: ${settings.implWeeks} semanas. Ao iniciar o cronograma, o Copiloto abre o ` +
      `acompanhamento e o pedido do relatório final.`,
    metadata: { kind: 'impl_kickoff' },
  })
  if (r.status === 'error') return { ok: false, detail: r.error }
  return { ok: true, detail: r.status === 'skipped' ? r.reason : undefined }
}

// Ao iniciar o cronograma: acompanhar a evolução + pedir o relatório final
export async function onImplementationStarted(contractId: string, startDate: string): Promise<void> {
  const { admin, settings } = await loadSettings(contractId)
  const { data: c } = await admin
    .from('contracts').select('client_name, owner_id, current_assignee_id').eq('id', contractId).maybeSingle()
  if (!c) return
  const ownerId = (c.owner_id ?? c.current_assignee_id ?? null) as string | null
  const start = /^\d{4}-\d{2}-\d{2}$/.test(startDate) ? startDate : todayBrIso()
  const today = todayBrIso()

  const finalIso = new Date(new Date(`${start}T12:00:00Z`).getTime() + settings.implWeeks * 7 * 86_400_000).toISOString().slice(0, 10)

  // Kickoff cumprido: encerra a tarefa de acionar o time técnico
  await admin.from('activities')
    .update({ status: 'done', completed: true })
    .eq('contract_id', contractId)
    .eq('metadata->>kind', 'impl_kickoff')
    .neq('status', 'done')

  const r1 = await createAgentActivity(admin, {
    contractId,
    dedupeKey: `impl:follow:${start}`,
    dueInDays: 30,
    assignedTo: ownerId,
    activityType: 'task',
    title: `Acompanhar evolução da implantação — ${c.client_name}`,
    content:
      `[Farmer] Implantação iniciada em ${brDate(start)}. Acompanhe na aba Implantação as fases ` +
      `atualizadas pelo time técnico e alinhe com o cliente o andamento. Previsão de conclusão: ${brDate(finalIso)} ` +
      `(${settings.implWeeks} semanas).`,
    metadata: { kind: 'impl_follow', start_date: start },
  })
  if (r1.status === 'error') console.error('[impl] acompanhamento:', r1.error)

  const r2 = await createAgentActivity(admin, {
    contractId,
    dedupeKey: `impl:final:${start}`,
    dueInDays: Math.max(1, daysBetween(today, finalIso)),
    assignedTo: ownerId,
    activityType: 'task',
    title: `Solicitar relatório final da implantação — ${c.client_name}`,
    content:
      `[Farmer] A implantação iniciada em ${brDate(start)} completa ${settings.implWeeks} semanas em ` +
      `${brDate(finalIso)}. Solicite ao time técnico o relatório final da implantação e registre no contrato.`,
    metadata: { kind: 'impl_final_report', start_date: start, expected_end: finalIso },
  })
  if (r2.status === 'error') console.error('[impl] relatório final:', r2.error)
}

// ─── 3. Relatório mensal consolidado ──────────────────────────────────────────

type ScheduleRow = { id: string; contract_id: string; start_date: string | null; status: string | null; template_id: string | null }
type TaskRow = { schedule_id: string; title: string; start_week: number | null; end_week: number | null; is_completed: boolean | null; sort_order: number | null }

export async function buildImplementationReportText(tenantId: string): Promise<{ text: string; count: number }> {
  const { admin, org, settings } = await loadSettingsForTenant(tenantId)
  const { data: schedules } = await admin
    .from('implementation_schedules')
    .select('id, contract_id, start_date, status, template_id')
    .eq('tenant_id', tenantId)
    .order('start_date', { ascending: true })
  const all = (schedules ?? []) as ScheduleRow[]

  // Só o cronograma mais recente de cada contrato
  const latest = new Map<string, ScheduleRow>()
  for (const s of all) latest.set(s.contract_id, s)
  const list = [...latest.values()]

  const ids = list.map(s => s.id)
  const contractIds = list.map(s => s.contract_id)
  const [{ data: tasks }, { data: contracts }, { data: templates }] = await Promise.all([
    ids.length ? admin.from('implementation_tasks').select('schedule_id, title, start_week, end_week, is_completed, sort_order').in('schedule_id', ids) : Promise.resolve({ data: [] }),
    contractIds.length ? admin.from('contracts').select('id, client_name, process_number').in('id', contractIds) : Promise.resolve({ data: [] }),
    admin.from('implementation_templates').select('id, name').eq('tenant_id', tenantId),
  ])
  const cById = new Map(((contracts ?? []) as { id: string; client_name: string; process_number: string | null }[]).map(c => [c.id, c]))
  const tplById = new Map(((templates ?? []) as { id: string; name: string }[]).map(t => [t.id, t.name]))
  const tasksBySchedule = new Map<string, TaskRow[]>()
  for (const t of (tasks ?? []) as TaskRow[]) {
    const arr = tasksBySchedule.get(t.schedule_id) ?? []
    arr.push(t)
    tasksBySchedule.set(t.schedule_id, arr)
  }

  const today = todayBrIso()
  const mes = new Date(`${today}T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const blocks: { done: boolean; text: string }[] = []

  for (const s of list) {
    const c = cById.get(s.contract_id)
    if (!c) continue
    const ts = (tasksBySchedule.get(s.id) ?? []).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    if (ts.length === 0) continue
    const total = ts.length
    const doneCount = ts.filter(t => t.is_completed).length
    const pct = (doneCount / total) * 100
    const week = s.start_date ? Math.max(1, Math.floor(daysBetween(s.start_date.slice(0, 10), today) / 7) + 1) : null
    const lastWeek = Math.max(...ts.map(t => t.end_week ?? 0), settings.implWeeks)
    const late = week ? ts.filter(t => !t.is_completed && (t.end_week ?? 0) < week) : []
    const current = week ? ts.filter(t => !t.is_completed && (t.start_week ?? 0) <= week && (t.end_week ?? 0) >= week) : []
    const next = ts.filter(t => !t.is_completed && !late.includes(t) && !current.includes(t)).slice(0, 2)
    const finished = doneCount === total

    const lines = [
      `*${c.client_name}*${c.process_number ? ` (${c.process_number})` : ''}${s.template_id && tplById.get(s.template_id) ? ` — ${tplById.get(s.template_id)}` : ''}`,
      `Início: ${brDate(s.start_date) ?? '—'} · ${week ? `semana ${week} de ${lastWeek}` : 'sem data de início'} · ${doneCount}/${total} fases concluídas (${fmtPct(pct)})`,
    ]
    if (finished) lines.push('✅ Todas as fases concluídas — aguardando relatório final.')
    else {
      if (late.length) lines.push(`⚠️ Em atraso: ${late.map(t => `${t.title} (até sem. ${t.end_week})`).join('; ')}`)
      if (current.length) lines.push(`▶ Em andamento: ${current.map(t => t.title).join('; ')}`)
      if (next.length) lines.push(`⏭ Próximas: ${next.map(t => `${t.title} (sem. ${t.start_week})`).join('; ')}`)
    }
    blocks.push({ done: finished, text: lines.join('\n') })
  }

  const inProgress = blocks.filter(b => !b.done)
  const finishedBlocks = blocks.filter(b => b.done)
  const header =
    `Olá, equipe!\n\nSegue o consolidado das implantações — ${mes}.\n` +
    `${inProgress.length} em andamento · ${finishedBlocks.length} com todas as fases concluídas.\n`
  const body = blocks.length === 0
    ? '\nNenhuma implantação com cronograma no CRM neste momento.\n'
    : [
        inProgress.length ? `\n*EM ANDAMENTO*\n\n${inProgress.map(b => b.text).join('\n\n')}` : '',
        finishedBlocks.length ? `\n\n*FASES CONCLUÍDAS*\n\n${finishedBlocks.map(b => b.text).join('\n\n')}` : '',
      ].join('')
  const cs = (org?.copilot_settings ?? {}) as Record<string, unknown>
  const signature = typeof cs.report_signature === 'string' && cs.report_signature.trim()
    ? cs.report_signature.trim()
    : `Equipe ${org?.company_name ?? ''}`.trim() + '.'
  const footer = `\n\nPedimos que mantenham as fases atualizadas no CRM (aba Implantação de cada contrato).\n\nAtenciosamente,\n${signature}`
  return { text: header + body + footer, count: blocks.length }
}

// Cria (1x por mês) a atividade do relatório mensal para revisão.
// force = true: gera agora, mesmo fora do dia configurado.
export async function createMonthlyImplementationReport(tenantId: string, force = false): Promise<{ status: string; id?: string; detail?: string }> {
  const { admin, org, settings } = await loadSettingsForTenant(tenantId)
  const today = todayBrIso()
  const day = Number(today.slice(8, 10))
  if (!force && day < settings.implReportDay) return { status: 'skipped', detail: `dia ${settings.implReportDay} ainda não chegou` }

  const month = today.slice(0, 7)
  const dedupeKey = `impl_report:${month}`
  const { data: existing } = await admin
    .from('activities').select('id, status').eq('metadata->>dedupe_key', dedupeKey).eq('tenant_id', tenantId).limit(1)
  if (existing && existing.length > 0 && !force) return { status: 'skipped', detail: 'relatório do mês já criado' }
  if (existing && existing.length > 0 && force && existing[0].status !== 'done') {
    return { status: 'skipped', id: existing[0].id, detail: 'já existe relatório deste mês aguardando envio' }
  }

  // Responsável: configurado; senão o primeiro admin
  let ownerId = settings.implReportOwnerId
  if (!ownerId) {
    const { data: admins } = await admin.from('profiles').select('id').eq('role', 'admin').eq('tenant_id', org?.tenant_id ?? '').limit(1)
    ownerId = admins?.[0]?.id ?? null
  }
  if (!org) return { status: 'error', detail: 'empresa sem configurações' }

  const { text, count } = await buildImplementationReportText(tenantId)
  const mes = new Date(`${today}T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })

  const { data, error } = await admin.from('activities').insert({
    contract_id:   null,
    tenant_id:     tenantId,
    user_id:       null,
    assigned_to:   ownerId,
    type:          'task',
    activity_type: 'email',
    title:         `Farmer · Enviar relatório mensal de implantação — ${mes}`,
    content:       `[Farmer] Consolidado de ${count} implantação(ões) pronto para revisar e enviar ao time técnico.`,
    status:        'planned',
    completed:     false,
    activity_date: today,
    metadata: {
      source:        'copiloto_ia',
      agent:         'farmer',
      auto_created:  true,
      dedupe_key:    dedupeKey + (force && existing?.length ? `:${Date.now()}` : ''),
      kind:          'internal_impl_report',
      draft_message: text,
      draft_subject: `[Implantações] Relatório consolidado — ${mes}`,
      draft_to:      settings.techTeamEmails,
      draft_cc:      settings.cc,
      approval:      'pending',
    },
  }).select('id').single()
  if (error || !data) return { status: 'error', detail: error?.message }

  if (ownerId) {
    await admin.from('notifications').insert({
      user_id:   ownerId,
      tenant_id: tenantId,
      message:   `📊 Relatório mensal de implantação (${mes}) pronto para revisar e enviar ao time técnico.`,
      read:      false,
    })
  }
  return { status: 'created', id: data.id }
}
