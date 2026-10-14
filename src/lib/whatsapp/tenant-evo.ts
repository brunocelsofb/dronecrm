// ─── WhatsApp por empresa no servidor compartilhado ───────────────────────────
// O servidor Evolution (Railway) é da plataforma (EVOLUTION_API_URL / _KEY no
// Vercel). Cada empresa cria as próprias instâncias nele; a dona de cada
// instância é a empresa que a tem em evo_instance_aliases (ou evo_instance_name).
// Empresa com servidor próprio (exceção) preenche evo_server_url/evo_api_key.
//
// Regras:
//   - empresa só vê/mexe nas próprias instâncias;
//   - instância nova de empresa nova ganha o prefixo do slug (evita nome repetido
//     no servidor compartilhado) e é registrada na hora como dela;
//   - limite de números por plano (plan_features.max_whatsapp, ou ajuste no cliente).

import { createAdminClient } from '@/lib/supabase/admin'
import { getDefaultTenantId } from '@/lib/tenant/context'

export type EvoServerCreds = { serverUrl: string; apiKey: string }

function platformCreds(): EvoServerCreds | null {
  const url = process.env.EVOLUTION_API_URL?.trim().replace(/\/$/, '')
  const key = process.env.EVOLUTION_API_KEY?.trim()
  return url && key ? { serverUrl: url, apiKey: key } : null
}

export async function getTenantEvoCreds(tenantId: string): Promise<EvoServerCreds | null> {
  const { data } = await createAdminClient()
    .from('organization_settings').select('evo_server_url, evo_api_key').eq('tenant_id', tenantId).maybeSingle()
  if (data?.evo_server_url && data?.evo_api_key) {
    return { serverUrl: String(data.evo_server_url).trim().replace(/\/$/, ''), apiKey: String(data.evo_api_key).trim() }
  }
  return platformCreds()
}

// Nomes de instância por empresa
export async function getInstanceOwnership(): Promise<Map<string, string>> {
  const { data } = await createAdminClient()
    .from('organization_settings').select('tenant_id, evo_instance_name, evo_instance_aliases')
  const owner = new Map<string, string>()
  for (const r of data ?? []) {
    const tid = r.tenant_id as string
    if (r.evo_instance_name) owner.set(String(r.evo_instance_name), tid)
    for (const name of Object.keys((r.evo_instance_aliases ?? {}) as Record<string, unknown>)) owner.set(name, tid)
  }
  return owner
}

export async function getTenantInstanceNames(tenantId: string): Promise<string[]> {
  const owner = await getInstanceOwnership()
  return [...owner.entries()].filter(([, t]) => t === tenantId).map(([n]) => n)
}

// A empresa pode mexer nessa instância?
// Empresa padrão (Orbis, legado): tudo que não for de outra empresa.
export async function canTenantUseInstance(tenantId: string, instanceName: string): Promise<boolean> {
  const owner = await getInstanceOwnership()
  const o = owner.get(instanceName)
  if (o) return o === tenantId
  return tenantId === (await getDefaultTenantId())
}

// Filtra a lista do servidor para a empresa
export async function filterInstancesForTenant<T>(tenantId: string, list: T[], nameOf: (x: T) => string | undefined): Promise<T[]> {
  const owner = await getInstanceOwnership()
  const isDefault = tenantId === (await getDefaultTenantId())
  return list.filter(x => {
    const n = nameOf(x)
    if (!n) return false
    const o = owner.get(n)
    return o ? o === tenantId : isDefault
  })
}

export async function getWhatsAppLimit(tenantId: string): Promise<number> {
  const admin = createAdminClient()
  const { data: t } = await admin.from('tenants').select('plan, trial_ends_at, max_whatsapp_override').eq('id', tenantId).maybeSingle()
  if (t?.max_whatsapp_override != null) return Number(t.max_whatsapp_override)
  const plan = t?.trial_ends_at && new Date(t.trial_ends_at) > new Date() ? 'enterprise' : (t?.plan ?? 'starter')
  const { data: pf } = await admin.from('plan_features').select('max_whatsapp').eq('plan', plan).maybeSingle()
  return Number(pf?.max_whatsapp ?? 1)
}

// Nome final da instância nova: empresa padrão mantém o nome; as demais ganham o prefixo do slug
export async function instanceNameForTenant(tenantId: string, requested: string): Promise<string> {
  const clean = requested.trim().replace(/\s+/g, ' ')
  if (tenantId === (await getDefaultTenantId())) return clean
  const { data: t } = await createAdminClient().from('tenants').select('slug').eq('id', tenantId).maybeSingle()
  const prefix = String(t?.slug ?? tenantId.slice(0, 8)).toLowerCase().replace(/[^a-z0-9]+/g, '-')
  return clean.toLowerCase().startsWith(`${prefix}_`) ? clean : `${prefix}_${clean}`
}

// Registra a instância como da empresa (em evo_instance_aliases)
export async function registerInstanceForTenant(tenantId: string, instanceName: string, label?: string): Promise<void> {
  const admin = createAdminClient()
  const { data } = await admin.from('organization_settings').select('evo_instance_aliases').eq('tenant_id', tenantId).maybeSingle()
  const aliases = (data?.evo_instance_aliases ?? {}) as Record<string, unknown>
  if (Object.prototype.hasOwnProperty.call(aliases, instanceName)) return
  await admin.from('organization_settings')
    .update({ evo_instance_aliases: { ...aliases, [instanceName]: { label: label ?? instanceName } } })
    .eq('tenant_id', tenantId)
}

export async function unregisterInstanceForTenant(tenantId: string, instanceName: string): Promise<void> {
  const admin = createAdminClient()
  const { data } = await admin.from('organization_settings').select('evo_instance_aliases, evo_instance_name').eq('tenant_id', tenantId).maybeSingle()
  const aliases = { ...((data?.evo_instance_aliases ?? {}) as Record<string, unknown>) }
  delete aliases[instanceName]
  await admin.from('organization_settings')
    .update({
      evo_instance_aliases: aliases,
      ...(data?.evo_instance_name === instanceName ? { evo_instance_name: null } : {}),
    })
    .eq('tenant_id', tenantId)
}

// Completa servidor/chave com os da plataforma quando a empresa não tem servidor próprio.
// Uso só no servidor — nunca mande o resultado para o navegador.
export function withPlatformEvo<T extends Record<string, unknown> | null | undefined>(org: T): T {
  if (!org) return org
  const o = org as Record<string, unknown>
  if (o.evo_server_url && o.evo_api_key) return org
  const p = platformCreds()
  if (!p) return org
  return { ...o, evo_server_url: p.serverUrl, evo_api_key: p.apiKey } as unknown as T
}
