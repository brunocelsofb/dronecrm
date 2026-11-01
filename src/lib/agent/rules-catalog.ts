// ─── Regras dos agentes: catálogo de critérios e ações (regras puras) ────────
// Cada empresa monta as próprias regras na tela Regras automáticas:
//   QUANDO [critério com número] E [condições] → FAÇA [ações] PARA [quem], nos dias marcados.
// Só o que está aqui o sistema sabe executar (nada de texto livre interpretado por IA):
// a frase da tela descreve exatamente o que a regra faz.
// Critério novo: acrescente aqui e ensine o motor a buscar (rules-engine.ts → findMatches).

export type RuleAgent = 'farmer' | 'hunter'
export type ConditionKind = 'pipeline' | 'stage' | 'min_value' | 'lead_source' | 'priority'

export type CriterionDef = {
  key: string
  agent: RuleAgent
  feature: string          // aba do plano que libera
  label: string            // como aparece no menu
  sentence: string         // frase com {n}: "oportunidade aberta sem atividade há {n} dias"
  unit: string
  min: number; max: number; def: number
  conditions: ConditionKind[]
  entity: 'oportunidade' | 'lead' | 'contrato' | 'pesquisa' | 'chamado'
  ownerLabel: string       // quem é o "responsável" neste critério
  explain: string          // regra clara: o que conta e quando volta a contar
}

export const RULE_CRITERIA: CriterionDef[] = [
  { key: 'opp_idle', agent: 'hunter', feature: 'pipeline', label: 'Oportunidade sem atividade',
    sentence: 'oportunidade aberta sem atividade há {n} dias', unit: 'dias', min: 1, max: 365, def: 10,
    conditions: ['pipeline', 'min_value'], entity: 'oportunidade', ownerLabel: 'Responsável da oportunidade',
    explain: 'Conta da última atividade registrada (ou da entrada no funil, se não houver). Se alguém registrar atividade, a contagem recomeça e a regra pode voltar a valer.' },
  { key: 'opp_stage_stuck', agent: 'hunter', feature: 'pipeline', label: 'Oportunidade parada na mesma etapa',
    sentence: 'oportunidade parada na mesma etapa há {n} dias', unit: 'dias', min: 1, max: 365, def: 15,
    conditions: ['pipeline', 'stage', 'min_value'], entity: 'oportunidade', ownerLabel: 'Responsável da oportunidade',
    explain: 'Conta desde a entrada na etapa atual. Mudou de etapa, a contagem recomeça.' },
  { key: 'proposal_waiting', agent: 'hunter', feature: 'propostas', label: 'Proposta aguardando resposta',
    sentence: 'proposta aguardando há {n} dias sem mudança', unit: 'dias', min: 1, max: 365, def: 7,
    conditions: ['min_value'], entity: 'oportunidade', ownerLabel: 'Responsável da oportunidade',
    explain: 'Propostas ainda não aprovadas pelo cliente, recusadas ou canceladas. Conta da última mudança na proposta.' },
  { key: 'lead_stale', agent: 'hunter', feature: 'leads', label: 'Lead sem andamento',
    sentence: 'lead novo ou em qualificação sem movimentação há {n} dias', unit: 'dias', min: 1, max: 180, def: 2,
    conditions: ['lead_source'], entity: 'lead', ownerLabel: 'Vendedor do lead',
    explain: 'Leads com situação "novo" ou "em qualificação". Qualquer alteração no lead recomeça a contagem.' },
  { key: 'contract_expiring', agent: 'farmer', feature: 'contracts', label: 'Contrato perto do vencimento',
    sentence: 'contrato vence em até {n} dias', unit: 'dias', min: 1, max: 365, def: 120,
    conditions: ['min_value'], entity: 'contrato', ownerLabel: 'Responsável do contrato',
    explain: 'Uma vez por vigência: se o contrato for renovado (novo vencimento), a regra volta a valer. Os avisos ao cliente (90/60/30/15) continuam em IA da empresa → Tarefas agendadas.' },
  { key: 'nps_low', agent: 'farmer', feature: 'surveys', label: 'Nota baixa no NPS',
    sentence: 'pesquisa NPS respondida com nota até {n}', unit: '(0 a 10)', min: 0, max: 10, def: 6,
    conditions: [], entity: 'pesquisa', ownerLabel: 'Responsável do contrato',
    explain: 'Respostas dos últimos 30 dias. Cada resposta vale uma vez só.' },
  { key: 'ticket_overdue', agent: 'farmer', feature: 'tickets', label: 'Chamado com prazo vencido',
    sentence: 'chamado aberto com prazo (SLA) vencido há {n} dias ou mais', unit: 'dias', min: 0, max: 90, def: 1,
    conditions: ['priority'], entity: 'chamado', ownerLabel: 'Responsável do chamado',
    explain: 'Chamados que não estão resolvidos nem fechados. Se o prazo for alterado, vale de novo.' },
]

