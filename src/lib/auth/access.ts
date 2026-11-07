// Acesso da pessoa logada (servidor): abas do plano ∩ abas do perfil.
// Usado nas ações de servidor para não depender só do menu.

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveTenantId } from '@/lib/tenant/context'
import { getTenantFeatures } from '@/lib/config/tenant-features'
import { featuresForUser, readProfileFeatures, resolveAreas, seesValues } from './access-profiles'

export type UserAccess = {
  userId: string
  isAdmin: boolean
  profile: string
  features: string[]
  seesValues: boolean   // área (Configurações → Áreas e acessos) ou liberação avulsa no usuário
}

export async function getUserAccess(): Promise<UserAccess | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: me } = await supabase.from('profiles').select('role, access_profile, is_super_admin, sees_values').eq('id', user.id).maybeSingle()
  const tenantId = await resolveTenantId()
  const [{ features: planFeatures }, { data: org }] = await Promise.all([
    getTenantFeatures(tenantId),
    createAdminClient().from('organization_settings').select('profile_features, access_areas').eq('tenant_id', tenantId).maybeSingle(),
  ])
  // Super Admin da plataforma age como Admin da empresa que está acessando
  const isAdmin = me?.role === 'admin' || me?.is_super_admin === true
  const profile: string = me?.access_profile || 'gestor'
  const areas = resolveAreas(org?.access_areas, org?.profile_features)
  return {
    userId: user.id,
    isAdmin,
    profile,
    features: featuresForUser({ isAdmin, profile, planFeatures, matrix: readProfileFeatures(org?.profile_features) }),
    seesValues: seesValues({ isAdmin, profile, userOverride: (me as { sees_values?: boolean | null } | null)?.sees_values, areas }),
  }
}

export async function hasFeature(key: string): Promise<UserAccess | null> {
  const a = await getUserAccess()
  return a && a.features.includes(key) ? a : null
}

// A pessoa logada vê valores? (sem login: não)
export async function canSeeValues(): Promise<boolean> {
  return (await getUserAccess())?.seesValues ?? false
}
