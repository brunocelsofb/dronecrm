// Abas liberadas para um tenant (servidor). Lê plan_features + ajustes do tenant.

import { createAdminClient } from '@/lib/supabase/admin'
import { DEFAULT_PLAN_FEATURES, getEffectivePlan, resolveFeatures, FEATURE_KEYS, type PlanId } from './plans'

export async function getPlanFeatureMatrix(): Promise<Record<PlanId, string[]>> {
  const admin = createAdminClient()
  const { data } = await admin.schema('contract_crm').from('plan_features').select('plan, features')
  const out = { ...DEFAULT_PLAN_FEATURES }
  for (const r of (data ?? []) as { plan: PlanId; features: string[] }[]) {
    if (r.plan in out) out[r.plan] = (r.features ?? []).filter(f => FEATURE_KEYS.includes(f))
  }
  return out
}

export async function getTenantFeatures(tenantId: string | null | undefined): Promise<{ plan: PlanId; features: string[] }> {
  if (!tenantId) return { plan: 'starter', features: DEFAULT_PLAN_FEATURES.starter }
  const admin = createAdminClient()
  const [{ data: t }, matrix] = await Promise.all([
    admin.schema('contract_crm').from('tenants')
      .select('plan, trial_ends_at, features_add, features_remove').eq('id', tenantId).maybeSingle(),
    getPlanFeatureMatrix(),
  ])
  const plan = getEffectivePlan(t?.plan ?? 'starter', t?.trial_ends_at ?? null)
  return {
    plan,
    features: resolveFeatures(matrix[plan], (t?.features_add ?? []) as string[], (t?.features_remove ?? []) as string[]),
  }
}
