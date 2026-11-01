// ─── Tarefas dos agentes de IA (regras puras, sem banco) ─────────────────────
// Tarefas do sistema: rotinas que já existem (resumo do dia, avisos de vencimento...).
// O admin de cada empresa liga/desliga, escolhe os dias da semana e pausa até uma data
// (tabela agent_tasks). Sem linha na tabela = padrão abaixo, igual a antes.
// Tarefas escritas pelo admin: um pedido em texto que a IA do Théo da empresa roda nos
// dias marcados, só com consultas, e manda o resultado no WhatsApp.
// Tarefa nova do sistema: acrescente aqui e chame taskRunsToday(tenantId, key) na rotina.

export type AgentTaskKey = 'briefing' | 'renewal_alerts' | 'measurement_alerts' | 'ruler_overdue' | 'impl_report' | 'inactive_hunter'

// Prazo/data editável na própria tela (gravado onde a rotina já lê; ver agent-tasks-server)
export type TaskParam = { key: string; label: string; unit: string; min: number; max: number; def: number }

export type AgentTaskDef = {
  key: AgentTaskKey
  agent: 'Resumo do dia' | 'Farmer' | 'Hunter'
  title: string
  description: string
  sends: string           // o que sai e para quem (mostrado na tela)
  feature: string         // aba do plano que libera a tarefa
  defaultDays: number[]   // 0 = domingo … 6 = sábado
  params?: TaskParam[]
  // Destinatários editáveis: assignee = quem faz a tarefa aberta; whatsapp/email = quem recebe o resumo
  recipients?: ('assignee' | 'whatsapp' | 'email')[]
  assigneeDefault?: string  // texto do padrão (ex.: "Responsável do contrato")
  monthly?: boolean         // roda uma vez por mês (mostra o dia do mês em vez dos dias da semana)
  recipientsNote?: string   // quando os destinatários ficam em outra tela
}

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]
export const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const

