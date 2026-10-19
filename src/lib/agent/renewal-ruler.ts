// ─── Régua de renovação (processo interno) ────────────────────────────────────
// Depois que o cliente recebe o aviso de renovação, tudo é interno: a empresa
// segue os passos da sua régua (editável em Configurações → Régua de renovação),
// cada passo tem prazo (dias antes do vencimento) e é marcado como feito na
// oportunidade. A cada passo que chega, as áreas escolhidas recebem e-mail.
// Ao concluir o último, a IA cria a tarefa "revisar e marcar Renovado".
// Gravado em organization_settings.copilot_settings.renewal_ruler.
// Sem 'use server': usado no servidor e na tela.

export type RulerArea = { key: string; label: string; emails: string[] }
export type RulerStep = { id: string; label: string; days_before: number; areas: string[] }
export type RulerTemplates = {
  step_subject: string; step_body: string
  overdue_subject: string; overdue_body: string
  ready_subject: string; ready_body: string
}
export type RulerSettings = {
  enabled: boolean
  lock_renewed: boolean
  areas: RulerArea[]
  steps: RulerStep[]
  templates: RulerTemplates
}

// Andamento gravado em cada contrato (cópia dos passos no início, com datas)
export type RunStep = RulerStep & {
  due_date: string | null       // aaaa-mm-dd
  done_at: string | null
  done_by: string | null
  done_by_name?: string | null
  note?: string | null
  notified_at: string | null
  overdue_notified_at: string | null
}

export const RULER_VARIABLES: { key: string; description: string }[] = [
  { key: 'cliente',    description: 'Nome do cliente' },
  { key: 'contrato',   description: 'Número do contrato' },
  { key: 'vencimento', description: 'Vencimento do contrato (dd/mm/aaaa)' },
  { key: 'passo',      description: 'Nome do passo atual' },
  { key: 'numero',     description: 'Número do passo (ex.: 2 de 5)' },
  { key: 'prazo',      description: 'Prazo do passo (dd/mm/aaaa)' },
  { key: 'anterior',   description: 'Passo concluído antes deste' },
  { key: 'consultor',  description: 'Consultor responsável pela conta' },
  { key: 'empresa',    description: 'Nome da sua empresa' },
  { key: 'link',       description: 'Endereço da oportunidade no CRM' },
]

export const DEFAULT_RULER_AREAS: RulerArea[] = [
  { key: 'comercial', label: 'Comercial', emails: [] },
  { key: 'operacao', label: 'Operação / Técnico', emails: [] },
  { key: 'financeiro', label: 'Financeiro', emails: [] },
  { key: 'juridico', label: 'Jurídico / Contratos', emails: [] },
]

export const DEFAULT_RULER_STEPS: RulerStep[] = [
  { id: 'aviso', label: 'Aviso de renovação enviado ao cliente', days_before: 60, areas: ['comercial'] },
  { id: 'analise', label: 'Análise interna do contrato (indicadores, reajuste e escopo)', days_before: 45, areas: ['comercial', 'operacao', 'financeiro'] },
  { id: 'reuniao', label: 'Reunião de renovação com o cliente', days_before: 35, areas: ['comercial', 'operacao'] },
  { id: 'proposta', label: 'Proposta de renovação enviada', days_before: 25, areas: ['comercial', 'financeiro'] },
  { id: 'aditivo', label: 'Aditivo / contrato assinado', days_before: 10, areas: ['comercial', 'juridico', 'financeiro'] },
]

export const DEFAULT_RULER_TEMPLATES: RulerTemplates = {
  step_subject: '[Renovação] {{cliente}} — passo {{numero}}: {{passo}}',
  step_body:
    'Olá, equipe!\n\n' +
    'A renovação do contrato *{{contrato}}* ({{cliente}}) chegou ao passo *{{numero}}: {{passo}}*.\n\n' +
    '• Prazo deste passo: *{{prazo}}*\n' +
    '• Vencimento do contrato: {{vencimento}}\n' +
    '• Passo anterior concluído: {{anterior}}\n' +
    '• Consultor responsável: {{consultor}}\n\n' +
    'Acompanhe e registre no CRM: {{link}}\n\n' +
    'Equipe {{empresa}}.',
  overdue_subject: '[Renovação atrasada] {{cliente}} — {{passo}}',
  overdue_body:
    'Olá, equipe!\n\n' +
    'O passo *{{passo}}* da renovação do contrato *{{contrato}}* ({{cliente}}) passou do prazo (*{{prazo}}*).\n\n' +
    '• Vencimento do contrato: {{vencimento}}\n' +
    '• Consultor responsável: {{consultor}}\n\n' +
    'Atualize no CRM: {{link}}\n\n' +
    'Equipe {{empresa}}.',
  ready_subject: '[Renovação] {{cliente}} — pronto para marcar Renovado',
  ready_body:
    'Olá, equipe!\n\n' +
    'Todos os passos da renovação do contrato *{{contrato}}* ({{cliente}}) foram concluídos.\n\n' +
    'O consultor {{consultor}} recebeu a tarefa de revisar e marcar *Renovado* no CRM.\n\n' +
    '{{link}}\n\n' +
    'Equipe {{empresa}}.',
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30)

