// Prazo do chamado por prioridade da empresa (Central de regras → Atendimento). Só servidor.
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveSlaDays, type PriorityTier } from '@/lib/utils/gut-matrix'

export async function getTicketSlaDays(tenantId: string | null | undefined): Promise<Record<PriorityTier, number>> {
  if (!tenantId) return resolveSlaDays(null)
  try {
    const { data } = await createAdminClient().from('organization_settings').select('ticket_sla_days').eq('tenant_id', tenantId).maybeSingle()
    return resolveSlaDays((data as { ticket_sla_days?: unknown } | null)?.ticket_sla_days)
  } catch {
    return resolveSlaDays(null)
  }
}