export const AGENT_TASKS: AgentTaskDef[] = [
  { key: 'briefing', agent: 'Resumo do dia', title: 'Resumo do dia', feature: 'copiloto', defaultDays: [1, 2, 3, 4, 5],
    description: 'A IA escreve o resumo da carteira e dos novos negócios.',
    sends: 'WhatsApp do gestor, por volta das 7h', recipients: ['whatsapp'] },
  { key: 'renewal_alerts', agent: 'Farmer', title: 'Avisos de vencimento', feature: 'copiloto', defaultDays: ALL_DAYS,
    description: 'Abre a atividade com a mensagem pronta para o responsável revisar e enviar ao cliente (e depois do vencimento).',
    sends: 'Atividade ao responsável + resumo no WhatsApp e e-mail do gestor',
    recipients: ['assignee', 'whatsapp', 'email'], assigneeDefault: 'Responsável do contrato',
    params: [
      { key: 'prep', label: 'Preparar a renovação', unit: 'dias antes', min: 1, max: 365, def: 90 },
      { key: 'a1', label: '1º aviso ao cliente', unit: 'dias antes', min: 1, max: 365, def: 60 },
      { key: 'a2', label: '2º aviso', unit: 'dias antes', min: 1, max: 365, def: 30 },
      { key: 'a3', label: 'Aviso urgente', unit: 'dias antes', min: 1, max: 365, def: 15 },
    ] },
  { key: 'measurement_alerts', agent: 'Farmer', title: 'Medições pendentes', feature: 'copiloto', defaultDays: ALL_DAYS,
    description: 'Lembra de lançar ou aprovar a medição do mês.',
    sends: 'Tarefa para quem cuida do contrato', monthly: true,
    recipients: ['assignee'], assigneeDefault: 'Quem cuida do contrato',
    params: [{ key: 'due_day', label: 'Medição vence no dia', unit: 'do mês', min: 1, max: 28, def: 5 }] },
  { key: 'ruler_overdue', agent: 'Farmer', title: 'Régua de renovação — passo atrasado', feature: 'copiloto', defaultDays: ALL_DAYS,
    description: 'Avisa as áreas responsáveis quando um passo da régua passa do prazo.',
    sends: 'E-mail às áreas cadastradas no passo',
    recipientsNote: 'Os e-mails de cada área ficam em Configurações → Régua de renovação.',
    params: [{ key: 'repeat_days', label: 'Repetir o aviso a cada', unit: 'dias (0 = só uma vez)', min: 0, max: 30, def: 3 }] },
  { key: 'impl_report', agent: 'Farmer', title: 'Relatório mensal de implantação', feature: 'copiloto', defaultDays: ALL_DAYS,
    description: 'Uma vez por mês, a partir do dia configurado, pede o relatório das implantações.',
    sends: 'Tarefa para o responsável', monthly: true,
    recipients: ['assignee'], assigneeDefault: 'Primeiro administrador',
    params: [{ key: 'report_day', label: 'A partir do dia', unit: 'do mês', min: 1, max: 28, def: 5 }] },
  { key: 'inactive_hunter', agent: 'Hunter', title: 'Clientes inativos', feature: 'copiloto', defaultDays: [1],
    description: 'Resumo dos clientes sem compra e tarefas para recuperar.',
    sends: 'WhatsApp do gestor + tarefas aos responsáveis',
    recipients: ['assignee', 'whatsapp'], assigneeDefault: 'Responsável pela empresa',
    params: [{ key: 'inactive_months', label: 'Inativo sem compra há', unit: 'meses', min: 1, max: 60, def: 12 }] },
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

// Confere os prazos digitados (inteiros dentro do limite de cada campo)
export function checkParams(def: AgentTaskDef, values: Record<string, unknown>): { values: Record<string, number> } | { error: string } {
  const out: Record<string, number> = {}
  for (const p of def.params ?? []) {
    const n = Number(values[p.key])
    if (!Number.isInteger(n) || n < p.min || n > p.max) return { error: `${p.label}: use de ${p.min} a ${p.max}.` }
    out[p.key] = n
  }
  return { values: out }
}

// ─── Destinatários e escolhas de cada tarefa (agent_tasks.options) ──────────
export type TaskOptions = {
  assignee?: string | null          // perfil que faz a tarefa (vazio = padrão da tarefa)
  notify_whatsapp?: string | null   // número que recebe o resumo (vazio = gestor)
  notify_email?: string | null      // e-mail que recebe o resumo (vazio = gestor)
  briefing_sections?: string[]      // o que aparece no resumo do dia
  briefing_extra?: string | null    // pedido extra no resumo do dia
}

// O que pode aparecer no resumo do dia (dados que a IA recebe e blocos que ela escreve)
export const BRIEFING_SECTIONS: { key: string; label: string; group: 'dados' | 'blocos' }[] = [
  { key: 'oportunidades', label: 'Oportunidades paradas no funil', group: 'dados' },
  { key: 'renovacoes', label: 'Contratos a vencer e vencidos', group: 'dados' },
  { key: 'leads', label: 'Leads sem qualificação', group: 'dados' },
  { key: 'propostas', label: 'Propostas paradas', group: 'dados' },
  { key: 'planos', label: 'Planos de ação com itens pendentes', group: 'dados' },
  { key: 'indicadores', label: 'Indicadores do mês', group: 'dados' },
  { key: 'avisos', label: 'Avisos de renovação enviados e aguardando', group: 'dados' },
  { key: 'urgentes', label: 'Top 3 ações urgentes', group: 'blocos' },
  { key: 'oportunidade', label: 'Maior oportunidade', group: 'blocos' },
  { key: 'alerta', label: 'Sinal de alerta', group: 'blocos' },
  { key: 'saude', label: 'Saúde do funil (números)', group: 'blocos' },
]
export const ALL_BRIEFING_SECTIONS = BRIEFING_SECTIONS.map(s => s.key)
export const MAX_BRIEFING_EXTRA = 1000

// Seções ligadas: sem escolha salva = todas (igual a antes)
export function briefingSections(o: TaskOptions | null | undefined): Set<string> {
  const list = Array.isArray(o?.briefing_sections) ? o!.briefing_sections!.filter(k => ALL_BRIEFING_SECTIONS.includes(k)) : null
  return new Set(list ?? ALL_BRIEFING_SECTIONS)
}

export const cleanPhone = (v: unknown) => String(v ?? '').replace(/\D/g, '')
export const isPhone = (d: string) => d.length >= 10 && d.length <= 13
export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Confere e limpa o que o admin mandou (só os campos que a tarefa aceita)
export function checkOptions(def: AgentTaskDef, raw: unknown): { options: TaskOptions } | { error: string } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const allow = new Set(def.recipients ?? [])
  const out: TaskOptions = {}
  if (allow.has('assignee')) {
    const a = String(r.assignee ?? '').trim()
    if (a && !UUID.test(a)) return { error: 'Pessoa inválida.' }
    out.assignee = a || null
  }
  if (allow.has('whatsapp')) {
    const p = cleanPhone(r.notify_whatsapp)
    if (p && !isPhone(p)) return { error: 'WhatsApp inválido (DDD + número).' }
    out.notify_whatsapp = p || null
  }
  if (allow.has('email')) {
    const e = String(r.notify_email ?? '').trim().toLowerCase()
    if (e && !isEmail(e)) return { error: 'E-mail inválido.' }
    out.notify_email = e || null
  }
  if (def.key === 'briefing') {
    const list = Array.isArray(r.briefing_sections) ? [...new Set(r.briefing_sections.map(String))].filter(k => ALL_BRIEFING_SECTIONS.includes(k)) : ALL_BRIEFING_SECTIONS
    if (!list.some(k => BRIEFING_SECTIONS.find(s => s.key === k)?.group === 'dados') && !String(r.briefing_extra ?? '').trim()) {
      return { error: 'Deixe pelo menos um assunto marcado ou escreva o que quer ver.' }
    }
    out.briefing_sections = list
    const extra = String(r.briefing_extra ?? '').trim()
    if (extra.length > MAX_BRIEFING_EXTRA) return { error: `Pedido extra com até ${MAX_BRIEFING_EXTRA} caracteres.` }
    out.briefing_extra = extra || null
  }
  return { options: out }
}

export function readOptions(raw: unknown): TaskOptions {
  return (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as TaskOptions
}

// Tarefa escrita mensal: roda só no dia do mês (1 a 28); sem dia = dias da semana
export const isMonthDay = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 28
export function customRunsOn(s: TaskState & { monthDay?: number | null }, today: string): boolean {
  if (isMonthDay(s.monthDay)) return s.enabled && !isPaused(s, today) && Number(today.slice(8, 10)) === s.monthDay
  return runsOn(s, today)
}
export function customStatusLabel(s: TaskState & { monthDay?: number | null }, today: string): string {
  if (!isMonthDay(s.monthDay)) return statusLabel(s, today)
  if (!s.enabled) return 'Desligada'
  if (isPaused(s, today)) return statusLabel(s, today)
  return `Ativa · todo dia ${s.monthDay} do mês`
}
