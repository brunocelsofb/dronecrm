'use server'
// ─── Tarefas dos agentes (tela IA da empresa, só o admin) ─────────────────────

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createScopedAdmin, scopeAdminClient } from '@/lib/tenant/scoped-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveTenantId } from '@/lib/tenant/context'
import { getSupportSession, SUPPORT_READONLY_MESSAGE } from '@/lib/tenant/support'
import { getTenantFeatures } from '@/lib/config/tenant-features'
import {
  agentTaskDef, isAgentTaskKey, checkParams, checkOptions, isMonthDay, isIsoDate, normDays, MAX_CUSTOM_TASKS, MAX_PROMPT_CHARS, MAX_TITLE_CHARS,
} from '@/lib/agent/agent-tasks'
import { runCustomTask, toCustomTask, paramsUpdate, PARAM_COLUMNS, type ParamSource } from '@/lib/agent/agent-tasks-server'
import { validateRenewalLevels } from '@/lib/agent/renewal-templates'

type Result = { ok: true; id?: string } | { ok: false; error: string }
type Schedule = { enabled: boolean; days: number[]; pausedUntil: string | null }

async function adminGuard(): Promise<{ tenantId: string; userId: string } | { error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }
  const [{ data: me }, tenantId, s] = await Promise.all([
    supabase.from('profiles').select('role').eq('id', user.id).maybeSingle(),
    resolveTenantId(),
    getSupportSession(),
  ])
  if (me?.role !== 'admin') return { error: 'Só o administrador da empresa configura as tarefas.' }
  if (!tenantId) return { error: 'Empresa não identificada.' }
  if (s && s.tenantId === tenantId) return { error: SUPPORT_READONLY_MESSAGE }
  return { tenantId, userId: user.id }
}

function cleanSchedule(s: Schedule): Schedule | { error: string } {
  const days = normDays(s.days)
  if (s.pausedUntil && !isIsoDate(s.pausedUntil)) return { error: 'Data da pausa inválida.' }
  return { enabled: !!s.enabled, days, pausedUntil: s.pausedUntil || null }
}

// Tarefa do sistema: liga/desliga, dias e pausa
export async function saveBuiltinTask(key: string, schedule: Schedule): Promise<Result> {
  const g = await adminGuard()
  if ('error' in g) return { ok: false, error: g.error }
  if (!isAgentTaskKey(key)) return { ok: false, error: 'Tarefa desconhecida.' }
  const s = cleanSchedule(schedule)
  if ('error' in s) return { ok: false, error: s.error }

  // A guarda já conferiu admin e suporte: cliente admin restrito à empresa, sem repetir a sessão
  const db = scopeAdminClient(createAdminClient(), g.tenantId, g.userId)
  const fields = { enabled: s.enabled, days: s.days, paused_until: s.pausedUntil, updated_at: new Date().toISOString() }
  const [tf, { data: row }] = await Promise.all([
    getTenantFeatures(g.tenantId),
    db.from('agent_tasks').select('id').eq('task_key', key).maybeSingle(),
  ])
  if (!tf.features.includes(agentTaskDef(key).feature)) return { ok: false, error: 'A licença não inclui esta tarefa.' }
  const { error } = row
    ? await db.from('agent_tasks').update(fields).eq('id', row.id as string)
    : await db.from('agent_tasks').insert({ ...fields, task_key: key, created_by: g.userId })
  if (error) return { ok: false, error: error.message }

  // O resumo do dia também tem o liga/desliga antigo (Configurações → Agentes IA → Gestor): mantém igual
  if (key === 'briefing') {
    const { data: org } = await db.from('organization_settings').select('copilot_settings').maybeSingle()
    const cs = ((org as { copilot_settings?: Record<string, unknown> } | null)?.copilot_settings ?? {}) as Record<string, unknown>
    if ((cs.briefing_enabled !== false) !== s.enabled) {
      await db.from('organization_settings').update({ copilot_settings: { ...cs, briefing_enabled: s.enabled } }).eq('tenant_id', g.tenantId)
    }
  }
  // Sem revalidatePath: a tela já mostra o novo estado (recarregar a página toda deixava cada clique lento)
  return { ok: true }
}

export type CustomTaskInput = Schedule & { id?: string | null; title: string; prompt: string; recipientPhone?: string | null; monthDay?: number | null }

// Tarefa escrita pelo admin: criar ou alterar
export async function saveCustomTask(input: CustomTaskInput): Promise<Result> {
  const g = await adminGuard()
  if ('error' in g) return { ok: false, error: g.error }
  const title = String(input.title ?? '').trim()
  const prompt = String(input.prompt ?? '').trim()
  if (!title) return { ok: false, error: 'Dê um nome à tarefa.' }
  if (title.length > MAX_TITLE_CHARS) return { ok: false, error: `Nome com até ${MAX_TITLE_CHARS} caracteres.` }
  if (prompt.length < 10) return { ok: false, error: 'Escreva o que a IA deve fazer.' }
  if (prompt.length > MAX_PROMPT_CHARS) return { ok: false, error: `Pedido com até ${MAX_PROMPT_CHARS} caracteres.` }
  const phone = String(input.recipientPhone ?? '').replace(/\D/g, '')
  if (phone && (phone.length < 10 || phone.length > 13)) return { ok: false, error: 'WhatsApp de destino inválido (DDD + número).' }
  const s = cleanSchedule(input)
  if ('error' in s) return { ok: false, error: s.error }
  const monthDay = input.monthDay == null || (input.monthDay as unknown) === '' ? null : Number(input.monthDay)
  if (monthDay !== null && !isMonthDay(monthDay)) return { ok: false, error: 'Dia do mês: de 1 a 28.' }
  if (s.enabled && monthDay === null && !s.days.length) return { ok: false, error: 'Marque pelo menos um dia.' }

  const db = await createScopedAdmin(g.tenantId)
  const fields = {
    title, prompt, recipient_phone: phone || null, month_day: monthDay,
    enabled: s.enabled, days: s.days, paused_until: s.pausedUntil, updated_at: new Date().toISOString(),
  }
  if (input.id) {
    const { error } = await db.from('agent_tasks').update(fields).eq('id', input.id).is('task_key', null)
    if (error) return { ok: false, error: error.message }
    revalidatePath('/ia')
    return { ok: true, id: input.id }
  }
  const { count } = await db.from('agent_tasks').select('id', { count: 'exact', head: true }).is('task_key', null)
  if ((count ?? 0) >= MAX_CUSTOM_TASKS) return { ok: false, error: `Limite de ${MAX_CUSTOM_TASKS} tarefas escritas.` }
  const { data, error } = await db.from('agent_tasks').insert({ ...fields, created_by: g.userId }).select('id').single()
  if (error) return { ok: false, error: error.message }
  revalidatePath('/ia')
  return { ok: true, id: data.id as string }
}

