// ─── Central de regras: organização por tema (regras puras) ──────────────────
// Tudo o que roda sozinho fica num lugar só, por assunto. Cada item diz quem executa:
//   agente de IA (Farmer/Hunter, com tarefa, aviso ou mensagem) ou ação simples do sistema (sem IA).
// Tema novo ou item novo: acrescente aqui e na página /regras.

export type ThemeKey = 'renovacao' | 'funil' | 'leads' | 'carteira' | 'atendimento' | 'envios'

export type Theme = {
  key: ThemeKey
  label: string
  intro: string
  features: string[]        // aparece se a licença tiver pelo menos uma destas abas
  tasks: string[]           // tarefas do sistema (agent_tasks) deste tema
  criteria: string[]        // critérios das regras dos agentes deste tema
}

export const THEMES: Theme[] = [
  { key: 'renovacao', label: 'Renovação', features: ['pipeline', 'contracts', 'copiloto'],
    intro: 'Tudo o que acontece com o contrato até o vencimento: volta para a etapa de renovação, avisos ao cliente, régua interna e tarefas.',
    tasks: ['renewal_alerts', 'ruler_overdue'], criteria: ['contract_expiring'] },
  { key: 'funil', label: 'Funil', features: ['pipeline'],
    intro: 'Prazos das etapas, automações por evento (entrou na etapa, ganhou, perdeu, tag) e oportunidades ou propostas paradas.',
    tasks: [], criteria: ['opp_idle', 'opp_stage_stuck', 'proposal_waiting'] },
  { key: 'leads', label: 'Leads', features: ['leads'],
    intro: 'Pontuação, distribuição dos leads novos e leads sem andamento.',
    tasks: [], criteria: ['lead_stale'] },
  { key: 'carteira', label: 'Carteira', features: ['carteira', 'companies', 'copiloto', 'surveys', 'contracts'],
    intro: 'Medições, implantações, clientes inativos, curva ABC e satisfação.',
    tasks: ['measurement_alerts', 'impl_report', 'inactive_hunter'], criteria: ['nps_low'] },
  { key: 'atendimento', label: 'Atendimento', features: ['tickets'],
    intro: 'Prazo dos chamados por prioridade e chamados atrasados.',
    tasks: [], criteria: ['ticket_overdue'] },
  { key: 'envios', label: 'Envios da IA', features: ['copiloto'],
    intro: 'Resumo do dia e tarefas que você escreve para a IA rodar nos dias marcados.',
    tasks: ['briefing'], criteria: [] },
]

export const isThemeKey = (v: unknown): v is ThemeKey => THEMES.some(t => t.key === v)
export const themesFor = (features: string[]) => THEMES.filter(t => t.features.some(f => features.includes(f)))
