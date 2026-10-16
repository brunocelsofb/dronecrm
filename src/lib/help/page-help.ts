// Explicações curtas de cada tela (aparecem ao passar o mouse no "ⓘ").
// Textos neutros: valem para qualquer empresa que use o CRM.

export type PageHelp = { title: string; text: string; tips?: string[] }

// A primeira regra que casar vence: deixe as mais específicas em cima.
const RULES: { test: RegExp; help: PageHelp }[] = [
  { test: /^\/$/, help: { title: 'Dashboard', text: 'Visão geral do comercial: valores em funil, metas, atividades da equipe e indicadores do período.', tips: ['Use o filtro de período no topo para comparar meses.'] } },

  { test: /^\/painel/, help: { title: 'Painel gerencial', text: 'Receita do mês x meta e os indicadores do Hunter (novos negócios) e do Farmer (carteira). Clique em um número para ver os contratos que o compõem.', tips: ['Abas: Mês e Consolidado. No Consolidado, marque os meses que quiser (soltos, trimestre, semestre ou ano) e tudo é recalculado só sobre eles.', 'Em contrato x faturado: potencial de todos os contratos contra o que foi faturado, com a diferença explicada (descontos, glosas, medido abaixo, medições pendentes).', 'Receita = recorrente (valor − descontos do mês) + medição validada + avulso faturado.', 'Churn é só rescisão; vencer sem renovar não conta.', 'Metas em Configurações → Metas de receita.'] } },

  { test: /^\/pipeline/, help: { title: 'Funil', text: 'Quadro com as oportunidades em cada etapa. Arraste o cartão para mudar de etapa.', tips: ['Ganho e Perdido só aparecem nas etapas habilitadas em Funis e Etapas.', 'No ganho de vendas, o sistema pede o consultor responsável pela conta.'] } },

  { test: /^\/leads\/new/, help: { title: 'Novo lead', text: 'Cadastre um contato que ainda não é oportunidade. Depois ele pode ser convertido.' } },
  { test: /^\/leads\/[^/]+/, help: { title: 'Lead', text: 'Detalhes, histórico e conversão do lead em oportunidade.' } },
  { test: /^\/leads/, help: { title: 'Leads', text: 'Contatos que chegaram por formulário, WhatsApp ou cadastro manual e ainda não viraram oportunidade.', tips: ['A pontuação ajuda a priorizar (Configurações → Pontuação de leads).', 'Converter cria a oportunidade no funil escolhido.'] } },

  { test: /^\/contracts\/new/, help: { title: 'Nova oportunidade', text: 'Cria uma oportunidade (ou contrato) já ligada a uma empresa e a um funil.', tips: ['Cadastro direto em Gestão de Contratos exige o consultor responsável.'] } },
  { test: /^\/contracts\/[^/]+\/proposals/, help: { title: 'Proposta', text: 'Monte, revise e acompanhe a aprovação da proposta desta oportunidade.' } },
  { test: /^\/contracts\/[^/]+\/edit/, help: { title: 'Editar oportunidade', text: 'Altere os dados principais: cliente, vigência, valores e responsáveis.' } },
  { test: /^\/contracts\/[^/]+/, help: { title: 'Oportunidade / contrato', text: 'Tudo do cliente num lugar: etapa no funil, atividades, contatos, e-mails, WhatsApp, propostas, implantação e assinatura.', tips: ['No topo, o selo $ Recorrente / 📏 Medição é clicável: troca o tipo de receita do contrato.', 'Na aba Faturamento: desconto do mês (recorrente) ou lançamento da medição.', 'Atividades do Farmer (carteira) e do Hunter (novos negócios) aparecem em Atividades, com "Revisar e enviar".', 'Os avisos ao cliente só saem depois que o consultor revisa.'] } },
  { test: /^\/contracts/, help: { title: 'Oportunidades', text: 'Lista de todas as oportunidades e contratos, com filtros por funil, etapa e responsável.' } },

  { test: /^\/propostas|^\/proposals/, help: { title: 'Propostas', text: 'Propostas comerciais e o fluxo de aprovação técnica, comercial e do cliente.' } },
  { test: /^\/carteira/, help: { title: 'Gestão de Carteira', text: 'Contratos ativos da carteira: vigência, valores, reajustes e renovações.', tips: ['Os alertas de renovação (90, 60, 30, 15 dias e vencido) vêm desses dados.'] } },

  { test: /^\/companies\/import/, help: { title: 'Importar empresas', text: 'Cadastre várias empresas de uma vez por arquivo CSV.', tips: ['Baixe o modelo e preencha uma empresa por linha — só a razão social é obrigatória.', 'CNPJ já cadastrado é pulado: dá para importar o mesmo arquivo de novo sem duplicar.', 'A linha de exemplo (começa com "EXEMPLO") é ignorada.', 'Preenchendo o contato, ele vira o contato principal (usado nos avisos por WhatsApp e e-mail).'] } },
  { test: /^\/companies\/new/, help: { title: 'Nova empresa', text: 'Cadastre a empresa (cliente). Com o CNPJ, os dados são preenchidos automaticamente.' } },
  { test: /^\/companies\/inactive/, help: { title: 'Empresas inativas', text: 'Empresas sem contrato ativo — boas para reativação.' } },
  { test: /^\/companies\/[^/]+/, help: { title: 'Empresa', text: 'Dados da empresa, contatos e todas as oportunidades e contratos dela.' } },
  { test: /^\/companies/, help: { title: 'Empresas', text: 'Base de clientes e prospects. Cada empresa reúne contatos, oportunidades e contratos.', tips: ['Use "Importar" para cadastrar em massa por CSV.'] } },

  { test: /^\/tickets\/dashboard/, help: { title: 'Painel de atendimento', text: 'Indicadores dos chamados: volume, prazo (SLA) e satisfação.' } },
  { test: /^\/tickets\/new/, help: { title: 'Novo chamado', text: 'Abra um chamado em nome do cliente.' } },
  { test: /^\/tickets/, help: { title: 'Atendimento', text: 'Chamados de suporte dos clientes, com prioridade, prazo e histórico de respostas.', tips: ['O cliente acompanha pelo link público do chamado.'] } },

  { test: /^\/whatsapp\/relatorios/, help: { title: 'Relatórios de WhatsApp', text: 'Volume de conversas, tempo de resposta e atendimentos por número e por pessoa.' } },
  { test: /^\/whatsapp/, help: { title: 'WhatsApp', text: 'Conversas dos números conectados da empresa. Vincule uma conversa a uma oportunidade para ela entrar no histórico.', tips: ['Pesquise no topo da lista por nome, telefone, protocolo ou texto da mensagem; com 3 letras ou mais, a busca também varre todo o histórico.', 'Números são conectados em Configurações → Conexões.', 'Números marcados como privados não aparecem aqui.'] } },

  { test: /^\/surveys-dashboard|^\/nps-dashboard/, help: { title: 'Pesquisas & NPS', text: 'Resultados de satisfação (NPS) e das pesquisas enviadas aos clientes.' } },
  { test: /^\/surveys/, help: { title: 'Pesquisas', text: 'Crie e edite os modelos de pesquisa enviados aos clientes.' } },

  { test: /^\/copiloto\/relatorios/, help: { title: 'Relatórios de implantação', text: 'Consolidado mensal das fases de implantação, preparado pelo Farmer para revisar e enviar ao time técnico.' } },
  { test: /^\/briefing/, help: { title: 'Agentes IA', text: 'Tela dividida: à esquerda o Farmer (carteira), à direita o Hunter (novos negócios). Cada item é um cliente com os dados dele; clique para abrir.', tips: ['Farmer: renovações, medições pendentes, perdas no faturamento, rescisões, planos de ação, NPS baixo e chamados atrasados.', 'Hunter: oportunidades e propostas paradas, leads sem andamento, fechamentos do mês e avulsos.', 'O resumo do dia continua chegando por WhatsApp ao gestor, de segunda a sexta.'] } },

  { test: /^\/settings\/metas/, help: { title: 'Metas de receita', text: 'Meta total da empresa cadastrada mês a mês; a meta anual é a soma dos meses.', tips: ['O Painel gerencial compara a meta do mês com a receita realizada (recorrente + medição + avulso).', 'Prazo da medição: até esse dia do mês seguinte o relatório precisa estar validado, senão o Farmer avisa.'] } },
  { test: /^\/settings\/copiloto/, help: { title: 'Configurações dos agentes IA', text: 'Ativação (chave da Anthropic), gestor que recebe os resumos e os textos dos avisos ao cliente e dos e-mails internos.', tips: ['Externo: avisos de renovação ao cliente.', 'Interno: e-mails ao time, implantação e relatório mensal.'] } },
  { test: /^\/settings\/whatsapp-conexoes/, help: { title: 'Conexões de WhatsApp', text: 'Conecte os números da empresa lendo o QR Code e defina o consultor de cada número.', tips: ['A quantidade de números depende do plano.', 'Instância privada só envia (ex.: briefing) e não mostra conversas no CRM.'] } },
  { test: /^\/settings\/whatsapp-bot/, help: { title: 'Bot e automações', text: 'Mensagens automáticas de boas-vindas e o status online/offline do atendimento.' } },
  { test: /^\/settings\/implementation-templates/, help: { title: 'Modelos de implantação', text: 'Cronogramas padrão (fases e semanas) usados ao iniciar a implantação de um contrato.' } },
  { test: /^\/settings\/layout-abas/, help: { title: 'Layout das abas', text: 'Escolha a ordem e quais abas aparecem na tela da oportunidade, por funil.' } },
  { test: /^\/settings\/lead-routing/, help: { title: 'Distribuição de leads', text: 'Regras que mandam cada lead novo para o funil e o responsável certos.' } },
  { test: /^\/settings\/lead-scoring/, help: { title: 'Pontuação de leads', text: 'Critérios que somam pontos para priorizar os leads mais promissores.' } },
  { test: /^\/settings\/motivos-perda/, help: { title: 'Motivos de perda', text: 'Lista de motivos exigida ao marcar uma oportunidade como perdida.' } },
  { test: /^\/settings\/numeracao/, help: { title: 'Numeração', text: 'Prefixos e sequência dos números de oportunidades, propostas e chamados.' } },
  { test: /^\/settings\/campos-oportunidade/, help: { title: 'Campos da oportunidade', text: 'Campos obrigatórios e opcionais em cada funil.' } },
  { test: /^\/settings\/carteira/, help: { title: 'Campos da carteira', text: 'Quais campos aparecem na Gestão de Carteira.' } },
  { test: /^\/settings\/curva-abc/, help: { title: 'Curva ABC', text: 'Faixas de valor que classificam os clientes em A, B e C.' } },
  { test: /^\/settings\/forms/, help: { title: 'Formulários', text: 'Formulários públicos de captura e pesquisa.' } },
  { test: /^\/settings\/wallpapers/, help: { title: 'Fundos de tela', text: 'Imagens de fundo das páginas públicas (login, suporte, pesquisas).' } },
  { test: /^\/settings\/price-users/, help: { title: 'Usuários do Price', text: 'Quem acessa a precificação integrada.' } },
  { test: /^\/settings/, help: { title: 'Configurações', text: 'Tudo o que é da sua empresa: dados, logo, WhatsApp, agentes IA, funis, campos e automações.', tips: ['Só administradores da conta alteram.', 'Resetar CRM fica no fim da página (zona de risco).'] } },

  { test: /^\/pipelines/, help: { title: 'Funis e etapas', text: 'Crie os funis e as etapas do seu processo. Defina onde é possível marcar ganho e perda e para onde o contrato vai no ganho.' } },
  { test: /^\/custom-fields/, help: { title: 'Campos personalizados', text: 'Campos extras para guardar informações específicas do seu negócio.' } },
  { test: /^\/email-templates/, help: { title: 'Modelos de mensagem', text: 'Textos prontos de e-mail e WhatsApp usados pela equipe e pelas automações.' } },
  { test: /^\/automations/, help: { title: 'Automações', text: 'Ações automáticas por etapa, prazo ou evento (mensagens, tarefas, mudança de funil).' } },
  { test: /^\/tags/, help: { title: 'Tags', text: 'Etiquetas para classificar oportunidades e empresas.' } },
  { test: /^\/zapsign/, help: { title: 'Assinatura digital', text: 'Envio de contratos para assinatura eletrônica (ZapSign) e acompanhamento.' } },
  { test: /^\/users/, help: { title: 'Usuários', text: 'Equipe da empresa: cadastro, papel (admin, membro, aprovadores) e departamento.', tips: ['O limite de usuários depende da licença.'] } },
  { test: /^\/minha-conta/, help: { title: 'Minha conta', text: 'Seus dados, assinatura de e-mail e a conexão do seu Gmail (de onde saem seus e-mails pelo CRM).' } },
  { test: /^\/super-admin/, help: { title: 'Super Admin', text: 'Central das licenças: crie empresas, defina planos e abas, acesse ou resete uma empresa.' } },
]

export function getPageHelp(pathname: string): PageHelp | null {
  for (const r of RULES) if (r.test.test(pathname)) return r.help
  return null
}

// Descrição curta para o menu lateral (por aba)
export const NAV_HELP: Record<string, string> = {
  '/': 'Visão geral e indicadores',
  '/painel': 'Receita x meta, Hunter e Farmer',
  '/pipeline': 'Oportunidades por etapa',
  '/leads': 'Contatos ainda não qualificados',
  '/contracts': 'Todas as oportunidades e contratos',
  '/propostas': 'Propostas e aprovações',
  '/carteira': 'Contratos ativos e renovações',
  '/companies': 'Clientes, contatos e importação',
  '/tickets': 'Chamados de suporte',
  '/whatsapp': 'Conversas dos números da empresa',
  '/whatsapp/relatorios': 'Indicadores do WhatsApp',
  '/surveys-dashboard': 'Satisfação e NPS',
  '/briefing': 'Farmer (carteira) e Hunter (novos negócios)',
  '/settings': 'Dados, integrações e regras da empresa',
  '/super-admin': 'Licenças, planos e abas',
}
