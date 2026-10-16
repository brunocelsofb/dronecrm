// Acesso da pessoa logada (servidor): abas do plano ∩ abas do perfil.
// Usado nas ações de servidor para não depender só do menu.

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveTenantId } from '@/lib/tenant/context'
import { getTenantFeatures } from '@/lib/config/tenant-features'
import { featuresForUser, readProfileFeatures, isAccessProfile, type AccessProfile } from './access-profiles'

export type UserAccess = {
  userId: string
  isAdmin: boolean
  profile: AccessProfile
  features: string[]
}

export async function getUserAccess(): Promise<UserAccess | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: me } = await supabase.from('profiles').select('role, access_profile, is_super_admin').eq('id', user.id).maybeSingle()
  const tenantId = await resolveTenantId()
  const [{ features: planFeatures }, { data: org }] = await Promise.all([
    getTenantFeatures(tenantId),
    createAdminClient().from('organization_settings').select('profile_features').eq('tenant_id', tenantId).maybeSingle(),
  ])
  // Super Admin da plataforma age como Admin da empresa que está acessando
  const isAdmin = me?.role === 'admin' || me?.is_super_admin === true
  const profile: AccessProfile = isAccessProfile(me?.access_profile) ? me.access_profile : 'gestor'
  return {
    userId: user.id,
    isAdmin,
    profile,
    features: featuresForUser({ isAdmin, profile, planFeatures, matrix: readProfileFeatures(org?.profile_features) }),
  }
}

export async function hasFeature(key: string): Promise<UserAccess | null> {
  const a = await getUserAccess()
  return a && a.features.includes(key) ? a : null
}
