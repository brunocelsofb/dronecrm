'use server'

// Liberação do acesso de suporte (Configurações → Privacidade e dados).
// Só o admin da empresa libera ou revoga; o Super Admin nunca libera para si.

import { revalidatePath } from 'next/cache'
import { getUserAccess } from '@/lib/auth/access'
import { resolveTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { getSupportSession, SUPPORT_DURATIONS_HOURS } from '@/lib/tenant/support'

type R = { ok: true } | { ok: false; error: string }

async function adminOfTenant() {
  const me = await getUserAccess()
  if (!me?.isAdmin) return null
  if (await getSupportSession()) return null        // sessão de suporte não libera nada
  return me
}

export async function grantSupportAccess(input: { hours: number; reason: string }): Promise<R> {
  const me = await adminOfTenant()
  if (!me) return { ok: false, error: 'Só o administrador da empresa libera o acesso de suporte.' }
  if (!(SUPPORT_DURATIONS_HOURS as readonly number[]).includes(input.hours)) return { ok: false, error: 'Prazo inválido.' }
  const reason = (input.reason ?? '').trim().slice(0, 300)
  if (reason.length < 5) return { ok: false, error: 'Diga em poucas palavras o motivo (ex.: "erro ao gerar proposta").' }
  const db = await createScopedAdmin(await resolveTenantId())
  const now = new Date()
  const { error } = await db.from('support_access_grants').insert({
    granted_by: me.userId, reason, scope: 'read',
    starts_at: now.toISOString(), expires_at: new Date(now.getTime() + input.hours * 3600_000).toISOString(),
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/settings/privacidade')
  return { ok: true }
}

export async function revokeSupportAccess(grantId: string): Promise<R> {
  const me = await adminOfTenant()
  if (!me) return { ok: false, error: 'Só o administrador da empresa revoga o acesso de suporte.' }
  const db = await createScopedAdmin(await resolveTenantId())
  const { data, error } = await db.from('support_access_grants')
    .update({ revoked_at: new Date().toISOString(), revoked_by: me.userId })
    .eq('id', grantId).is('revoked_at', null).select('id')
  if (error) return { ok: false, error: error.message }
  if (!data?.length) return { ok: false, error: 'Liberação não encontrada ou já encerrada.' }
  revalidatePath('/settings/privacidade')
  return { ok: true }
}
