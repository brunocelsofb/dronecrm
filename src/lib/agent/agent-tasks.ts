// ─── Tarefas dos agentes de IA (regras puras, sem banco) ─────────────────────
// Tarefas do sistema: rotinas que já existem (resumo do dia, avisos de vencimento...).
// O admin de cada empresa liga/desliga, escolhe os dias da semana e pausa até uma data
// (tabela agent_tasks). Sem linha na tabela = padrão abaixo, igual a antes.
// Tarefas escritas pelo admin: um pedido em texto que a IA do Théo da empresa roda nos
// dias marcados, só com consultas, e manda o resultado no WhatsApp.
// Tarefa nova do sistema: acrescente aqui e chame taskRunsToday(tenantId, key) na rotina.

export type AgentTaskKey = 'briefing' | 'renewal_alerts' | 'measurement_alerts' | 'ruler_overdue' | 'impl_report' | 'inactive_hunter'

export type AgentTaskDef = {
  key: AgentTaskKey
  agent: 'Resumo do dia' | 'Farmer' | 'Hunter'
  title: string
  description: string
  sends: string           // o que sai e para quem (mostrado na tela)
  feature: string         // aba do plano que libera a tarefa
  defaultDays: number[]   // 0 = domingo … 6 = sábado
}

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]
export const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const

export const AGENT_TASKS: AgentTaskDef[] = [
  { key: 'briefing', agent: 'Resumo do dia', title: 'Resumo do dia', feature: 'copiloto', defaultDays: [1, 2, 3, 4, 5],
    description: 'A IA escreve o resumo da carteira e dos novos negócios.',
    sends: 'WhatsApp do gestor, por volta das 7h' },
  { key: 'renewal_alerts', agent: 'Farmer', title: 'Avisos de vencimento (90, 60, 30, 15 dias e vencidos)', feature: 'copiloto', defaultDays: ALL_DAYS,
    description: 'Abre a atividade com a mensagem pronta para o responsável revisar e enviar ao cliente.',
    sends: 'Atividade ao responsável + resumo no WhatsApp e e-mail do gestor' },
  { key: 'measurement_alerts', agent: 'Farmer', title: 'Medições pendentes', feature: 'copiloto', defaultDays: ALL_DAYS,
    description: 'Lembra de lançar ou aprovar a medição do mês.',
    sends: 'Tarefa para quem cuida do contrato' },
  { key: 'ruler_overdue', agent: 'Farmer', title: 'Régua de renovação — passo atrasado', feature: 'copiloto', defaultDays: ALL_DAYS,
    description: 'Avisa as áreas responsáveis quando um passo da régua passa do prazo.',
    sends: 'E-mail às áreas cadastradas no passo' },
  { key: 'impl_report', agent: 'Farmer', title: 'Relatório mensal de implantação', feature: 'copiloto', defaultDays: ALL_DAYS,
    description: 'Uma vez por mês, a partir do dia configurado, pede o relatório das implantações.',
    sends: 'Tarefa para o responsável' },
  { key: 'inactive_hunter', agent: 'Hunter', title: 'Clientes inativos', feature: 'copiloto', defaultDays: [1],
    description: 'Resumo dos clientes sem compra e tarefas para recuperar.',
    sends: 'WhatsApp do gestor + tarefas aos responsáveis' },
]

export const isAgentTaskKey = (v: unknown): v is AgentTaskKey => AGENT_TASKS.some(t => t.key === v)
export const agentTaskDef = (key: AgentTaskKey) => AGENT_TASKS.find(t => t.key === key)!

export const MAX_CUSTOM_TASKS = 10
export const MAX_PROMPT_CHARS = 2000
export const MAX_TITLE_CHARS = 80

// Dias válidos, sem repetição e em ordem
export function normDays(v: unknown): number[] {
  if (!Array.isArray(v)) return []
  return [...new Set(v.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))].sort((a, b) => a - b)
}

export const isIsoDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`))

export type TaskRow = { enabled?: boolean | null; days?: unknown; paused_until?: string | null }
export type TaskState = { enabled: boolean; days: number[]; pausedUntil: string | null }

// Estado da tarefa do sistema: linha da empresa ou padrão
export function taskState(key: AgentTaskKey, row?: TaskRow | null): TaskState {
  if (!row) return { enabled: true, days: [...agentTaskDef(key).defaultDays], pausedUntil: null }
  return { enabled: row.enabled !== false, days: normDays(row.days), pausedUntil: isIsoDate(row.paused_until) ? row.paused_until : null }
}

// Dia da semana de uma data aaaa-mm-dd (0 = domingo)
export const weekdayOf = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay()
// Hoje em Brasília (aaaa-mm-dd)
export const todayBrIso = (now = Date.now()) => new Date(now - 3 * 3_600_000).toISOString().slice(0, 10)

// Pausa "até" a data inclusive: volta no dia seguinte
export function isPaused(s: Pick<TaskState, 'pausedUntil'>, today: string): boolean {
  return !!s.pausedUntil && s.pausedUntil >= today
}

export function runsOn(s: TaskState, today: string): boolean {
  return s.enabled && !isPaused(s, today) && s.days.includes(weekdayOf(today))
}

export function daysLabel(days: number[]): string {
  const d = normDays(days)
  if (d.length === 7) return 'todos os dias'
  if (d.length === 5 && [1, 2, 3, 4, 5].every(x => d.includes(x))) return 'segunda a sexta'
  if (!d.length) return 'nenhum dia'
  return d.map(x => WEEKDAYS[x]).join(', ')
}

// Situação para mostrar na tela
export function statusLabel(s: TaskState, today: string): string {
  if (!s.enabled) return 'Desligada'
  if (isPaused(s, today)) return `Pausada até ${s.pausedUntil!.split('-').reverse().join('/')}`
  if (!s.days.length) return 'Sem dias marcados'
  return `Ativa · ${daysLabel(s.days)}`
}

// Regras extras da IA numa tarefa agendada (não há pessoa para responder)
export const SCHEDULED_TASK_RULES = [
  'Esta é uma tarefa agendada: ninguém vai responder. Não faça perguntas; use as consultas e entregue o resultado.',
  'Só consulte: não proponha ações nem invente dados. Se faltar informação, diga o que faltou.',
  'A resposta vai por WhatsApp: texto curto, em tópicos, use *negrito* (um asterisco) e nada de tabelas ou markdown com #.',
].join('\n')

export function customTaskMessage(title: string, text: string): string {
  return `🤖 *${title.trim()}*\n\n${text.trim()}`.slice(0, 4000)
}
