// Prioridade do atendimento — 4 níveis leves, sem "média", com os
// prazos reais de SLA que vocês usam. A Matriz GUT foi removida do
// módulo (fica só o prazo de resolução mesmo).

export type PriorityTier = 'nao_critica' | 'pouco_critica' | 'critica' | 'muito_critica'

export const PRIORITY_LABELS: Record<PriorityTier, string> = {
  nao_critica: 'Melhoria / Pode esperar',
  pouco_critica: 'Baixa',
  critica: 'Alta',
  muito_critica: 'Urgente',
}

// Prazo real de SLA de vocês (em dias).
export const PRIORITY_SLA_DAYS: Record<PriorityTier, number> = {
  nao_critica: 7,
  pouco_critica: 3,
  critica: 2,
  muito_critica: 1,
}

export const PRIORITY_ORDER: PriorityTier[] = ['muito_critica', 'critica', 'pouco_critica', 'nao_critica']

// Prazo por prioridade da empresa (organization_settings.ticket_sla_days); inválido/vazio = padrão
export function resolveSlaDays(raw: unknown): Record<PriorityTier, number> {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out = { ...PRIORITY_SLA_DAYS }
  for (const k of PRIORITY_ORDER) {
    const n = Number(r[k])
    if (Number.isInteger(n) && n >= 1 && n <= 90) out[k] = n
  }
  return out
}

export function validateSlaDays(raw: unknown): { days: Record<PriorityTier, number> } | { error: string } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out = {} as Record<PriorityTier, number>
  for (const k of PRIORITY_ORDER) {
    const n = Number(r[k])
    if (!Number.isInteger(n) || n < 1 || n > 90) return { error: `${PRIORITY_LABELS[k]}: use de 1 a 90 dias.` }
    out[k] = n
  }
  return { days: out }
}

// Categorias do chamado — só pra classificar/filtrar, sem cálculo por
// trás.
export const GRAVITY_CATEGORIES: { value: string; label: string }[] = [
  { value: 'elogio_sugestao_duvida', label: 'Elogio, sugestão ou dúvida' },
  { value: 'reclamacao_qualidade', label: 'Reclamação sobre qualidade do serviço' },
  { value: 'erro_servico', label: 'Erro no serviço' },
  { value: 'atendimento_insatisfatorio', label: 'Atendimento insatisfatório' },
  { value: 'falha_recorrente', label: 'Reincidência de falha já reportada antes' },
  { value: 'nao_atendimento_contrato', label: 'Não atendimento ao contrato' },
  { value: 'atraso_entrega', label: 'Atraso na entrega do serviço' },
  { value: 'outro', label: 'Outro assunto (justificar na descrição)' },
]
