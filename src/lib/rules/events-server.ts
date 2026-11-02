// Liga/desliga das ações de evento por empresa. Só servidor.
// Sem linha ou erro de leitura = ligada (comportamento de antes).
import { createAdminClient } from '@/lib/supabase/admin'
import { eventTaskKey, type EventKey } from './events'

export async function eventOn(tenantId: string | null | undefined, key: EventKey): Promise<boolean> {
  if (!tenantId) return true
  try {
    const { data, error } = await createAdminClient().from('agent_tasks').select('enabled')
      .eq('tenant_id', tenantId).eq('task_key', eventTaskKey(key)).maybeSingle()
    if (error || !data) return true
    return (data as { enabled?: boolean }).enabled !== false
  } catch {
    return true
  }
}
