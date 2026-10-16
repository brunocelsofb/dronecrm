// ─── Perfis de acesso (o que cada pessoa vê no menu) ─────────────────────────
// Admin vê tudo o que o plano libera. Os demais veem: abas do plano ∩ abas do
// perfil. A matriz padrão fica aqui e cada empresa pode ajustar em
// Configurações → Perfis de acesso (organization_settings.profile_features).
// O papel (profiles.role) continua separado: admin / membro / aprovadores de
// proposta. Sem perfil gravado, o membro fica como "gestor" (vê tudo, como antes).
// Arquivo sem dependências de servidor: usado também no navegador.

import { FEATURE_KEYS } from '@/lib/config/plans'

export type AccessProfile = 'gestor' | 'hunter' | 'farmer' | 'marketing' | 'financeiro' | 'tecnico'

export const ACCESS_PROFILES: { id: AccessProfile; label: string; description: string }[] = [
  { id: 'gestor', label: 'Gestor comercial', description: 'Todo o comercial, painel, metas e financeiro.' },
  { id: 'hunter', label: 'Hunter (novos negócios)', description: 'Leads, funil, oportunidades e propostas.' },
  { id: 'farmer', label: 'Farmer (carteira)', description: 'Carteira de clientes, contratos, atendimento e NPS.' },
  { id: 'marketing', label: 'Marketing', description: 'Campanhas, leads, empresas e pesquisas. Sem contratos e sem financeiro.' },
  { id: 'financeiro', label: 'Financeiro', description: 'Financeiro, faturamento, painel e contratos.' },
  { id: 'tecnico', label: 'Técnico (operação)', description: 'Contratos e carteira para acompanhar a operação, atendimento e propostas (aprovação técnica).' },
]

export const ACCESS_PROFILE_IDS = ACCESS_PROFILES.map(p => p.id)

export function isAccessProfile(v: unknown): v is AccessProfile {
  return typeof v === 'string' && (ACCESS_PROFILE_IDS as string[]).includes(v)
}

export function accessProfileLabel(v: string | null | undefined): string {
  return ACCESS_PROFILES.find(p => p.id === v)?.label ?? 'Gestor comercial'
}

export const DEFAULT_PROFILE_FEATURES: Record<AccessProfile, string[]> = {
  gestor: [...FEATURE_KEYS],
  hunter: ['dashboard', 'pipeline', 'leads', 'contracts', 'propostas', 'companies', 'whatsapp', 'copiloto'],
  farmer: ['dashboard', 'pipeline', 'contracts', 'propostas', 'carteira', 'companies', 'tickets', 'whatsapp', 'surveys', 'copiloto'],
  marketing: ['marketing', 'leads', 'companies', 'surveys'],
  financeiro: ['financeiro', 'painel', 'contracts', 'companies'],
  tecnico: ['dashboard', 'contracts', 'propostas', 'carteira', 'companies', 'tickets', 'surveys'],
}

// Matriz da empresa: o que estiver gravado substitui o padrão daquele perfil
export function readProfileFeatures(raw: unknown): Record<AccessProfile, string[]> {
  const out = { ...DEFAULT_PROFILE_FEATURES }
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (isAccessProfile(k) && Array.isArray(v)) out[k] = v.filter((f): f is string => typeof f === 'string' && FEATURE_KEYS.includes(f))
    }
  }
  return out
}

// Abas que a pessoa vê = plano ∩ perfil (Admin: o plano inteiro)
export function featuresForUser(opts: { isAdmin: boolean; profile: string | null | undefined; planFeatures: string[]; matrix: Record<AccessProfile, string[]> }): string[] {
  if (opts.isAdmin) return opts.planFeatures
  const prof: AccessProfile = isAccessProfile(opts.profile) ? opts.profile : 'gestor'
  const allowed = new Set(opts.matrix[prof])
  return opts.planFeatures.filter(f => allowed.has(f))
}
