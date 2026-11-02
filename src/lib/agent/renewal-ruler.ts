// ─── Régua de renovação (processo interno) ────────────────────────────────────
// Depois que o cliente recebe o aviso de renovação, tudo é interno: a empresa
// segue os passos da sua régua (editável em Configurações → Régua de renovação),
// cada passo tem prazo (dias antes do vencimento) e é marcado como feito na
// oportunidade. A cada passo que chega, as áreas escolhidas recebem e-mail.
// Ao concluir o último, a IA cria a tarefa "revisar e marcar Renovado".
// Gravado em organization_settings.copilot_settings.renewal_ruler.
// Sem 'use server': usado no servidor e na tela.

export type RulerArea = { key: string; label: string; emails: string[] }
// areas: áreas da empresa ('area:<id>', Central de regras → Áreas e IA) ou áreas antigas da régua (só e-mail)
// done_when: 'manual' (concluído por quem recebeu, com o que foi feito) ou 'client_notice' (quando o aviso ao cliente é enviado)
// who: quem faz o passo — 'owner' (consultor dono do contrato), 'areas' (coordenador da 1ª área; gerente avisado)
//      ou 'agent' (o agente de IA prepara o material e a pessoa revisa e conclui; sem IA, vira tarefa comum)
// instructions: o que fazer (vai na tarefa; é o pedido ao agente quando who = 'agent')
// requires_file: só conclui com arquivo anexado ao contrato depois que o passo chegou
// with_previous: começa junto com o passo anterior (correm em paralelo)
export type RulerWho = 'owner' | 'areas' | 'agent'
export type RulerStep = {
  id: string; label: string; days_before: number; areas: string[]; done_when?: 'manual' | 'client_notice'
  who?: RulerWho; instructions?: string; requires_file?: boolean; with_previous?: boolean
}
export const RULER_WHO_LABEL: Record<RulerWho, string> = {
  owner: 'Consultor (dono do contrato)',
  areas: 'Área (coordenador faz; gerente acompanha)',
  agent: 'Agente de IA prepara; pessoa revisa e conclui',
}
export const MAX_STEP_INSTRUCTIONS = 1000
export type RulerTemplates = {
  step_subject: string; step_body: string
  overdue_subject: string; overdue_body: string
  ready_subject: string; ready_body: string
}
export type RulerSettings = {
  enabled: boolean
  lock_renewed: boolean
  overdue_repeat_days: number   // passo atrasado: repete o aviso a cada N dias (0 = só uma vez)
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
  overdue_notified_at: string | null   // último aviso de atraso
  overdue_count?: number
}

export const RULER_VARIABLES: { key: string; description: string }[] = [
  { key: 'cliente',    description: 'Nome do cliente' },
  { key: 'contrato',   description: 'Número do contrato' },
  { key: 'vencimento', description: 'Vencimento do contrato (dd/mm/aaaa)' },
  { key: 'passo',      description: 'Nome do passo atual' },
  { key: 'numero',     description: 'Número do passo (ex.: 2 de 5)' },
  { key: 'prazo',      description: 'Prazo do passo (dd/mm/aaaa)' },
  { key: 'anterior',   description: 'Passo concluído antes deste' },
  { key: 'atraso',     description: 'Dias de atraso do passo (e-mail de atraso)' },
  { key: 'consultor',  description: 'Consultor responsável pela conta' },
  { key: 'empresa',    description: 'Nome da sua empresa' },
  { key: 'link',       description: 'Endereço da oportunidade no CRM' },
]

// Lista antiga de áreas da régua (só e-mail): substituída pelas áreas da empresa (Central de regras → Áreas e IA)
export const DEFAULT_RULER_AREAS: RulerArea[] = []

export const DEFAULT_RULER_STEPS: RulerStep[] = [
  { id: 'preparar', label: 'Preparar a renovação (aviso interno às áreas)', days_before: 90, areas: [], done_when: 'manual' },
  { id: 'aviso', done_when: 'client_notice', label: 'Aviso de renovação enviado ao cliente', days_before: 60, areas: [] },
  { id: 'analise', label: 'Análise interna do contrato (indicadores, reajuste e escopo)', days_before: 45, areas: [] },
  { id: 'reuniao', label: 'Reunião de renovação com o cliente', days_before: 35, areas: [] },
  { id: 'proposta', label: 'Proposta de renovação enviada', days_before: 25, areas: [] },
  { id: 'aditivo', label: 'Aditivo / contrato assinado', days_before: 10, areas: [] },
]

