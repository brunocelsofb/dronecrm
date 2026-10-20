// ─── Empresas: segmentos e regra de inativos (por empresa/tenant) ─────────────
// Gravado em organization_settings.company_settings. Editável em
// Configurações → Segmentos e inativos. Sem 'use server': usado no servidor e na tela.

export type CompanySettings = {
  segments: string[]          // opções do campo Segmento (uma por empresa)
  inactive_months: number     // sem contrato ativo e sem compra há N meses = inativo
  hunter_weekly: boolean      // resumo semanal dos inativos ao gestor
  hunter_tasks: boolean       // tarefa de reativação ao responsável da conta
}

export const DEFAULT_SEGMENTS = [
  'Grupo Hospitalar (geral e especializado)',
  'Grupo Clínicas',
  'Grupo Diagnósticos (imagem e laboratório)',
  'Outros (prestadores de serviços / comércio)',
]

export const DEFAULT_COMPANY_SETTINGS: CompanySettings = {
  segments: DEFAULT_SEGMENTS, inactive_months: 12, hunter_weekly: true, hunter_tasks: true,
}

export function resolveCompanySettings(raw: unknown): CompanySettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const segs = Array.isArray(r.segments)
    ? [...new Set((r.segments as unknown[]).map(s => (typeof s === 'string' ? s.trim().slice(0, 80) : '')).filter(Boolean))].slice(0, 20)
    : DEFAULT_SEGMENTS
  const m = Math.round(Number(r.inactive_months))
  return {
    segments: segs.length ? segs : DEFAULT_SEGMENTS,
    inactive_months: Number.isFinite(m) && m >= 1 && m <= 60 ? m : 12,
    hunter_weekly: r.hunter_weekly !== false,
    hunter_tasks: r.hunter_tasks !== false,
  }
}

// O campo segment guarda JSON de lista (legado) ou texto; devolve o primeiro valor
export function segmentOf(raw: string | null | undefined): string | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw)
    if (Array.isArray(v)) return (v.find(x => typeof x === 'string' && x.trim()) as string | undefined)?.trim() ?? null
    if (typeof v === 'string') return v.trim() || null
  } catch { /* texto simples */ }
  return raw.trim() || null
}

// Grava como lista de um item (compatível com as telas que leem lista)
export const segmentValue = (s: string | null | undefined) => (s && s.trim() ? JSON.stringify([s.trim()]) : null)

// Acha a opção cadastrada que corresponde ao texto (sem acento/maiúsculas)
export function matchSegment(text: string | null | undefined, options: string[]): string | null {
  const n = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
  if (!text?.trim()) return null
  const t = n(text)
  return options.find(o => n(o) === t) ?? options.find(o => n(o).startsWith(t) || t.startsWith(n(o).split(' (')[0])) ?? null
}