export const criterionDef = (key: string) => RULE_CRITERIA.find(c => c.key === key) ?? null

export const CONDITION_LABEL: Record<ConditionKind, string> = {
  pipeline: 'Funil', stage: 'Etapa', min_value: 'Valor mínimo (R$)', lead_source: 'Origem do lead', priority: 'Prioridade do chamado',
}

// Opções fixas das condições (valores gravados no CRM → rótulo da tela)
export const LEAD_SOURCES: Record<string, string> = { indicacao: 'Indicação', evento: 'Evento', formulario_site: 'Site', ligacao: 'Ligação', anuncio: 'Anúncio', manual: 'Manual', whatsapp: 'WhatsApp', prospeccao: 'Prospecção', outro: 'Outro' }
export const TICKET_PRIORITIES: Record<string, string> = { muito_critica: 'Urgente', critica: 'Alta', pouco_critica: 'Baixa', nao_critica: 'Pode esperar' }

export type RuleConditions = { pipeline_id?: string | null; stage_id?: string | null; min_value?: number | null; lead_source?: string | null; priority?: string | null }

export type RuleActions = {
  task?: { enabled: boolean; title: string; text: string; due_days: number; assignee: 'owner' | string }
  notify?: { enabled: boolean; assignee: 'owner' | string; message: string }
  whatsapp?: { enabled: boolean; to: string | null }   // um resumo por rodada; vazio = gestor
}

export type RuleInput = {
  agent: RuleAgent; name: string; criterion: string; threshold: number
  conditions: RuleConditions; actions: RuleActions; days: number[]; enabled: boolean
}

export const MAX_RULES = 30
export const MAX_HITS_PER_RUN = 50

// Variáveis dos textos das ações
export const RULE_VARIABLES = [
  { key: 'nome', description: 'Cliente, lead ou assunto do chamado' },
  { key: 'dias', description: 'Dias contados pela regra' },
  { key: 'valor', description: 'Valor (R$), quando houver' },
  { key: 'etapa', description: 'Etapa do funil, quando houver' },
  { key: 'nota', description: 'Nota do NPS (regra de NPS)' },
]
export function renderRuleText(t: string, v: Record<string, string>): string {
  return t.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (k in v ? v[k] : m))
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isAssignee = (v: unknown) => v === 'owner' || (typeof v === 'string' && UUID.test(v))