// Modelo sugerido (ponto de partida; a empresa edita tudo depois de carregar). Sem áreas: a empresa escolhe as suas.
export const RULER_MODEL_STEPS: RulerStep[] = [
  { id: 'aviso', label: 'Enviar o aviso de renovação ao cliente', days_before: 60, areas: [], done_when: 'client_notice', who: 'owner' },
  { id: 'aplicabilidade', label: 'Atualizar a tabela de aplicabilidade (mesmo sem mudança no parque)', days_before: 55, areas: [], done_when: 'manual', who: 'areas', requires_file: true,
    instructions: 'Atualize a tabela de aplicabilidade do contrato, mesmo que não haja mudança no parque tecnológico, e anexe a versão nova ao contrato.' },
  { id: 'custos', label: 'Elaborar ou atualizar a planilha de custos do projeto', days_before: 55, areas: [], done_when: 'manual', who: 'owner', requires_file: true, with_previous: true,
    instructions: 'Elabore ou atualize a planilha de custos do projeto e anexe ao contrato.' },
  { id: 'reuniao-interna', label: 'Reunião interna com o time técnico (melhorias e entrega dos serviços)', days_before: 45, areas: [], done_when: 'manual', who: 'agent',
    instructions: 'Monte a pauta da reunião interna com o time técnico: resumo do contrato, o que foi registrado nos passos anteriores, pontos de melhoria e de entrega dos serviços a discutir.' },
  { id: 'reuniao-cliente', label: 'Reunião com o cliente (de preferência até 30 dias do vencimento)', days_before: 30, areas: [], done_when: 'manual', who: 'owner' },
  { id: 'aditivo', label: 'Negociação e assinatura do termo aditivo', days_before: 15, areas: [], done_when: 'manual', who: 'owner', requires_file: true,
    instructions: 'Negocie as condições e anexe o termo aditivo assinado ao contrato.' },
  { id: 'comunicacao', label: 'Formalização e comunicação interna da renovação', days_before: 5, areas: [], done_when: 'manual', who: 'agent',
    instructions: 'Escreva a comunicação interna da renovação para o time: contrato, cliente, nova vigência, o que foi combinado e quem faz o quê a partir de agora.' },
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
    '• Dias de atraso: *{{atraso}}*\n' +
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

export const DEFAULT_OVERDUE_REPEAT_DAYS = 3

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
          areas: (Array.isArray(o.areas) ? o.areas : []).map(String).filter(k => areaKeys.has(k) || /^area:[0-9a-f-]{36}$/i.test(k)),
          // Passo "aviso ao cliente" (id antigo 'aviso') conclui sozinho quando o aviso é enviado
          done_when: o.done_when === 'client_notice' || (o.done_when === undefined && str(o.id, 40) === 'aviso') ? 'client_notice' as const : 'manual' as const,
          who: o.who === 'owner' || o.who === 'areas' || o.who === 'agent' ? o.who as RulerWho
            : (Array.isArray(o.areas) && (o.areas as unknown[]).some(a => /^area:/.test(String(a))) ? 'areas' as const : 'owner' as const),
          instructions: str(o.instructions, MAX_STEP_INSTRUCTIONS).trim(),
          requires_file: o.requires_file === true,
          with_previous: i > 0 && o.with_previous === true,
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
    overdue_repeat_days: (() => {
      const n = Math.round(Number(r.overdue_repeat_days))
      return r.overdue_repeat_days === undefined || r.overdue_repeat_days === null || !Number.isFinite(n) ? DEFAULT_OVERDUE_REPEAT_DAYS : Math.max(0, Math.min(30, n))
    })(),
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
    .map((s, i) => ({ ...s, with_previous: i > 0 && !!s.with_previous, due_date: dueDate(periodEnd, s.days_before), done_at: null, done_by: null, notified_at: null, overdue_notified_at: null }))
}

// Passos que estão "em andamento" agora (chegaram e não foram concluídos); se nenhum chegou, o 1º aberto
export function openStepIndexes(steps: Pick<RunStep, 'done_at' | 'notified_at'>[]): number[] {
  const arrived = steps.map((s, i) => (!s.done_at && s.notified_at ? i : -1)).filter(i => i >= 0)
  if (arrived.length) return arrived
  const first = steps.findIndex(s => !s.done_at)
  return first >= 0 ? [first] : []
}

// Grupo que começa em idx: o passo e os seguintes marcados "começa junto com o anterior"
export function stepGroup(steps: Pick<RunStep, 'done_at' | 'with_previous'>[], idx: number): number[] {
  const out = [idx]
  for (let j = idx + 1; j < steps.length && steps[j].with_previous; j++) if (!steps[j].done_at) out.push(j)
  return out
}

export const brDate = (iso: string | null | undefined) =>
  iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10).split('-').reverse().join('/') : '—'

export function isOverdue(step: RunStep, todayIso: string): boolean {
  return !step.done_at && !!step.due_date && step.due_date < todayIso
}

// Dias entre duas datas aaaa-mm-dd (b − a)
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b.slice(0, 10)}T12:00:00Z`) - Date.parse(`${a.slice(0, 10)}T12:00:00Z`)) / 86_400_000)
}

// Passo atrasado: avisa a 1ª vez e depois a cada N dias (N = 0: só uma vez)
export function shouldNotifyOverdue(step: RunStep, todayIso: string, repeatDays: number): boolean {
  if (!isOverdue(step, todayIso)) return false
  if (!step.overdue_notified_at) return true
  if (repeatDays <= 0) return false
  const last = new Date(new Date(step.overdue_notified_at).getTime() - 3 * 3600_000).toISOString().slice(0, 10)
  return daysBetween(last, todayIso) >= repeatDays
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
