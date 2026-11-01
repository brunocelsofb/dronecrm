// Escolhas de cada tarefa do sistema (destinatários, seções do resumo), por empresa.
// Só servidor. Rotinas da plataforma: filtra tenant_id explicitamente.
// Sem linha ou erro de leitura = padrão (igual a antes).
import { createAdminClient } from '@/lib/supabase/admin'
import { readOptions, type AgentTaskKey, type TaskOptions } from './agent-tasks'

export async function loadTaskOptions(tenantId: string, key: AgentTaskKey): Promise<TaskOptions> {
  try {
    const { data } = await createAdminClient().from('agent_tasks').select('options')
      .eq('tenant_id', tenantId).eq('task_key', key).maybeSingle()
    return readOptions((data as { options?: unknown } | null)?.options)
  } catch {
    return {}
  }
}
