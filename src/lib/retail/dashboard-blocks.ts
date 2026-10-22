// Blocos do Painel do Varejo: a empresa escolhe quais aparecem e em que ordem
// (organization_settings.retail_settings.dashboard). Vale para qualquer empresa com o Varejo.

export const DASHBOARD_BLOCKS = [
  { id: 'vendas', title: 'Vendas do mês', text: 'Quanto vendeu, quantos pedidos e o valor médio, comparado ao mês passado.' },
  { id: 'equilibrio', title: 'Ponto de equilíbrio', text: 'Quanto dos custos fixos o mês já pagou e quanto falta vender.' },
  { id: 'ganho', title: 'Ganho e margem', text: 'Quanto sobrou das vendas depois do custo das peças, impostos e taxas.' },
  { id: 'pedidos_abertos', title: 'Pedidos esperando', text: 'Pedidos em atendimento ou aguardando pagamento, do mais antigo ao mais novo.' },
  { id: 'aniversarios', title: 'Aniversariantes', text: 'Quem faz aniversário hoje e nos próximos 7 dias, com o parabéns pronto.' },
  { id: 'inativas', title: 'Clientes para reativar', text: 'Clientes inativas que mais compraram: as melhores para chamar de volta.' },
  { id: 'mais_vendidas', title: 'Mais vendidas', text: 'As peças que mais saíram no mês.' },
  { id: 'estoque', title: 'Estoque', text: 'Peças publicadas que esgotaram e combinações com 1 unidade.' },
  { id: 'fidelidade', title: 'Fidelidade', text: 'Cashback gerado e usado no mês, créditos vencendo e clientes com desconto disponível.' },
  { id: 'sem_custo', title: 'Peças sem custo', text: 'Peças publicadas sem custo cadastrado: a margem delas fica incompleta.' },
] as const

export type DashboardBlockId = (typeof DASHBOARD_BLOCKS)[number]['id']
export const DEFAULT_BLOCKS: DashboardBlockId[] = DASHBOARD_BLOCKS.map(b => b.id)

export function isBlockId(v: unknown): v is DashboardBlockId {
  return DASHBOARD_BLOCKS.some(b => b.id === v)
}

// Lista salva (ordem e quais estão ligados). Sem configuração: todos, na ordem padrão.
export function readDashboardBlocks(raw: unknown): DashboardBlockId[] {
  if (!Array.isArray(raw)) return DEFAULT_BLOCKS
  const seen = new Set<string>()
  return raw.filter(v => isBlockId(v) && !seen.has(v) && (seen.add(v), true)) as DashboardBlockId[]
}