export function resolveRulerSettings(copilot: unknown): RulerSettings {
  const c = (copilot && typeof copilot === 'object' ? copilot : {}) as Record<string, unknown>
  const r = (c.renewal_ruler && typeof c.renewal_ruler === 'object' ? c.renewal_ruler : {}) as Record<string, unknown>

  const areas: RulerArea[] = Array.isArray(r.areas)
    ? (r.areas as unknown[]).map(a => {
        const o = (a && typeof a === 'object' ? a : {}) as Record<string, unknown>
        const label = str(o.label, 60).trim()
        const emails = (Array.isArray(o.emails) ? o.emails : String(o.emails ?? '').split(/[,;\s]+/))
          .map(e => String(e).trim()).filter(e => EMAIL_RE.test(e)).slice(0, 20)
        return { key: str(o.key, 40) || slug(label), label, emails }
      }).filter(a => a.label && a.key).slice(0, 15)
    : DEFAULT_RULER_AREAS
  const areaKeys = new Set(areas.map(a => a.key))

  const steps: RulerStep[] = Array.isArray(r.steps)
    ? (r.steps as unknown[]).map((s, i) => {
        const o = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>
        const label = str(o.label, 120).trim()
        const days = Math.round(Number(o.days_before))
        return {
          id: str(o.id, 40) || `${slug(label) || 'passo'}-${i + 1}`,
          label,
          days_before: Number.isFinite(days) ? Math.max(-60, Math.min(365, days)) : 0,
          areas: (Array.isArray(o.areas) ? o.areas : []).map(String).filter(k => areaKeys.has(k)),
        }
      }).filter(s => s.label).slice(0, 20)
    : DEFAULT_RULER_STEPS
  // ids únicos
  const seen = new Set<string>()
  for (const s of steps) { let id = s.id; let n = 2; while (seen.has(id)) id = `${s.id}-${n++}`; s.id = id; seen.add(id) }

  const t = (r.templates && typeof r.templates === 'object' ? r.templates : {}) as Record<string, unknown>
  const pick = (k: keyof RulerTemplates, max: number) => str(t[k], max).trim() || DEFAULT_RULER_TEMPLATES[k]
  return {
    enabled: r.enabled !== false,
    lock_renewed: r.lock_renewed !== false,
    areas,
    steps,
    templates: {
      step_subject: pick('step_subject', 200), step_body: pick('step_body', 3000),
      overdue_subject: pick('overdue_subject', 200), overdue_body: pick('overdue_body', 3000),
      ready_subject: pick('ready_subject', 200), ready_body: pick('ready_body', 3000),
    },
  }
}

// Prazo = vencimento − dias (aaaa-mm-dd)
export function dueDate(periodEnd: string | null, daysBefore: number): string | null {
  if (!periodEnd || !/^\d{4}-\d{2}-\d{2}/.test(periodEnd)) return null
  const d = new Date(`${periodEnd.slice(0, 10)}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - daysBefore)
  return d.toISOString().slice(0, 10)
}

// Passos ordenados pelo prazo (mais distante do vencimento primeiro)
export function buildRunSteps(steps: RulerStep[], periodEnd: string | null): RunStep[] {
  return [...steps]
    .sort((a, b) => b.days_before - a.days_before)
    .map(s => ({ ...s, due_date: dueDate(periodEnd, s.days_before), done_at: null, done_by: null, notified_at: null, overdue_notified_at: null }))
}

export const brDate = (iso: string | null | undefined) =>
  iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10).split('-').reverse().join('/') : '—'

export function isOverdue(step: RunStep, todayIso: string): boolean {
  return !step.done_at && !!step.due_date && step.due_date < todayIso
}

// E-mails das áreas de um passo (sem repetição)
export function stepRecipients(step: Pick<RulerStep, 'areas'>, areas: RulerArea[]): string[] {
  const out = new Map<string, string>()
  for (const a of areas) if (step.areas.includes(a.key)) for (const e of a.emails) out.set(e.toLowerCase(), e)
  return [...out.values()]
}

export function renderRuler(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => (k in vars ? vars[k] : m))
}
