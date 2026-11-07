// ─── Perfis de acesso (o que cada pessoa vê no menu) ─────────────────────────
// Admin vê tudo o que o plano libera. Os demais veem: abas do plano ∩ abas do
// perfil. A matriz padrão fica aqui e cada empresa pode ajustar em
// Configurações → Perfis de acesso (organization_settings.profile_features).
// O papel (profiles.role) continua separado: admin / membro / aprovadores de
// proposta. Sem perfil gravado, o membro fica como "gestor" (vê tudo, como antes).
// Arquivo sem dependências de servidor: usado também no navegador.

import { FEATURE_KEYS } from '@/lib/config/plans'

export type AccessProfile = 'gestor' | 'hunter' | 'farmer' | 'diretoria' | 'marketing' | 'financeiro' | 'controladoria' | 'qualidade' | 'tecnico' | 'gente_gestao' | 'departamento_pessoal'

// Áreas padrão. Cada empresa ajusta as abas, o "vê valores", o nome, esconde as que não usa e
// cria áreas novas (organization_settings.access_areas + profile_features). Ids hunter/farmer/
// gestor/marketing/financeiro/tecnico são usados por rotinas (agente, leads, faturamento).
export const ACCESS_PROFILES: { id: AccessProfile; label: string; description: string; group: string; seesValues: boolean }[] = [
  { id: 'gestor', label: 'Comercial — Gestor', group: 'Comercial', seesValues: true, description: 'Todo o comercial, painel, metas e financeiro.' },
  { id: 'hunter', label: 'Comercial — Hunter', group: 'Comercial', seesValues: true, description: 'Novos negócios: leads, funil, oportunidades e propostas.' },
  { id: 'farmer', label: 'Comercial — Farmer', group: 'Comercial', seesValues: true, description: 'Carteira: clientes, contratos, renovação, atendimento e NPS.' },
  { id: 'diretoria', label: 'Diretoria', group: 'Diretoria', seesValues: true, description: 'Tudo, com valores.' },
  { id: 'marketing', label: 'Marketing', group: 'Marketing', seesValues: false, description: 'Clientes, relacionamento, campanhas e os funis de inbound.' },
  { id: 'financeiro', label: 'Financeiro', group: 'Financeiro', seesValues: true, description: 'Financeiro, faturamento, painel e contratos.' },
  { id: 'controladoria', label: 'Controladoria', group: 'Controladoria', seesValues: true, description: 'Painel, financeiro e contratos.' },
  { id: 'qualidade', label: 'Qualidade', group: 'Qualidade', seesValues: false, description: 'Contratos, atendimento e funis.' },
  { id: 'tecnico', label: 'Técnico', group: 'Técnico', seesValues: false, description: 'Contratos, carteira e atendimento; na proposta, só o dimensionamento.' },
  { id: 'gente_gestao', label: 'Gente e Gestão', group: 'Gente e Gestão', seesValues: false, description: 'Equipe e pessoas.' },
  { id: 'departamento_pessoal', label: 'Departamento Pessoal', group: 'Departamento Pessoal', seesValues: false, description: 'Equipe e admissões.' },
]

export const ACCESS_PROFILE_IDS = ACCESS_PROFILES.map(p => p.id)

export function isAccessProfile(v: unknown): v is AccessProfile {
  return typeof v === 'string' && (ACCESS_PROFILE_IDS as string[]).includes(v)
}

// Id de área (padrão ou criada pela empresa)
export const isAreaId = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9_]{2,40}$/.test(v)

export function accessProfileLabel(v: string | null | undefined, areas?: Area[]): string {
  return areas?.find(a => a.id === v)?.label ?? ACCESS_PROFILES.find(p => p.id === v)?.label ?? 'Comercial — Gestor'
}

