// ─── Théo: catálogo de IAs e de ferramentas (regras puras, sem banco) ─────────
// Cada empresa liga a própria IA (Anthropic, OpenAI ou Gemini) e paga o uso.
// Cada ferramenta pertence a uma aba do sistema (feature): só aparece para a empresa
// cuja licença tem a aba E cujo plano inclui a ferramenta (Super Admin → Planos e abas).
// Testes: tests/theo-catalog.test.mjs

export type TheoProvider = 'anthropic' | 'openai' | 'gemini'

// Preços aproximados em US$ por 1 milhão de tokens (entrada / saída), conferidos em 01/11/2026 nos
// sites das empresas. Mudam com o tempo: o custo mostrado é estimativa; a cobrança real vem da conta de IA.
export type TheoModel = { id: string; label: string; input: number; output: number; from?: { date: string; input: number; output: number } }
export const THEO_PROVIDERS: { id: TheoProvider; label: string; keyUrl: string; keyHelp: string; models: TheoModel[] }[] = [
  {
    id: 'anthropic', label: 'Anthropic (Claude)', keyUrl: 'https://console.anthropic.com/settings/keys',
    keyHelp: 'Entre no console da Anthropic com a conta da empresa, crie a chave (API key) e cole aqui. O uso é cobrado na conta da Anthropic da empresa.',
    models: [
      { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (econômico)', input: 0.10, output: 0.50 },
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (mais capaz)', input: 2, output: 10 },
    ],
  },
  {
    id: 'openai', label: 'OpenAI (ChatGPT)', keyUrl: 'https://platform.openai.com/api-keys',
    keyHelp: 'Entre na plataforma da OpenAI com a conta da empresa, crie a chave (API key) e cole aqui. A assinatura do ChatGPT não inclui a API: o uso é cobrado à parte na conta da OpenAI.',
    models: [
      { id: 'gpt-6-luna', label: 'GPT-6 Luna (econômico)', input: 0.10, output: 0.50 },
      { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra (intermediário)', input: 1, output: 5 },
      { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol (mais capaz)', input: 2, output: 10 },
    ],
  },
  {
    id: 'gemini', label: 'Google Gemini', keyUrl: 'https://aistudio.google.com/apikey',
    keyHelp: 'Entre no Google AI Studio com a conta Google da empresa, crie a chave (API key) e cole aqui. O uso é cobrado na conta do Google da empresa.',
    models: [
      { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite (econômico)', input: 0.10, output: 0.40 },
      { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite', input: 0.25, output: 1.50 },
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash (mais capaz)', input: 0.75, output: 3.75, from: { date: '2027-01-01', input: 1.50, output: 7.50 } },
    ],
  },
]
export const isTheoProvider = (v: unknown): v is TheoProvider => v === 'anthropic' || v === 'openai' || v === 'gemini'
export const providerOf = (p: TheoProvider) => THEO_PROVIDERS.find(x => x.id === p)!
export const defaultTheoModel = (p: TheoProvider) => providerOf(p).models[0].id
export const isTheoModel = (p: TheoProvider, m: unknown) => providerOf(p).models.some(x => x.id === m)

// Custo estimado (US$) de uma chamada, pelo preço vigente no dia
export function estimateCostUsd(p: TheoProvider, modelId: string, tokensIn: number, tokensOut: number, when: Date = new Date()): number {
  const m = providerOf(p).models.find(x => x.id === modelId)
  if (!m) return 0
  const price = m.from && when.toISOString().slice(0, 10) >= m.from.date ? m.from : m
  return (Math.max(0, tokensIn) / 1e6) * price.input + (Math.max(0, tokensOut) / 1e6) * price.output
}

// ─── Ferramentas ─────────────────────────────────────────────────────────────
// feature: aba do plano que a ferramenta exige ('*' = toda licença com o Théo)
// kind: consulta (lê e responde) ou acao (só depois que a pessoa confirma na tela)
export type ParamSchema = { type: 'object'; properties: Record<string, { type: 'string' | 'number' | 'integer' | 'boolean'; description: string; enum?: string[] }>; required?: string[] }
export type TheoTool = { name: string; feature: string; kind: 'consulta' | 'acao'; group: string; label: string; description: string; params: ParamSchema }

const p = (properties: ParamSchema['properties'], required: string[] = []): ParamSchema => ({ type: 'object', properties, required })
const S = (description: string, extra: { enum?: string[] } = {}) => ({ type: 'string' as const, description, ...extra })
const N = (description: string) => ({ type: 'integer' as const, description })

export const THEO_TOOLS: TheoTool[] = [
  // Agenda (toda licença)
  { name: 'minhas_atividades', feature: '*', kind: 'consulta', group: 'Agenda', label: 'Minhas atividades de hoje e atrasadas',
    description: 'Lista as atividades planejadas da pessoa que está conversando: as de hoje e as atrasadas.', params: p({}) },
  { name: 'criar_atividade', feature: '*', kind: 'acao', group: 'Agenda', label: 'Criar atividade com responsável e data',
    description: 'Cria uma atividade planejada numa oportunidade ou empresa. Use search_* antes para achar o ID. Responsável pelo nome (opcional; padrão: quem pediu).',
    params: p({ oportunidade_id: S('ID da oportunidade (ou deixe vazio e informe empresa_id)'), empresa_id: S('ID da empresa (se não for oportunidade)'), titulo: S('Título curto'), descricao: S('Detalhes'), data: S('Data no formato AAAA-MM-DD'), responsavel: S('Nome de quem vai fazer (opcional)'), tipo: S('Tipo', { enum: ['task', 'call', 'meeting', 'email', 'whatsapp', 'reminder'] }) }, ['titulo', 'data']) },

  // Funil
  { name: 'search_contracts', feature: 'pipeline', kind: 'consulta', group: 'Funil', label: 'Buscar oportunidades',
    description: 'Busca oportunidades pelo nome do cliente ou número. Use para achar o ID antes de qualquer ação.', params: p({ query: S('Nome do cliente ou número (parcial)') }, ['query']) },
  { name: 'get_contract_details', feature: 'pipeline', kind: 'consulta', group: 'Funil', label: 'Detalhes de uma oportunidade',
    description: 'Etapa atual, valor, vigência e responsável de uma oportunidade.', params: p({ contract_id: S('ID da oportunidade') }, ['contract_id']) },
  { name: 'list_stale_contracts', feature: 'pipeline', kind: 'consulta', group: 'Funil', label: 'Oportunidades paradas',
    description: 'Oportunidades em aberto sem nenhuma atividade há mais de N dias.', params: p({ days: N('Dias sem atividade (padrão 15)') }) },
  { name: 'resumo_funil', feature: 'pipeline', kind: 'consulta', group: 'Funil', label: 'Resumo do funil por etapa',
    description: 'Quantidade e valor das oportunidades em aberto por funil e etapa.', params: p({}) },
  { name: 'fechamentos_mes', feature: 'pipeline', kind: 'consulta', group: 'Funil', label: 'Ganhas e perdidas no mês',
    description: 'Oportunidades ganhas e perdidas no mês (padrão: o atual), com valores e motivos de perda.', params: p({ mes: S('Mês no formato AAAA-MM (opcional)') }) },
  { name: 'add_note', feature: 'pipeline', kind: 'acao', group: 'Funil', label: 'Anotar numa oportunidade',
    description: 'Adiciona uma nota ao histórico de uma oportunidade.', params: p({ contract_id: S('ID da oportunidade'), content: S('Texto da nota') }, ['contract_id', 'content']) },
  { name: 'move_contract_stage', feature: 'pipeline', kind: 'acao', group: 'Funil', label: 'Mover oportunidade de etapa',
    description: 'Move a oportunidade para outra etapa do MESMO funil. Respeita as permissões da tela.', params: p({ contract_id: S('ID da oportunidade'), stage_name: S('Nome exato da etapa') }, ['contract_id', 'stage_name']) },
  { name: 'marcar_resultado', feature: 'pipeline', kind: 'acao', group: 'Funil', label: 'Marcar oportunidade como ganha ou perdida',
    description: 'Encerra a oportunidade como ganha ou perdida (perdida exige motivo). Segue as mesmas regras do botão da tela.',
    params: p({ contract_id: S('ID da oportunidade'), resultado: S('ganha ou perdida', { enum: ['ganha', 'perdida'] }), motivo: S('Motivo da perda') }, ['contract_id', 'resultado']) },
  { name: 'rascunho_mensagem', feature: 'pipeline', kind: 'acao', group: 'Funil', label: 'Deixar mensagem pronta (WhatsApp ou e-mail) para revisar',
    description: 'Cria uma atividade planejada com a mensagem pronta para a pessoa revisar e enviar. NÃO envia nada ao cliente.',
    params: p({ oportunidade_id: S('ID da oportunidade (ou empresa_id)'), empresa_id: S('ID da empresa'), canal: S('Canal', { enum: ['whatsapp', 'email'] }), texto: S('Texto da mensagem') }, ['canal', 'texto']) },

  // Leads
  { name: 'buscar_leads', feature: 'leads', kind: 'consulta', group: 'Leads', label: 'Buscar leads',
    description: 'Busca leads por nome, empresa, e-mail ou telefone.', params: p({ query: S('Termo de busca') }, ['query']) },
  { name: 'leads_sem_andamento', feature: 'leads', kind: 'consulta', group: 'Leads', label: 'Leads sem andamento',
    description: 'Leads novos ou em qualificação sem atualização há mais de N dias.', params: p({ days: N('Dias sem atualização (padrão 3)') }) },
  { name: 'origem_leads', feature: 'leads', kind: 'consulta', group: 'Leads', label: 'De onde vieram os leads do mês',
    description: 'Leads do mês (padrão: atual) agrupados por origem e campanha.', params: p({ mes: S('Mês AAAA-MM (opcional)') }) },
  { name: 'criar_lead', feature: 'leads', kind: 'acao', group: 'Leads', label: 'Criar lead',
    description: 'Cadastra um lead de prospecção (fica com quem pediu).', params: p({ nome: S('Nome da pessoa'), empresa: S('Empresa'), cnpj: S('CNPJ da empresa'), telefone: S('Telefone'), email: S('E-mail'), mensagem: S('Observação') }, ['nome', 'empresa', 'cnpj']) },
  { name: 'situacao_lead', feature: 'leads', kind: 'acao', group: 'Leads', label: 'Mudar a situação do lead',
    description: 'Muda a situação de um lead.', params: p({ lead_id: S('ID do lead (use buscar_leads)'), situacao: S('Nova situação', { enum: ['novo', 'em_qualificacao', 'qualificado', 'descartado'] }) }, ['lead_id', 'situacao']) },
  { name: 'passar_lead', feature: 'leads', kind: 'acao', group: 'Leads', label: 'Passar lead para um vendedor',
    description: 'Atribui o lead a uma pessoa da equipe, pelo nome.', params: p({ lead_id: S('ID do lead'), responsavel: S('Nome da pessoa') }, ['lead_id', 'responsavel']) },

  // Empresas
  { name: 'search_companies', feature: 'companies', kind: 'consulta', group: 'Empresas', label: 'Buscar empresas',
    description: 'Busca empresas pelo nome, nome fantasia ou CNPJ.', params: p({ query: S('Nome ou CNPJ (parcial)') }, ['query']) },
  { name: 'create_company', feature: 'companies', kind: 'acao', group: 'Empresas', label: 'Criar empresa',
    description: 'Cria uma nova empresa.', params: p({ name: S('Razão social'), trade_name: S('Nome fantasia (opcional)'), cnpj: S('CNPJ (opcional)') }, ['name']) },
  { name: 'cadastrar_contato', feature: 'companies', kind: 'acao', group: 'Empresas', label: 'Cadastrar contato na empresa',
    description: 'Adiciona um contato (pessoa) a uma empresa.', params: p({ empresa_id: S('ID da empresa'), nome: S('Nome'), cargo: S('Cargo'), email: S('E-mail'), telefone: S('Telefone') }, ['empresa_id', 'nome']) },

  // Propostas
  { name: 'propostas_abertas', feature: 'propostas', kind: 'consulta', group: 'Propostas', label: 'Propostas em aberto',
    description: 'Propostas ainda não aprovadas pelo cliente, com a situação e há quantos dias estão paradas.', params: p({}) },

  // Carteira
  { name: 'contratos_vencendo', feature: 'carteira', kind: 'consulta', group: 'Carteira', label: 'Contratos que vencem em N dias',
    description: 'Contratos com fim de vigência nos próximos N dias (padrão 90), com valor mensal.', params: p({ days: N('Dias à frente (padrão 90)') }) },

  // Atendimento
  { name: 'chamados_abertos', feature: 'tickets', kind: 'consulta', group: 'Atendimento', label: 'Chamados abertos e atrasados',
    description: 'Chamados não fechados, destacando os que passaram do prazo.', params: p({}) },

  // WhatsApp
  { name: 'resumo_conversa_whatsapp', feature: 'whatsapp', kind: 'consulta', group: 'WhatsApp', label: 'Resumir conversa com um contato',
    description: 'Traz as últimas mensagens da conversa de WhatsApp com um telefone, para você resumir.', params: p({ telefone: S('Telefone com DDD') }, ['telefone']) },
  { name: 'conversas_sem_resposta', feature: 'whatsapp', kind: 'consulta', group: 'WhatsApp', label: 'Conversas sem resposta',
    description: 'Conversas em que a última mensagem é do contato e está sem resposta há mais de N horas.', params: p({ horas: N('Horas sem resposta (padrão 2)') }) },

  // Pesquisas
  { name: 'nps_baixo', feature: 'surveys', kind: 'consulta', group: 'Pesquisas & NPS', label: 'Notas baixas de NPS',
    description: 'Respostas de NPS com nota até 6 nos últimos N dias (padrão 90).', params: p({ days: N('Dias (padrão 90)') }) },

  // Marketing
  { name: 'resultado_campanhas', feature: 'marketing', kind: 'consulta', group: 'Marketing', label: 'Resultado das campanhas',
    description: 'Campanhas de marketing com leads gerados, oportunidades ganhas e orçamento.', params: p({}) },

  // Varejo
  { name: 'buscar_pecas', feature: 'varejo', kind: 'consulta', group: 'Varejo', label: 'Buscar peça e estoque',
    description: 'Busca peças pelo nome ou código e mostra o estoque por cor e tamanho.', params: p({ query: S('Nome ou código') }, ['query']) },
  { name: 'estoque_baixo', feature: 'varejo', kind: 'consulta', group: 'Varejo', label: 'Estoque baixo',
    description: 'Variações ativas com estoque até N unidades (padrão 1).', params: p({ limite: N('Estoque máximo (padrão 1)') }) },
  { name: 'pedidos_pendentes', feature: 'varejo', kind: 'consulta', group: 'Varejo', label: 'Pedidos pendentes',
    description: 'Pedidos que ainda não foram entregues nem cancelados, com a situação.', params: p({}) },
  { name: 'melhores_clientes', feature: 'varejo', kind: 'consulta', group: 'Varejo', label: 'Clientes que mais compram',
    description: 'Clientes da loja com maior valor pago nos últimos N dias (padrão 365).', params: p({ days: N('Dias (padrão 365)') }) },
]

export const THEO_TOOL_NAMES = THEO_TOOLS.map(t => t.name)
export const toolByName = (n: string) => THEO_TOOLS.find(t => t.name === n)

// Ferramentas da empresa: o plano escolheu (null = todas) ∩ abas liberadas na licença
export function effectiveTheoTools(planTools: string[] | null | undefined, features: string[]): TheoTool[] {
  const chosen = planTools ? new Set(planTools) : null
  const feats = new Set(features)
  return THEO_TOOLS.filter(t => (!chosen || chosen.has(t.name)) && (t.feature === '*' || feats.has(t.feature)))
}

// Ferramentas que o Super Admin pode marcar num plano (as das abas do plano)
export const toolsForPlanFeatures = (features: string[]) => THEO_TOOLS.filter(t => t.feature === '*' || features.includes(t.feature))

// Quem usa o Théo: admin sempre; demais só se o admin liberou
export function canUseTheo(role: string | null | undefined, userId: string, allowed: unknown): boolean {
  if (role === 'admin') return true
  return Array.isArray(allowed) && allowed.includes(userId)
}

// Instruções do Théo — com o nome da empresa (nunca fixo)
export function theoSystemPrompt(companyName: string | null | undefined, today: Date = new Date()): string {
  const company = (companyName ?? '').trim() || 'da empresa'
  return [
    `Você é o Théo, o assistente de IA do CRM ${company === 'da empresa' ? 'da empresa' : `da ${company}`}. Responda em português do Brasil, de forma direta e curta.`,
    'Regras:',
    '- Use só as ferramentas que tem. Se pedirem algo que você não faz, diga isso e indique a tela do sistema.',
    '- Ações (criar, anotar, mover, marcar, cadastrar) só acontecem depois que a pessoa confirma na tela: proponha pela ferramenta.',
    '- Para achar o ID de oportunidade, empresa ou lead, busque antes. Nunca invente ID, valor ou dado.',
    '- Nunca envie mensagem a cliente: no máximo deixe a mensagem pronta para revisar.',
    '- Valores em reais com centavos (R$ 1.234,56); datas no formato dd/mm/aaaa.',
    `- Hoje é ${today.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`,
  ].join('\n')
}

// Gemini aceita o esquema no formato OpenAPI (tipos em maiúsculas)
export function toGeminiSchema(s: ParamSchema): Record<string, unknown> {
  const props: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(s.properties)) props[k] = { type: v.type.toUpperCase(), description: v.description, ...(v.enum ? { enum: v.enum } : {}) }
  return { type: 'OBJECT', properties: props, ...(s.required?.length ? { required: s.required } : {}) }
}

// ─── Conversa ────────────────────────────────────────────────────────────────
export type TheoTurn = { role: 'user' | 'assistant'; text: string }
// Junta mensagens seguidas do mesmo lado e começa sempre pela pessoa (exigência das APIs)
export function normalizeHistory(h: TheoTurn[]): TheoTurn[] {
  const out: TheoTurn[] = []
  for (const t of h) {
    const text = String(t?.text ?? '').trim().slice(0, 8000)
    if (!text || (t.role !== 'user' && t.role !== 'assistant')) continue
    const last = out[out.length - 1]
    if (last && last.role === t.role) last.text += `\n\n${text}`
    else out.push({ role: t.role, text })
  }
  while (out.length && out[0].role !== 'user') out.shift()
  return out.slice(-20)
}


// Termo de busca seguro para filtros .or() do banco (vírgula/parênteses quebram o filtro)
export const searchTerm = (v: unknown) => String(v ?? '').replace(/[,()%*\\"]/g, ' ').trim().slice(0, 80)
