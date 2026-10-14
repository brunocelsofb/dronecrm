// ─── Planos e abas (licenças) ─────────────────────────────────────────────────
// Catálogo de abas no código; quais abas cada plano libera fica no banco
// (contract_crm.plan_features), editável em Super Admin → Planos e abas.
// Cada cliente (tenant) pode ter ajustes: features_add (libera além do plano)
// e features_remove (tira do plano). Configurações é sempre liberada.

export type PlanId = 'starter' | 'professional' | 'enterprise'

export const PLANS: { id: PlanId; label: string }[] = [
  { id: 'starter', label: 'Starter' },
  { id: 'professional', label: 'Professional' },
  { id: 'enterprise', label: 'Enterprise' },
]

export type FeatureDef = { key: string; label: string; paths: string[] }

// Ordem = ordem do menu. paths = prefixos de URL bloqueados quando a aba não é liberada.
export const FEATURES: FeatureDef[] = [
  { key: 'dashboard',           label: 'Dashboard',            paths: ['/'] },
  { key: 'pipeline',            label: 'Funil',                paths: ['/pipeline', '/pipelines'] },
  { key: 'leads',               label: 'Leads',                paths: ['/leads'] },
  { key: 'contracts',           label: 'Oportunidades',        paths: ['/contracts'] },
  { key: 'propostas',           label: 'Propostas',            paths: ['/propostas', '/proposals'] },
  { key: 'carteira',            label: 'Gestão de Carteira',   paths: ['/carteira'] },
  { key: 'companies',           label: 'Empresas',             paths: ['/companies'] },
  { key: 'tickets',             label: 'Atendimento',          paths: ['/tickets'] },
  { key: 'whatsapp',            label: 'WhatsApp',             paths: ['/whatsapp'] },
  { key: 'whatsapp-relatorios', label: 'Relatórios WPP',       paths: ['/whatsapp/relatorios'] },
  { key: 'surveys',             label: 'Pesquisas & NPS',      paths: ['/surveys-dashboard', '/surveys', '/nps-dashboard'] },
  { key: 'copiloto',            label: 'Copiloto IA',          paths: ['/briefing', '/copiloto'] },
]

export const FEATURE_KEYS = FEATURES.map(f => f.key)

// Usado só se a tabela plan_features não responder
export const DEFAULT_PLAN_FEATURES: Record<PlanId, string[]> = {
  starter: ['dashboard', 'pipeline', 'leads', 'tickets', 'copiloto'],
  professional: ['dashboard', 'pipeline', 'leads', 'contracts', 'companies', 'propostas', 'carteira', 'tickets', 'whatsapp', 'whatsapp-relatorios', 'copiloto'],
  enterprise: FEATURE_KEYS,
}

export function isPlanId(v: unknown): v is PlanId {
  return v === 'starter' || v === 'professional' || v === 'enterprise'
}

export function getEffectivePlan(plan: string, trialEndsAt: string | null): PlanId {
  if (trialEndsAt && new Date(trialEndsAt) > new Date()) return 'enterprise'
  return isPlanId(plan) ? plan : 'starter'
}

// Abas liberadas = plano + liberadas no cliente − bloqueadas no cliente
export function resolveFeatures(planFeatures: string[], add: string[] = [], remove: string[] = []): string[] {
  const set = new Set(planFeatures)
  for (const f of add) set.add(f)
  for (const f of remove) set.delete(f)
  return FEATURE_KEYS.filter(k => set.has(k))
}

// Aba dona de um caminho (o prefixo mais longo vence: /whatsapp/relatorios > /whatsapp)
export function featureForPath(pathname: string): string | null {
  let best: { key: string; len: number } | null = null
  for (const f of FEATURES) {
    for (const p of f.paths) {
      const match = p === '/' ? pathname === '/' : pathname === p || pathname.startsWith(`${p}/`)
      if (match && (!best || p.length > best.len)) best = { key: f.key, len: p.length }
    }
  }
  return best?.key ?? null
}
