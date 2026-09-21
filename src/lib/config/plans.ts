export type PlanId = 'starter' | 'professional' | 'enterprise'

export const PLAN_FEATURES: Record<PlanId, string[]> = {
  starter: [
    'dashboard',
    'pipeline',
    'leads',
    'tickets',
    'settings',
  ],
  professional: [
    'dashboard',
    'pipeline',
    'leads',
    'contracts',
    'companies',
    'propostas',
    'carteira',
    'tickets',
    'whatsapp',
    'whatsapp-relatorios',
    'settings',
  ],
  enterprise: [
    'dashboard',
    'pipeline',
    'leads',
    'contracts',
    'companies',
    'propostas',
    'carteira',
    'tickets',
    'whatsapp',
    'whatsapp-relatorios',
    'surveys',
    'settings',
  ],
}

export function canAccess(plan: string, feature: string): boolean {
  const features = PLAN_FEATURES[plan as PlanId] ?? PLAN_FEATURES.starter
  return features.includes(feature)
}

export function getEffectivePlan(plan: string, trialEndsAt: string | null): PlanId {
  if (trialEndsAt && new Date(trialEndsAt) > new Date()) {
    return 'enterprise'
  }
  return (plan as PlanId) ?? 'starter'
}
