// ─── Resetar o CRM de uma empresa ─────────────────────────────────────────────
// Apaga dados, funis, WhatsApp (inclusive no servidor), Copiloto e configurações.
// Mantém: usuários (logins e Gmail conectado), licença, plano e abas.
// Depois recria o funil básico — a empresa volta como licença nova.

import * as XLSX from 'xlsx'
import { createAdminClient } from '@/lib/supabase/admin'
import { seedTenantDefaults } from './seed'

// Ordem respeita as referências entre tabelas (filhas antes das mães)
const RESET_TABLES = [
  'activities', 'notifications', 'contract_whatsapp_messages', 'whatsapp_conversation_status',
  'whatsapp_conversation_assignments', 'whatsapp_capture_prompts', 'whatsapp_protocol_counters',
  'nps_surveys', 'custom_surveys', 'zapsign_documents', 'billing_records', 'implementation_schedules',
  'proposals', 'tickets', 'automation_rules', 'lead_routing_rules', 'leads', 'pipeline_runs', 'contracts',
  'contacts', 'companies', 'stages', 'pipelines', 'lost_reasons', 'tags', 'custom_fields', 'email_templates',
  'implementation_templates', 'zapsign_templates', 'monthly_goals',
] as const

// Tabelas que vão na cópia (planilha) — inclui as filhas sem tenant_id via contrato
const EXPORT_TABLES = [
  'companies', 'contacts', 'contracts', 'pipelines', 'stages', 'pipeline_runs', 'activities', 'leads',
  'proposals', 'tickets', 'contract_whatsapp_messages', 'nps_surveys', 'custom_surveys', 'billing_records',
  'implementation_schedules', 'tags', 'lost_reasons', 'custom_fields', 'email_templates', 'automation_rules',
] as const

// Nunca exportar segredos
const SECRET_COLUMNS = new Set(['anthropic_api_key_enc', 'evo_api_key', 'evo_instance_token', 'zapi_token', 'zapi_client_token',
  'zapi_webhook_secret', 'zapsign_api_token', 'mailgun_webhook_signing_key', 'smtp_password', 'access_token', 'refresh_token'])

function clean(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map(r => {
    const o: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(r)) {
      if (SECRET_COLUMNS.has(k)) continue
      o[k] = v !== null && typeof v === 'object' ? JSON.stringify(v) : v
    }
    return o
  })
}

async function fetchAll(table: string, tenantId: string): Promise<Record<string, unknown>[]> {
  const admin = createAdminClient()
  const out: Record<string, unknown>[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from(table).select('*').eq('tenant_id', tenantId).range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...((data ?? []) as Record<string, unknown>[]))
    if (!data || data.length < 1000) break
  }
  return out
}

// Cópia completa em planilha (uma aba por tabela)
export async function buildTenantExport(tenantId: string): Promise<Buffer> {
  const wb = XLSX.utils.book_new()
  const admin = createAdminClient()
  const { data: org } = await admin.from('organization_settings').select('*').eq('tenant_id', tenantId).maybeSingle()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(clean(org ? [org as Record<string, unknown>] : [])), 'configuracoes')
  for (const t of EXPORT_TABLES) {
    const rows = clean(await fetchAll(t, tenantId))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ vazio: '' }]), t.slice(0, 31))
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

export async function resetTenantData(tenantId: string): Promise<{ counts: Record<string, number>; whatsapp: string[] }> {
  const admin = createAdminClient()
  const { data: tenant } = await admin.from('tenants').select('name').eq('id', tenantId).maybeSingle()
  if (!tenant) throw new Error('Empresa não encontrada.')

  // 1. WhatsApp: remove as instâncias da empresa no servidor
  const removed: string[] = []
  try {
    const { getTenantEvoCreds, getTenantInstanceNames } = await import('@/lib/whatsapp/tenant-evo')
    const [creds, names] = await Promise.all([getTenantEvoCreds(tenantId), getTenantInstanceNames(tenantId)])
    if (creds) {
      for (const name of names) {
        const res = await fetch(`${creds.serverUrl}/instance/delete/${encodeURIComponent(name)}`, {
          method: 'DELETE', headers: { apikey: creds.apiKey },
        }).catch(() => null)
        if (res?.ok) removed.push(name)
      }
    }
  } catch (e) {
    console.error('[reset] instâncias de WhatsApp:', e)
  }

  // 2. Referências circulares
  await admin.from('pipeline_runs').update({ previous_run_id: null }).eq('tenant_id', tenantId).not('previous_run_id', 'is', null)
  await admin.from('pipelines').update({ won_target_pipeline_id: null, won_target_stage_id: null, renewal_target_stage_id: null }).eq('tenant_id', tenantId)

  // 3. Dados
  const counts: Record<string, number> = {}
  for (const t of RESET_TABLES) {
    const { error, count } = await admin.from(t).delete({ count: 'exact' }).eq('tenant_id', tenantId)
    if (error) throw new Error(`Falha ao apagar ${t}: ${error.message}`)
    counts[t] = count ?? 0
  }

  // 4. Configurações (inclui Copiloto, chave da IA, textos, logo): volta ao padrão, mantendo o id da linha
  const { data: org } = await admin.from('organization_settings').select('id').eq('tenant_id', tenantId).maybeSingle()
  const keepId = (org?.id as string | undefined) ?? tenantId
  await admin.from('organization_settings').delete().eq('tenant_id', tenantId)
  const { error: insErr } = await admin.from('organization_settings')
    .insert({ id: keepId, tenant_id: tenantId, name: tenant.name, company_name: tenant.name })
  if (insErr) throw new Error(`Falha ao recriar configurações: ${insErr.message}`)

  await admin.from('profiles').update({ impersonating_tenant_id: null }).eq('impersonating_tenant_id', tenantId)

  // 5. Licença nova: funil básico
  await seedTenantDefaults(tenantId)
  return { counts, whatsapp: removed }
}
