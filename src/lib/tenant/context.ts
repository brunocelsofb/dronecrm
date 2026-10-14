// ─── Empresa (tenant) do contexto atual ───────────────────────────────────────
// Cada empresa tem a própria linha em organization_settings (chave: tenant_id).
// A Orbis manteve id = 'default' por histórico; empresas novas usam id = tenant_id.
//
// Como descobrir a empresa:
//   - usuário logado        → getCurrentTenantId() (perfil; Super Admin em "Acessar" usa a empresa acessada)
//   - contrato / instância  → tenantIdForContract() / tenantIdForInstance()
//   - páginas públicas      → pelo registro do token (pesquisa, ticket...) ou ?empresa=<slug>
//
// Nada aqui deve ser importado em Client Components.

import { cache } from 'react'
import { AsyncLocalStorage } from 'node:async_hooks'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Rotinas automáticas (crons): roda um bloco "como" uma empresa
const tenantScope = new AsyncLocalStorage<string>()
export function runAsTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return tenantScope.run(tenantId, fn)
}

export const getCurrentTenantId = cache(async (): Promise<string | null> => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles').select('tenant_id, is_super_admin, impersonating_tenant_id').eq('id', user.id).maybeSingle()
  if (profile?.is_super_admin) {
    // "Acessar" do Super Admin: gravado no perfil (o banco usa o mesmo valor no RLS)
    if (profile.impersonating_tenant_id) return profile.impersonating_tenant_id as string
    try {
      const imp = (await headers()).get('x-orbis-imp-tenant-id')
      if (imp) return imp
    } catch { /* fora de request */ }
  }
  return (profile?.tenant_id as string | null) ?? null
})

export async function requireTenantId(): Promise<string> {
  const id = await getCurrentTenantId()
  if (!id) throw new Error('Empresa (tenant) do usuário não encontrada.')
  return id
}

// Empresa "padrão" (dona da linha 'default') — só para rotas públicas antigas sem contexto
export const getDefaultTenantId = cache(async (): Promise<string | null> => {
  const { data } = await createAdminClient()
    .from('organization_settings').select('tenant_id').eq('id', 'default').maybeSingle()
  return (data?.tenant_id as string | null) ?? null
})

export async function tenantIdForContract(contractId: string | null | undefined): Promise<string | null> {
  if (!contractId) return null
  const { data } = await createAdminClient().from('contracts').select('tenant_id').eq('id', contractId).maybeSingle()
  return (data?.tenant_id as string | null) ?? null
}

// Empresa dona de uma instância de WhatsApp (principal ou apelido)
export async function tenantIdForInstance(instanceName: string | null | undefined): Promise<string | null> {
  if (!instanceName) return null
  const { data } = await createAdminClient()
    .from('organization_settings').select('tenant_id, evo_instance_name, evo_instance_aliases')
  for (const row of data ?? []) {
    const aliases = (row.evo_instance_aliases ?? {}) as Record<string, unknown>
    if (row.evo_instance_name === instanceName || Object.prototype.hasOwnProperty.call(aliases, instanceName)) {
      return row.tenant_id as string
    }
  }
  return null
}

export async function tenantIdForSlug(slug: string | null | undefined): Promise<string | null> {
  if (!slug) return null
  const { data } = await createAdminClient().from('tenants').select('id').ilike('slug', slug).maybeSingle()
  return (data?.id as string | null) ?? null
}

// Garante a linha de configurações da empresa (empresas novas nascem sem)
export async function ensureOrgSettings(tenantId: string): Promise<void> {
  const admin = createAdminClient()
  const { data } = await admin.from('organization_settings').select('id').eq('tenant_id', tenantId).maybeSingle()
  if (data) return
  await admin.from('organization_settings').insert({ id: tenantId, tenant_id: tenantId })
}

// Empresa para ler/gravar organization_settings em qualquer contexto:
// contrato/instância informados > usuário logado > empresa padrão (rotinas antigas).
export async function resolveTenantId(hint?: { contractId?: string | null; instanceName?: string | null }): Promise<string> {
  const scoped = tenantScope.getStore()
  if (hint?.contractId) {
    const t = await tenantIdForContract(hint.contractId)
    if (t) return t
  }
  if (hint?.instanceName) {
    const t = await tenantIdForInstance(hint.instanceName)
    if (t) return t
  }
  if (scoped) return scoped
  let fromUser: string | null = null
  try { fromUser = await getCurrentTenantId() } catch { fromUser = null }
  if (fromUser) return fromUser
  const d = await getDefaultTenantId()
  if (d) return d
  throw new Error('Não foi possível identificar a empresa (tenant).')
}

// Formulários e páginas públicas: ?empresa=<slug> > usuário logado > empresa padrão
export async function resolvePublicTenantId(slug?: string | null): Promise<string> {
  const bySlug = await tenantIdForSlug(slug)
  return bySlug ?? resolveTenantId()
}
