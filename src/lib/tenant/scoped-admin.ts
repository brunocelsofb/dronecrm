// ─── Cliente "admin" preso à empresa ──────────────────────────────────────────
// O cliente admin (service role) ignora o RLS do banco. Em telas e ações de
// usuário isso fazia uma empresa enxergar dados de outra. Este cliente continua
// com poderes de admin, mas em toda tabela que tem tenant_id:
//   - select / update / delete → filtra .eq('tenant_id', empresa)
//   - insert / upsert          → grava tenant_id da empresa
//   - profiles                 → empresa OU o próprio usuário (Super Admin em "Acessar")
// Rotinas da plataforma (Super Admin, webhooks, crons) seguem com createAdminClient.

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { resolveTenantId } from './context'

export const TENANT_TABLES = new Set([
  // Tabelas filhas (empresa herdada do registro pai pelo gatilho set_tenant_from_parent)
  'action_plan_items', 'assistant_action_log', 'automation_rule_triggers', 'contract_contacts', 'contract_custom_field_values', 'contract_emails', 'contract_files', 'contract_tags', 'dimensioning_reviews', 'transfer_requests', 'proposal_status', 'company_tags', 'lead_activities', 'stage_history', 'pipeline_field_configs', 'proposal_approvals', 'proposal_items', 'proposal_content_blocks', 'ticket_messages', 'task_comments', 'implementation_tasks', 'implementation_template_tasks',
  'activities', 'automation_rules', 'billing_records', 'billing_submissions', 'marketing_campaigns', 'marketing_campaign_costs', 'lead_integrations', 'marketing_lists', 'marketing_list_syncs', 'marketing_optouts', 'sdr_conversations', 'proposal_catalog_items', 'companies', 'contacts', 'contract_whatsapp_messages',
  'contract_ai_readings', 'contract_measurements', 'contract_renewals', 'contracts', 'custom_fields', 'custom_surveys', 'email_accounts', 'email_templates', 'implementation_schedules',
  'implementation_templates', 'lead_routing_rules', 'leads', 'lost_reasons', 'monthly_goals', 'notifications',
  'nps_surveys', 'organization_settings', 'pipeline_runs', 'pipelines', 'profiles', 'proposals', 'stages', 'tags',
  'tickets', 'whatsapp_capture_prompts', 'whatsapp_conversation_assignments', 'whatsapp_conversation_status',
  'whatsapp_protocol_counters', 'zapsign_documents', 'zapsign_templates',
])

type AdminClient = ReturnType<typeof createAdminClient>

function withTenant(rows: unknown, tenantId: string): unknown {
  if (Array.isArray(rows)) return rows.map(r => (r && typeof r === 'object' && !('tenant_id' in r) ? { ...r, tenant_id: tenantId } : r))
  if (rows && typeof rows === 'object' && !('tenant_id' in (rows as object))) return { ...(rows as object), tenant_id: tenantId }
  return rows
}

export function scopeAdminClient(admin: AdminClient, tenantId: string, userId: string | null): AdminClient {
  return new Proxy(admin, {
    get(target, prop, receiver) {
      if (prop === 'from') {
        return (table: string) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const qb = (target as any).from(table)
          if (!TENANT_TABLES.has(table)) return qb
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const scope = (b: any) => table === 'profiles' && userId
            ? b.or(`tenant_id.eq.${tenantId},id.eq.${userId}`)
            : b.eq('tenant_id', tenantId)
          return new Proxy(qb, {
            get(q, p) {
              if (p === 'select' || p === 'update' || p === 'delete') {
                return (...args: unknown[]) => scope(q[p](...args))
              }
              if (p === 'insert' || p === 'upsert') {
                return (rows: unknown, opts?: unknown) => q[p](withTenant(rows, tenantId), opts)
              }
              const v = q[p]
              return typeof v === 'function' ? v.bind(q) : v
            },
          })
        }
      }
      const v = Reflect.get(target, prop, receiver)
      return typeof v === 'function' ? v.bind(target) : v
    },
  }) as AdminClient
}

// Cliente admin da empresa atual (usuário logado / Super Admin em "Acessar")
export async function createScopedAdmin(tenantId?: string | null): Promise<AdminClient> {
  const tid = tenantId ?? await resolveTenantId()
  let userId: string | null = null
  try {
    const { data: { user } } = await (await createClient()).auth.getUser()
    userId = user?.id ?? null
  } catch { userId = null }
  return scopeAdminClient(createAdminClient(), tid, userId)
}
