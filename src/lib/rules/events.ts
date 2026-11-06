// ─── Central de regras: o que acontece sozinho em cada EVENTO (regras puras) ──
// Ganho, perda, renovação e início da implantação. Antes ficavam escondidas no código;
// agora cada empresa liga ou desliga (agent_tasks, task_key = 'evt:<chave>'; sem linha = ligada).
// Ação nova num evento: acrescente aqui e confira eventOn(tenantId, chave) antes de executar.

export type EventKey =
  | 'won_internal_email' | 'won_impl_kickoff' | 'avulso_billing'
  | 'renewal_confirmation' | 'renewal_internal_email' | 'renewal_ruler_close'
  | 'lost_decline_proposals' | 'impl_followup' | 'proposal_approved_task' | 'tech_review_task'

export type EventDef = {
  key: EventKey
  when: 'analise' | 'aprovacao' | 'ganho' | 'renovado' | 'perdido' | 'implantacao'
  who: 'farmer' | 'hunter' | null       // agente que executa; null = ação simples do sistema
  sentence: string                        // QUANDO … → FAÇA …
  detail: string
  feature: string
  editHref?: string                       // textos e destinatários editados em outra tela
}

export const EVENT_WHEN_LABEL: Record<EventDef['when'], string> = {
  analise: 'Ao enviar a proposta para análise técnica',
  aprovacao: 'Quando o cliente aprova a proposta',
  ganho: 'Ao dar ganho (funil de vendas)', renovado: 'Ao marcar Renovado (gestão de contratos)',
  perdido: 'Ao dar perda', implantacao: 'Ao iniciar o cronograma de implantação',
}

export const EVENT_ACTIONS: EventDef[] = [
  { key: 'tech_review_task', when: 'analise', who: 'hunter', feature: 'pipeline',
    sentence: 'Proposta enviada para análise técnica → tarefa em Atividades para cada aprovador técnico, com o link do dimensionamento',
    detail: 'Sem valores: o aprovador técnico vê só o dimensionamento (equipamentos, equipe, escopo, SLA). A tarefa se fecha sozinha quando a proposta é aprovada ou reprovada tecnicamente.' },
  { key: 'proposal_approved_task', when: 'aprovacao', who: 'hunter', feature: 'pipeline',
    sentence: 'Cliente aprovou a proposta → tarefa em Atividades para o responsável dar o ganho (ou marcar Renovado, na renovação)',
    detail: 'O ganho continua com o consultor. A tarefa traz a proposta e o valor aprovado e se fecha sozinha quando o ganho (ou Renovado) é dado. Na renovação quem avisa é o Farmer.' },
  { key: 'won_internal_email', when: 'ganho', who: 'farmer', feature: 'pipeline', editHref: '/settings/copiloto?tab=interno',
    sentence: 'Ganho → e-mail interno ao time (contrato fechado) pronto para o responsável revisar e enviar',
    detail: 'Sem valores: só cliente, número e período. Destinatários e texto em Configurações → Agentes IA → Interno.' },
  { key: 'won_impl_kickoff', when: 'ganho', who: 'farmer', feature: 'pipeline', editHref: '/settings/copiloto?tab=interno',
    sentence: 'Ganho → tarefa "Acionar time técnico para a implantação" para o responsável',
    detail: 'Iniciar a implantação no CRM, informações de acompanhamento e tabela de aplicabilidade.' },
  { key: 'avulso_billing', when: 'ganho', who: null, feature: 'financeiro',
    sentence: 'Ganho de serviço avulso → envia para o faturamento sozinho',
    detail: 'Sem validação mensal. Se falhar, fica um aviso na oportunidade para enviar pela tela Financeiro.' },
  { key: 'renewal_confirmation', when: 'renovado', who: 'farmer', feature: 'pipeline', editHref: '/settings/copiloto',
    sentence: 'Renovado → mensagem de confirmação do novo período ao cliente, para o responsável revisar e enviar',
    detail: 'Nada vai ao cliente sem a pessoa revisar. Texto em Configurações → Agentes IA (renovação concluída).' },
  { key: 'renewal_internal_email', when: 'renovado', who: 'farmer', feature: 'pipeline', editHref: '/settings/copiloto?tab=interno',
    sentence: 'Renovado → e-mail interno ao time (contrato renovado) pronto para revisar e enviar',
    detail: 'Sem valores. Destinatários e texto em Configurações → Agentes IA → Interno.' },
  { key: 'renewal_ruler_close', when: 'renovado', who: null, feature: 'pipeline',
    sentence: 'Renovado → encerra a régua de renovação (perda/rescisão → cancela a régua)',
    detail: 'Mantém a régua em dia: sem isso, os passos continuariam cobrando depois do fechamento.' },
  { key: 'lost_decline_proposals', when: 'perdido', who: null, feature: 'pipeline',
    sentence: 'Perda → propostas em andamento da oportunidade passam para "declinada"',
    detail: 'Rascunhos e propostas já recusadas não mudam.' },
  { key: 'impl_followup', when: 'implantacao', who: 'farmer', feature: 'pipeline', editHref: '/settings/copiloto?tab=interno',
    sentence: 'Cronograma iniciado → tarefas "acompanhar a evolução" (+30 dias) e "pedir o relatório final" (fim do prazo)',
    detail: 'Encerra a tarefa de acionar o time técnico. Prazo médio da implantação em Configurações → Agentes IA → Interno.' },
]

export const eventTaskKey = (k: EventKey) => `evt:${k}`
export const isEventKey = (v: unknown): v is EventKey => EVENT_ACTIONS.some(e => e.key === v)
