// Guarda das telas de regras (Central de regras): só o admin da empresa, nunca em acesso de suporte.
// Módulo comum (sem 'use server'): não vira ação chamável pelo navegador.
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { scopeAdminClient } from '@/lib/tenant/scoped-admin'
import { resolveTenantId } from '@/lib/tenant/context'
import { getSupportSession, SUPPORT_READONLY_MESSAGE } from '@/lib/tenant/support'
import { getTenantFeatures } from '@/lib/config/tenant-features'

export type Guard = { tenantId: string; userId: string; features: string[]; db: ReturnType<typeof createAdminClient> }

export async function rulesAdminGuard(): Promise<Guard | { error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }
  const [{ data: me }, tenantId, s] = await Promise.all([
    supabase.from('profiles').select('role').eq('id', user.id).maybeSingle(),
    resolveTenantId(),
    getSupportSession(),
  ])
  if (me?.role !== 'admin') return { error: 'Só o administrador da empresa altera as regras.' }
  if (!tenantId) return { error: 'Empresa não identificada.' }
  if (s && s.tenantId === tenantId) return { error: SUPPORT_READONLY_MESSAGE }
  const tf = await getTenantFeatures(tenantId)
  return { tenantId, userId: user.id, features: tf.features, db: scopeAdminClient(createAdminClient(), tenantId, user.id) }
}
