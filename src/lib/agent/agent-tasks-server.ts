// ─── Tarefas dos agentes: leitura das regras da empresa e execução ───────────
// Só servidor/cron (sem 'use server': não vira ação chamável pelo navegador).
// Rotinas da plataforma: filtram tenant_id explicitamente ou usam o cliente já
// restrito à empresa (scopeAdminClient).

import { createAdminClient } from '@/lib/supabase/admin'
import { scopeAdminClient } from '@/lib/tenant/scoped-admin'
import { loadTheoTenantAi, monthUsage } from '@/lib/ai/theo-server'
import { runTheo } from '@/lib/ai/theo-engine'
import { runTheoRead } from '@/lib/ai/theo-tools'
import { estimateCostUsd, theoSystemPrompt } from '@/lib/ai/theo-catalog'
import { resolveRenewalLevels } from './renewal-templates'
import { resolveInternalSettings } from './internal-settings'
import { resolveRulerSettings } from './renewal-ruler'
import { resolveCompanySettings } from '@/lib/companies/settings'
import {
  customTaskMessage, customRunsOn, isMonthDay, normDays, runsOn, SCHEDULED_TASK_RULES, taskState, todayBrIso, isIsoDate,
  MAX_CUSTOM_TASKS, type AgentTaskKey,
} from './agent-tasks'

// A rotina do sistema roda hoje nesta empresa? (liga/desliga, dias, pausa)
// Erro ao ler a regra: roda como antes (não deixa de avisar por falha de leitura).
export async function taskRunsToday(tenantId: string, key: AgentTaskKey, today = todayBrIso()): Promise<boolean> {
  try {
    const { data, error } = await createAdminClient().from('agent_tasks')
      .select('enabled, days, paused_until').eq('tenant_id', tenantId).eq('task_key', key).maybeSingle()
    if (error) return runsOn(taskState(key, null), today)
    return runsOn(taskState(key, data), today)
  } catch {
    return runsOn(taskState(key, null), today)
  }
}

export type CustomTask = {
  id: string; title: string; prompt: string; recipient_phone: string | null; month_day: number | null
  enabled: boolean; days: number[]; paused_until: string | null
  last_run_at: string | null; last_status: string | null; created_by: string | null
}

export function toCustomTask(r: Record<string, unknown>): CustomTask {
  return {
    id: String(r.id), title: String(r.title ?? ''), prompt: String(r.prompt ?? ''),
    recipient_phone: (r.recipient_phone as string | null) ?? null,
    month_day: isMonthDay(r.month_day) ? r.month_day : null,
    enabled: r.enabled !== false, days: normDays(r.days),
    paused_until: isIsoDate(r.paused_until) ? r.paused_until : null,
    last_run_at: (r.last_run_at as string | null) ?? null, last_status: (r.last_status as string | null) ?? null,
    created_by: (r.created_by as string | null) ?? null,
  }
}

// Roda uma tarefa escrita pelo admin com a IA do Théo da empresa (só consultas).
// send=false: só devolve o texto (botão "Testar").
export async function runCustomTask(tenantId: string, task: CustomTask, opts: { send: boolean }): Promise<{ ok: boolean; text?: string; status: string }> {
  const ai = await loadTheoTenantAi(tenantId)
  if (!ai.provider || !ai.key || !ai.model) return { ok: false, status: 'Théo desligado: ligue a IA em Configurações → Assistente Théo.' }
  if (!ai.readTools.length) return { ok: false, status: 'A licença não inclui consultas do Théo.' }
  const usage = await monthUsage(tenantId)
  if (usage.total >= ai.budgetUsd) return { ok: false, status: 'Orçamento do mês do Théo atingido.' }

  const db = scopeAdminClient(createAdminClient(), tenantId, null)
  const r = await runTheo({
    provider: ai.provider, model: ai.model, key: ai.key,
    system: `${theoSystemPrompt(ai.companyName)}\n${SCHEDULED_TASK_RULES}`,
    history: [{ role: 'user', text: task.prompt }],
    tools: ai.readTools,
    read: (name, input) => runTheoRead(name, input, { db, userId: null }),
  })
  if (r.tokensIn || r.tokensOut) {
    await db.from('assistant_usage_log').insert({
      user_id: task.created_by, input_tokens: r.tokensIn, output_tokens: r.tokensOut,
      provider: ai.provider, model: ai.model, cost_usd: estimateCostUsd(ai.provider, ai.model, r.tokensIn, r.tokensOut),
    })
  }
  if (r.error) return { ok: false, status: r.error }
  const text = (r.text ?? '').trim()
  if (!text) return { ok: false, status: 'A IA não devolveu resposta.' }
  if (!opts.send) return { ok: true, text, status: 'teste' }

  const { sendWhatsApp } = await import('./briefing-core')
  const w = await sendWhatsApp(customTaskMessage(task.title, text), tenantId, task.recipient_phone)
  return w.sent ? { ok: true, text, status: 'enviado' } : { ok: false, text, status: `WhatsApp não enviado: ${w.error ?? ''}`.trim() }
}

