'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentProfile } from '@/lib/auth/role'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { resolveTenantId } from '@/lib/tenant/context'
import { FEATURE_KEYS } from '@/lib/config/plans'
import { ACCESS_PROFILE_IDS, isAccessProfile } from '@/lib/auth/access-profiles'

type Result = { ok: true } | { ok: false; error: string }

// Admin: quais abas cada perfil vê nesta empresa (null = volta ao padrão)
export async function saveProfileFeatures(matrix: Record<string, string[]> | null): Promise<Result> {
  const me = await getCurrentProfile()
  if (me?.role !== 'admin') return { ok: false, error: 'Só o Admin altera os perfis de acesso.' }
  let clean: Record<string, string[]> | null = null
  if (matrix) {
    clean = {}
    for (const [k, v] of Object.entries(matrix)) {
      if (!isAccessProfile(k) || !Array.isArray(v)) continue
      clean[k] = [...new Set(v.filter(f => FEATURE_KEYS.includes(f)))]
    }
    if (Object.keys(clean).length !== ACCESS_PROFILE_IDS.length) return { ok: false, error: 'Matriz incompleta.' }
  }
  const tenantId = await resolveTenantId()
  const db = await createScopedAdmin(tenantId)
  const { error } = await db.from('organization_settings').update({ profile_features: clean }).eq('tenant_id', tenantId)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/', 'layout')
  return { ok: true }
}