export async function deleteCustomTask(id: string): Promise<Result> {
  const g = await adminGuard()
  if ('error' in g) return { ok: false, error: g.error }
  const db = await createScopedAdmin(g.tenantId)
  const { error } = await db.from('agent_tasks').delete().eq('id', id).is('task_key', null)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/ia')
  return { ok: true }
}

// Testar: roda agora e mostra o resultado na tela, sem enviar (tem custo de IA)
export async function testCustomTask(id: string): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const g = await adminGuard()
  if ('error' in g) return { ok: false, error: g.error }
  const db = await createScopedAdmin(g.tenantId)
  const { data } = await db.from('agent_tasks').select('*').eq('id', id).is('task_key', null).maybeSingle()
  if (!data) return { ok: false, error: 'Tarefa não encontrada. Salve antes de testar.' }
  const r = await runCustomTask(g.tenantId, toCustomTask(data as Record<string, unknown>), { send: false })
  return r.ok && r.text ? { ok: true, text: r.text } : { ok: false, error: r.status }
}

// Prazos da tarefa do sistema (ex.: avisos aos 90/60/30/15 dias), gravados onde a rotina já lê
export async function saveTaskParams(key: string, values: Record<string, unknown>): Promise<Result> {
  const g = await adminGuard()
  if ('error' in g) return { ok: false, error: g.error }
  if (!isAgentTaskKey(key)) return { ok: false, error: 'Tarefa desconhecida.' }
  const def = agentTaskDef(key)
  const c = checkParams(def, values)
  if ('error' in c) return { ok: false, error: c.error }
  if (key === 'renewal_alerts') {
    const v = validateRenewalLevels(c.values)
    if ('error' in v) return { ok: false, error: v.error }
  }
  const db = scopeAdminClient(createAdminClient(), g.tenantId, g.userId)
  const [tf, { data: org }] = await Promise.all([
    getTenantFeatures(g.tenantId),
    db.from('organization_settings').select(PARAM_COLUMNS).maybeSingle(),
  ])
  if (!tf.features.includes(def.feature)) return { ok: false, error: 'A licença não inclui esta tarefa.' }
  const upd = paramsUpdate(key, c.values, org as ParamSource | null)
  if (!upd) return { ok: false, error: 'Esta tarefa não tem prazos editáveis.' }
  const { error } = await db.from('organization_settings').update(upd).eq('tenant_id', g.tenantId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// Destinatários e escolhas da tarefa do sistema (quem faz, quem recebe, o que aparece no resumo)
export async function saveTaskOptions(key: string, raw: Record<string, unknown>): Promise<Result> {
  const g = await adminGuard()
  if ('error' in g) return { ok: false, error: g.error }
  if (!isAgentTaskKey(key)) return { ok: false, error: 'Tarefa desconhecida.' }
  const def = agentTaskDef(key)
  const c = checkOptions(def, raw)
  if ('error' in c) return { ok: false, error: c.error }
  const db = scopeAdminClient(createAdminClient(), g.tenantId, g.userId)
  const [tf, person] = await Promise.all([
    getTenantFeatures(g.tenantId),
    c.options.assignee ? db.from('profiles').select('id').eq('id', c.options.assignee).eq('tenant_id', g.tenantId).maybeSingle() : Promise.resolve({ data: { id: null } }),
  ])
  if (!tf.features.includes(def.feature)) return { ok: false, error: 'A licença não inclui esta tarefa.' }
  if (c.options.assignee && !person.data) return { ok: false, error: 'Pessoa não encontrada nesta empresa.' }

  // Relatório de implantação: o responsável já mora em copilot_settings (Configurações → Agentes IA)
  if (key === 'impl_report') {
    const { data: org } = await db.from('organization_settings').select('copilot_settings').maybeSingle()
    const cs = ((org as { copilot_settings?: Record<string, unknown> } | null)?.copilot_settings ?? {}) as Record<string, unknown>
    const { error } = await db.from('organization_settings').update({ copilot_settings: { ...cs, impl_report_owner_id: c.options.assignee ?? null } }).eq('tenant_id', g.tenantId)
    return error ? { ok: false, error: error.message } : { ok: true }
  }

  const { data: row } = await db.from('agent_tasks').select('id').eq('task_key', key).maybeSingle()
  const now = new Date().toISOString()
  const { error } = row
    ? await db.from('agent_tasks').update({ options: c.options, updated_at: now }).eq('id', row.id as string)
    : await db.from('agent_tasks').insert({ task_key: key, enabled: true, days: def.defaultDays, options: c.options, created_by: g.userId })
  return error ? { ok: false, error: error.message } : { ok: true }
}