// Rodada diária (cron): tarefas ligadas, do dia, não pausadas e que ainda não rodaram hoje
export async function runCustomTasksForTenant(tenantId: string, opts: { force?: boolean } = {}) {
  const today = todayBrIso()
  const admin = createAdminClient()
  const { data, error } = await admin.from('agent_tasks').select('*').eq('tenant_id', tenantId).is('task_key', null).order('created_at').limit(MAX_CUSTOM_TASKS)
  if (error) return { error: error.message }
  const out: { id: string; status: string }[] = []
  for (const row of data ?? []) {
    const t = toCustomTask(row as Record<string, unknown>)
    const lastBr = t.last_run_at ? todayBrIso(new Date(t.last_run_at).getTime()) : null
    if (!opts.force && (!customRunsOn({ enabled: t.enabled, days: t.days, pausedUntil: t.paused_until, monthDay: t.month_day }, today) || lastBr === today)) continue
    // Marca antes: se cair no meio, não repete no mesmo dia
    await admin.from('agent_tasks').update({ last_run_at: new Date().toISOString(), last_status: 'rodando' }).eq('id', t.id).eq('tenant_id', tenantId)
    let status: string
    try {
      status = (await runCustomTask(tenantId, t, { send: true })).status
    } catch (e) {
      status = `erro: ${e instanceof Error ? e.message : String(e)}`
    }
    await admin.from('agent_tasks').update({ last_status: status.slice(0, 300) }).eq('id', t.id).eq('tenant_id', tenantId)
    out.push({ id: t.id, status })
  }
  return { ran: out.length, tasks: out }
}

// Prazos editáveis de cada tarefa, lidos de onde cada rotina já lê (uma fonte só):
//   renewal_alerts  → copilot_settings.renewal_levels
//   measurement_alerts → organization_settings.measurement_due_day
//   impl_report     → copilot_settings.impl_report_day
//   ruler_overdue   → copilot_settings.renewal_ruler.overdue_repeat_days
//   inactive_hunter → company_settings.inactive_months
export type ParamSource = { copilot_settings?: unknown; measurement_due_day?: unknown; company_settings?: unknown }
export const PARAM_COLUMNS = 'copilot_settings, measurement_due_day, company_settings'

export function readTaskParams(org: ParamSource | null): Record<string, Record<string, number>> {
  const cs = org?.copilot_settings ?? {}
  const L = resolveRenewalLevels((cs as { renewal_levels?: unknown }).renewal_levels)
  const due = Number(org?.measurement_due_day ?? 5)
  return {
    renewal_alerts: { ...L },
    measurement_alerts: { due_day: Number.isInteger(due) && due >= 1 && due <= 28 ? due : 5 },
    impl_report: { report_day: resolveInternalSettings(cs).implReportDay },
    ruler_overdue: { repeat_days: resolveRulerSettings(cs).overdue_repeat_days },
    inactive_hunter: { inactive_months: resolveCompanySettings(org?.company_settings).inactive_months },
  }
}

// Monta a atualização de organization_settings para os prazos de uma tarefa
export function paramsUpdate(key: AgentTaskKey, v: Record<string, number>, org: ParamSource | null): Record<string, unknown> | null {
  const cs = { ...((org?.copilot_settings ?? {}) as Record<string, unknown>) }
  switch (key) {
    case 'renewal_alerts': return { copilot_settings: { ...cs, renewal_levels: { prep: v.prep, a1: v.a1, a2: v.a2, a3: v.a3 } } }
    case 'measurement_alerts': return { measurement_due_day: v.due_day }
    case 'impl_report': return { copilot_settings: { ...cs, impl_report_day: v.report_day } }
    case 'ruler_overdue': {
      const ruler = { ...((cs.renewal_ruler ?? {}) as Record<string, unknown>), overdue_repeat_days: v.repeat_days }
      return { copilot_settings: { ...cs, renewal_ruler: ruler } }
    }
    case 'inactive_hunter': return { company_settings: { ...((org?.company_settings ?? {}) as Record<string, unknown>), inactive_months: v.inactive_months } }
    default: return null
  }
}