// Confere a regra montada na tela; devolve a versão limpa (só campos que o critério aceita)
export function validateRule(raw: unknown, features: string[]): { rule: RuleInput } | { error: string } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const def = criterionDef(String(r.criterion ?? ''))
  if (!def) return { error: 'Escolha o critério.' }
  if (!features.includes(def.feature)) return { error: 'A licença não inclui este critério.' }
  const name = String(r.name ?? '').trim()
  if (!name) return { error: 'Dê um nome à regra.' }
  if (name.length > 80) return { error: 'Nome com até 80 caracteres.' }
  const n = Number(r.threshold)
  if (!Number.isInteger(n) || n < def.min || n > def.max) return { error: `Número do critério: de ${def.min} a ${def.max}.` }

  const c = (r.conditions && typeof r.conditions === 'object' ? r.conditions : {}) as Record<string, unknown>
  const cond: RuleConditions = {}
  for (const k of def.conditions) {
    if (k === 'pipeline' && c.pipeline_id) { if (!UUID.test(String(c.pipeline_id))) return { error: 'Funil inválido.' }; cond.pipeline_id = String(c.pipeline_id) }
    if (k === 'stage' && c.stage_id) { if (!UUID.test(String(c.stage_id))) return { error: 'Etapa inválida.' }; cond.stage_id = String(c.stage_id) }
    if (k === 'min_value' && c.min_value !== null && c.min_value !== undefined && c.min_value !== '') {
      const v = Number(c.min_value)
      if (!Number.isFinite(v) || v < 0) return { error: 'Valor mínimo inválido.' }
      cond.min_value = Math.round(v * 100) / 100
    }
    if (k === 'lead_source' && c.lead_source) { if (!(String(c.lead_source) in LEAD_SOURCES)) return { error: 'Origem inválida.' }; cond.lead_source = String(c.lead_source) }
    if (k === 'priority' && c.priority) { if (!(String(c.priority) in TICKET_PRIORITIES)) return { error: 'Prioridade inválida.' }; cond.priority = String(c.priority) }
  }
  if (cond.stage_id && !cond.pipeline_id) return { error: 'Para escolher a etapa, escolha antes o funil.' }

  const a = (r.actions && typeof r.actions === 'object' ? r.actions : {}) as Record<string, Record<string, unknown> | undefined>
  const actions: RuleActions = {}
  if (a.task?.enabled) {
    const title = String(a.task.title ?? '').trim()
    if (!title) return { error: 'Tarefa: escreva o título.' }
    if (title.length > 120) return { error: 'Tarefa: título com até 120 caracteres.' }
    const due = Number(a.task.due_days ?? 1)
    if (!Number.isInteger(due) || due < 0 || due > 60) return { error: 'Tarefa: prazo de 0 a 60 dias.' }
    if (!isAssignee(a.task.assignee)) return { error: 'Tarefa: escolha para quem.' }
    actions.task = { enabled: true, title, text: String(a.task.text ?? '').trim().slice(0, 1000), due_days: due, assignee: String(a.task.assignee) }
  }
  if (a.notify?.enabled) {
    if (!isAssignee(a.notify.assignee)) return { error: 'Aviso: escolha para quem.' }
    actions.notify = { enabled: true, assignee: String(a.notify.assignee), message: String(a.notify.message ?? '').trim().slice(0, 300) }
  }
  if (a.whatsapp?.enabled) {
    const to = String(a.whatsapp.to ?? '').replace(/\D/g, '')
    if (to && (to.length < 10 || to.length > 13)) return { error: 'WhatsApp inválido (DDD + número).' }
    actions.whatsapp = { enabled: true, to: to || null }
  }
  if (!actions.task && !actions.notify && !actions.whatsapp) return { error: 'Marque pelo menos uma ação.' }

  const days = Array.isArray(r.days) ? [...new Set((r.days as unknown[]).map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort((x, y) => x - y) : []
  if (!days.length) return { error: 'Marque pelo menos um dia.' }
  return { rule: { agent: def.agent, name, criterion: def.key, threshold: n, conditions: cond, actions, days, enabled: r.enabled !== false } }
}

// Frase completa da regra, para a pessoa ler exatamente o que acontece
export function ruleSentence(r: Pick<RuleInput, 'criterion' | 'threshold' | 'conditions' | 'actions'>, names: { pipeline?: string; stage?: string; person?: (id: string) => string; fmtBRL?: (v: number) => string } = {}): string {
  const def = criterionDef(r.criterion)
  if (!def) return 'Critério desconhecido.'
  const who = (a: string) => (a === 'owner' ? def.ownerLabel.toLowerCase() : names.person?.(a) ?? 'pessoa escolhida')
  const conds: string[] = []
  if (r.conditions.pipeline_id) conds.push(`no funil ${names.pipeline ?? 'escolhido'}`)
  if (r.conditions.stage_id) conds.push(`na etapa ${names.stage ?? 'escolhida'}`)
  if (r.conditions.min_value != null) conds.push(`com valor a partir de ${names.fmtBRL ? names.fmtBRL(r.conditions.min_value) : `R$ ${r.conditions.min_value}`}`)
  if (r.conditions.lead_source) conds.push(`com origem ${LEAD_SOURCES[r.conditions.lead_source] ?? r.conditions.lead_source}`)
  if (r.conditions.priority) conds.push(`com prioridade ${TICKET_PRIORITIES[r.conditions.priority] ?? r.conditions.priority}`)
  const acts: string[] = []
  if (r.actions.task?.enabled) acts.push(`abrir a tarefa "${r.actions.task.title}" para ${who(r.actions.task.assignee)} (prazo ${r.actions.task.due_days === 0 ? 'hoje' : `${r.actions.task.due_days} dia(s)`})`)
  if (r.actions.notify?.enabled) acts.push(`avisar ${who(r.actions.notify.assignee)} no sino do CRM`)
  if (r.actions.whatsapp?.enabled) acts.push(`mandar a lista no WhatsApp ${r.actions.whatsapp.to ? `(${r.actions.whatsapp.to})` : 'do gestor'}`)
  const quando = def.sentence.replace('{n}', String(r.threshold))
  return `QUANDO ${quando}${conds.filter(Boolean).length ? ` ${conds.filter(Boolean).join(' e ')}` : ''} → ${acts.join('; ') || 'nenhuma ação'}.`
}

// Regras sugeridas para começar (a empresa ativa, edita ou apaga)
export function suggestedRules(features: string[]): RuleInput[] {
  const all = [1, 2, 3, 4, 5]
  const base: RuleInput[] = [
    { agent: 'hunter', name: 'Retomar oportunidade parada', criterion: 'opp_idle', threshold: 10, conditions: {}, days: all, enabled: false,
      actions: { task: { enabled: true, title: 'Retomar contato — {{nome}}', text: 'Sem atividade há {{dias}} dias (etapa {{etapa}}, valor {{valor}}). Registre o próximo passo.', due_days: 1, assignee: 'owner' } } },
    { agent: 'hunter', name: 'Lead sem contato', criterion: 'lead_stale', threshold: 2, conditions: {}, days: all, enabled: false,
      actions: { task: { enabled: true, title: 'Fazer contato com o lead — {{nome}}', text: 'Lead sem movimentação há {{dias}} dias.', due_days: 0, assignee: 'owner' } } },
    { agent: 'hunter', name: 'Proposta sem resposta', criterion: 'proposal_waiting', threshold: 7, conditions: {}, days: all, enabled: false,
      actions: { task: { enabled: true, title: 'Cobrar retorno da proposta — {{nome}}', text: 'Proposta de {{valor}} aguardando há {{dias}} dias.', due_days: 1, assignee: 'owner' } } },
    { agent: 'farmer', name: 'NPS baixo', criterion: 'nps_low', threshold: 6, conditions: {}, days: all, enabled: false,
      actions: { task: { enabled: true, title: 'Ligar para o cliente — NPS baixo ({{nome}})', text: 'Nota {{nota}} na pesquisa. Entenda o motivo e registre um plano de ação.', due_days: 1, assignee: 'owner' }, whatsapp: { enabled: true, to: null } } },
    { agent: 'farmer', name: 'Chamado atrasado', criterion: 'ticket_overdue', threshold: 1, conditions: {}, days: all, enabled: false,
      actions: { notify: { enabled: true, assignee: 'owner', message: 'Chamado {{nome}} com prazo vencido há {{dias}} dia(s).' }, whatsapp: { enabled: true, to: null } } },
  ]
  return base.filter(r => features.includes(criterionDef(r.criterion)!.feature))
}
