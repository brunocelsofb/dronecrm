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
import { getSupportSession, logSupport, SUPPORT_READONLY_MESSAGE } from './support'

// Resposta de gravação recusada (sessão de suporte é só leitura). Encadeável como
// um query builder do Supabase e "await"-ável: devolve { data: null, error }.
function blockedBuilder(onBlocked: () => void): unknown {
  const result = { data: null, error: { message: SUPPORT_READONLY_MESSAGE, code: 'SUPPORT_READONLY' }, count: null, status: 403, statusText: 'Forbidden' }
  let fired = false
  const fire = () => { if (!fired) { fired = true; onBlocked() } }
  const b: unknown = new Proxy(function () {}, {
    get(_t, p) {
      if (p === 'then') return (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => { fire(); return Promise.resolve(result).then(res, rej) }
      return () => b
    },
    apply() { return b },
  })
  return b
}

export const TENANT_TABLES = new Set([
  // Tabelas filhas (empresa herdada do registro pai pelo gatilho set_tenant_from_parent)
  'action_plan_items', 'assistant_action_log', 'automation_rule_triggers', 'contract_contacts', 'contract_custom_field_values', 'contract_emails', 'contract_files', 'contract_tags', 'dimensioning_reviews', 'transfer_requests', 'proposal_status', 'company_tags', 'lead_activities', 'stage_history', 'pipeline_field_configs', 'proposal_approvals', 'proposal_items', 'proposal_content_blocks', 'ticket_messages', 'task_comments', 'implementation_tasks', 'implementation_template_tasks',
  'activities', 'automation_rules', 'billing_records', 'billing_submissions', 'marketing_campaigns', 'marketing_campaign_costs', 'lead_integrations', 'marketing_lists', 'marketing_list_syncs', 'marketing_optouts', 'sdr_conversations', 'renewal_ruler_runs', 'action_plans', 'company_files', 'proposal_catalog_items', 'whatsapp_contact_kind', 'support_access_grants', 'support_access_log', 'dpa_acceptances', 'companies', 'contacts', 'contract_whatsapp_messages', 'storage_legacy_objects', 'retail_products', 'retail_product_variants', 'retail_customers', 'retail_orders', 'retail_order_items', 'retail_loyalty_entries', 'retail_storefronts', 'retail_looks', 'retail_order_messages', 'retail_order_events', 'retail_stock_movements',
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

export function scopeAdminClient(admin: AdminClient, tenantId: string, userId: string | null, readOnly?: (table: string, op: string) => void): AdminClient {
  return new Proxy(admin, {
    get(target, prop, receiver) {
      if (prop === 'from') {
        return (table: string) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const qb = (target as any).from(table)
          if (readOnly) {
            // Sessão de suporte: qualquer gravação (em qualquer tabela) é recusada
            return new Proxy(qb, {
              get(q, p) {
                if (p === 'insert' || p === 'upsert' || p === 'update' || p === 'delete') return () => blockedBuilder(() => readOnly(table, String(p)))
                if (p === 'select' && TENANT_TABLES.has(table)) {
                  return (...args: unknown[]) => (table === 'profiles' && userId ? q.select(...args).or(`tenant_id.eq.${tenantId},id.eq.${userId}`) : q.select(...args).eq('tenant_id', tenantId))
                }
                const v = q[p]
                return typeof v === 'function' ? v.bind(q) : v
              },
            })
          }
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
  const support = await getSupportSession()
  const readOnly = support && support.tenantId === tid
    ? (table: string, op: string) => { void logSupport({ tenantId: tid, grantId: support.grant.id, actorId: support.userId, actorName: support.userName, action: 'write_blocked', detail: `${op} em ${table}` }) }
    : undefined
  return scopeAdminClient(createAdminClient(), tid, userId, readOnly)
}