export const DEFAULT_PROFILE_FEATURES: Record<string, string[]> = {
  gestor: [...FEATURE_KEYS],
  hunter: ['dashboard', 'pipeline', 'leads', 'contracts', 'propostas', 'companies', 'whatsapp', 'copiloto'],
  farmer: ['dashboard', 'pipeline', 'contracts', 'propostas', 'carteira', 'companies', 'tickets', 'whatsapp', 'surveys', 'copiloto'],
  diretoria: [...FEATURE_KEYS],
  marketing: ['marketing', 'sdr', 'leads', 'pipeline', 'companies', 'whatsapp', 'surveys'],
  financeiro: ['financeiro', 'painel', 'contracts', 'companies'],
  controladoria: ['dashboard', 'painel', 'financeiro', 'contracts', 'companies'],
  qualidade: ['dashboard', 'pipeline', 'contracts', 'companies', 'tickets', 'surveys'],
  tecnico: ['dashboard', 'contracts', 'propostas', 'carteira', 'companies', 'tickets', 'surveys'],
  gente_gestao: ['dashboard'],
  departamento_pessoal: ['dashboard'],
}

// Matriz da empresa: o que estiver gravado substitui o padrão daquela área (inclui áreas criadas)
export function readProfileFeatures(raw: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = { ...DEFAULT_PROFILE_FEATURES }
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (isAreaId(k) && Array.isArray(v)) out[k] = v.filter((f): f is string => typeof f === 'string' && FEATURE_KEYS.includes(f))
    }
  }
  return out
}

// ─── Áreas da empresa (nome, vê valores, escondidas, criadas) ────────────────
export type Area = { id: string; label: string; description: string; group: string; seesValues: boolean; builtin: boolean; features: string[] }
type AreasRaw = { custom?: { id: string; label: string; description?: string }[]; hidden?: string[]; values?: Record<string, boolean>; labels?: Record<string, string> }

export function resolveAreas(accessAreasRaw: unknown, profileFeaturesRaw: unknown): Area[] {
  const raw = (accessAreasRaw && typeof accessAreasRaw === 'object' ? accessAreasRaw : {}) as AreasRaw
  const matrix = readProfileFeatures(profileFeaturesRaw)
  const hidden = new Set((raw.hidden ?? []).filter(isAreaId))
  const vals = raw.values ?? {}
  const labels = raw.labels ?? {}
  const builtin: Area[] = ACCESS_PROFILES.filter(p => !hidden.has(p.id)).map(p => ({
    id: p.id, label: labels[p.id] || p.label, description: p.description, group: p.group,
    seesValues: typeof vals[p.id] === 'boolean' ? vals[p.id] : p.seesValues, builtin: true, features: matrix[p.id] ?? [],
  }))
  const custom: Area[] = (raw.custom ?? []).filter(c => isAreaId(c.id) && !isAccessProfile(c.id) && !hidden.has(c.id)).map(c => ({
    id: c.id, label: String(c.label || c.id).slice(0, 60), description: String(c.description ?? '').slice(0, 200), group: String(c.label || c.id),
    seesValues: vals[c.id] === true, builtin: false, features: matrix[c.id] ?? [],
  }))
  return [...builtin, ...custom]
}

// Vê valores? Admin sempre; liberação avulsa no usuário (sim/não) vence a regra da área.
export function seesValues(opts: { isAdmin: boolean; profile: string | null | undefined; userOverride: boolean | null | undefined; areas: Area[] }): boolean {
  if (opts.isAdmin) return true
  if (typeof opts.userOverride === 'boolean') return opts.userOverride
  const a = opts.areas.find(x => x.id === (opts.profile ?? 'gestor')) ?? opts.areas.find(x => x.id === 'gestor')
  return a ? a.seesValues : true
}

// Abas que a pessoa vê = plano ∩ perfil (Admin: o plano inteiro)
export function featuresForUser(opts: { isAdmin: boolean; profile: string | null | undefined; planFeatures: string[]; matrix: Record<string, string[]> }): string[] {
  if (opts.isAdmin) return opts.planFeatures
  const prof = opts.profile && opts.matrix[opts.profile] ? opts.profile : 'gestor'
  const allowed = new Set(opts.matrix[prof])
  return opts.planFeatures.filter(f => allowed.has(f))
}
