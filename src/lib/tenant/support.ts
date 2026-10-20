// ─── Acesso de suporte (Super Admin dentro de uma empresa) ────────────────────
// Regra: o Super Admin não vê o conteúdo das empresas por padrão. Só entra numa
// empresa (botão "Acessar") com liberação ativa dada pelo admin dela, por tempo
// limitado e só leitura. Cada acesso fica em support_access_log.
// O banco aplica a mesma regra: current_tenant_id() ignora o "Acessar" sem
// liberação e as políticas support_readonly_* bloqueiam gravação.
// Uso só no servidor (sem 'use server': nada aqui é chamável pelo navegador).

import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export type SupportGrant = { id: string; tenantId: string; expiresAt: string; reason: string | null; grantedBy: string | null }

export const SUPPORT_DURATIONS_HOURS = [1, 4, 24, 72] as const

// Liberação ativa da empresa (ou null)
export async function activeSupportGrant(tenantId: string): Promise<SupportGrant | null> {
  const nowIso = new Date().toISOString()
  const { data } = await createAdminClient().from('support_access_grants')
    .select('id, tenant_id, expires_at, reason, granted_by')
    .eq('tenant_id', tenantId).is('revoked_at', null)
    .lte('starts_at', nowIso).gt('expires_at', nowIso)
    .order('expires_at', { ascending: false }).limit(1).maybeSingle()
  if (!data) return null
  return { id: data.id as string, tenantId: data.tenant_id as string, expiresAt: data.expires_at as string, reason: (data.reason as string | null) ?? null, grantedBy: (data.granted_by as string | null) ?? null }
}

export type SupportSession = { userId: string; userName: string | null; tenantId: string; grant: SupportGrant }

// Sessão de suporte do usuário atual: Super Admin em outra empresa, com liberação ativa.
// null = não é sessão de suporte (usuário comum, ou Super Admin na própria conta).
export const getSupportSession = cache(async (): Promise<SupportSession | null> => {
  let userId: string | null = null
  try { userId = (await (await createClient()).auth.getUser()).data.user?.id ?? null } catch { return null }
  if (!userId) return null
  const { data: p } = await createAdminClient().from('profiles')
    .select('is_super_admin, tenant_id, impersonating_tenant_id, full_name').eq('id', userId).maybeSingle()
  if (!p?.is_super_admin || !p.impersonating_tenant_id || p.impersonating_tenant_id === p.tenant_id) return null
  const grant = await activeSupportGrant(p.impersonating_tenant_id as string)
  if (!grant) return null
  return { userId, userName: (p.full_name as string | null) ?? null, tenantId: p.impersonating_tenant_id as string, grant }
})

// Super Admin com "Acessar" gravado, mas sem liberação válida (expirou ou foi revogada)
export const isStaleImpersonation = cache(async (): Promise<boolean> => {
  let userId: string | null = null
  try { userId = (await (await createClient()).auth.getUser()).data.user?.id ?? null } catch { return false }
  if (!userId) return false
  const { data: p } = await createAdminClient().from('profiles')
    .select('is_super_admin, tenant_id, impersonating_tenant_id').eq('id', userId).maybeSingle()
  if (!p?.is_super_admin || !p.impersonating_tenant_id || p.impersonating_tenant_id === p.tenant_id) return false
  return !(await activeSupportGrant(p.impersonating_tenant_id as string))
})

export async function logSupport(entry: {
  tenantId: string; grantId?: string | null; actorId: string; actorName?: string | null
  action: 'start' | 'view' | 'action' | 'write_blocked' | 'stop' | 'reset'; path?: string | null; detail?: string | null
}): Promise<void> {
  try {
    await createAdminClient().from('support_access_log').insert({
      tenant_id: entry.tenantId, grant_id: entry.grantId ?? null, actor_id: entry.actorId, actor_name: entry.actorName ?? null,
      action: entry.action, path: entry.path?.slice(0, 500) ?? null, detail: entry.detail?.slice(0, 500) ?? null,
    })
  } catch (e) {
    console.error('[support] falha ao registrar acesso:', e)
  }
}

export const SUPPORT_READONLY_MESSAGE = 'Acesso de suporte é só leitura: nada pode ser gravado nesta empresa.'
