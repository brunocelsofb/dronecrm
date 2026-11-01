// Monta a visão das tarefas dos agentes para a tela (Central de regras). Só servidor.
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { AGENT_TASKS, readOptions, taskState, type AgentTaskKey, type TaskRow } from './agent-tasks'
import { getManagerChannel } from './briefing-core'
import { resolveInternalSettings } from './internal-settings'
import { toCustomTask, readTaskParams, PARAM_COLUMNS, type ParamSource } from './agent-tasks-server'
import type { BuiltinView, CustomView, Person } from '@/components/ia/agent-tasks-panel'

export async function loadTasksView(tenantId: string, features: string[]): Promise<{
  builtins: BuiltinView[]; customs: CustomView[]; team: Person[]; managerPhone: string; managerEmail: string
}> {
  const db = await createScopedAdmin(tenantId)
  const [{ data: taskRows }, { data: orgParams }, { data: people }, manager] = await Promise.all([
    db.from('agent_tasks').select('*').order('created_at'),
    db.from('organization_settings').select(PARAM_COLUMNS).maybeSingle(),
    db.from('profiles').select('id, full_name').order('full_name'),
    getManagerChannel(tenantId).catch(() => ({ number: null, email: null })),
  ])
  const team = ((people ?? []) as { id: string; full_name: string | null }[])
    .filter(p => p.full_name).map(p => ({ id: p.id, name: p.full_name as string }))
  const implOwner = resolveInternalSettings((orgParams as ParamSource | null)?.copilot_settings ?? {}).implReportOwnerId ?? ''
  const paramValues = readTaskParams(orgParams as ParamSource | null)
  const rows = (taskRows ?? []) as Record<string, unknown>[]
  const builtins: BuiltinView[] = AGENT_TASKS.filter(t => features.includes(t.feature)).map(t => ({
    key: t.key, agent: t.agent, title: t.title, description: t.description, sends: t.sends,
    params: t.params ?? [], values: paramValues[t.key] ?? {},
    state: taskState(t.key as AgentTaskKey, (rows.find(r => r.task_key === t.key) ?? null) as TaskRow | null),
    recipients: t.recipients ?? [], assigneeDefault: t.assigneeDefault ?? '', recipientsNote: t.recipientsNote ?? '', monthly: !!t.monthly,
    options: t.key === 'impl_report' ? { assignee: implOwner || null } : readOptions(rows.find(r => r.task_key === t.key)?.options),
  }))
  const customs: CustomView[] = rows.filter(r => !r.task_key).map(r => {
    const c = toCustomTask(r)
    return { id: c.id, title: c.title, prompt: c.prompt, recipientPhone: c.recipient_phone ?? '', monthDay: c.month_day, enabled: c.enabled, days: c.days, pausedUntil: c.paused_until, lastRunAt: c.last_run_at, lastStatus: c.last_status }
  })
  return { builtins, customs, team, managerPhone: manager.number ?? '', managerEmail: manager.email ?? '' }
}
