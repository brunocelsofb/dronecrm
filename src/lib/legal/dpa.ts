// ─── Contrato de Tratamento de Dados (operador × controlador, LGPD) ───────────
// Vale para todas as empresas (tenants). A empresa cliente é a CONTROLADORA dos
// dados que coloca no CRM; a plataforma é a OPERADORA. Estrutura baseada nas 12
// cláusulas recomendadas para contratos com operadores (Confidata), adaptada ao
// que o sistema faz de fato. Mudou o texto → suba DPA_VERSION: todas as empresas
// precisam aceitar de novo. ATENÇÃO: modelo técnico; revisar com advogado.

export const DPA_VERSION = '1.0'
export const DPA_UPDATED_AT = '2026-10-20'

export const OPERATOR = {
  name: '2B Soluções Comerciais',
  product: 'Comercial Drone CRM',
  site: 'app.comercialdrone.com.br',
  email: 'contato@comercialdrone.com.br',
  // Dados do cadastro (cartão CNPJ) — usados nas páginas públicas (privacidade, termos, exclusão).
  // Não entram no texto do contrato de dados (DPA), para não exigir novo aceite das empresas.
  legalName: '2B Soluções Comerciais Ltda',
  cnpj: '43.038.578/0001-40',
}

export type DpaParty = { name: string | null; cnpj: string | null }
export type DpaSection = { title: string; paragraphs: string[]; items?: string[]; after?: string[] }

export function buildDpa(controller: DpaParty): DpaSection[] {
  const ctrl = controller.name?.trim()
    ? `${controller.name.trim()}${controller.cnpj?.trim() ? `, CNPJ ${controller.cnpj.trim()}` : ''}`
    : 'a empresa cliente identificada no aceite eletrônico'
  return [
    {
      title: '1. Partes e papéis',
      paragraphs: [
        `CONTROLADORA: ${ctrl}, que contrata a licença do ${OPERATOR.product} e decide quais dados pessoais coloca no sistema e para quê.`,
        `OPERADORA: ${OPERATOR.name}, que fornece o ${OPERATOR.product} e trata os dados pessoais somente em nome da Controladora e conforme as instruções dela, nos termos dos arts. 5º, VI e VII, e 39 da Lei nº 13.709/2018 (LGPD).`,
        'Instruções da Controladora são as configurações que ela faz no sistema (funis, automações, integrações, agentes de IA, retenção) e as solicitações por escrito ao contato da Operadora.',
      ],
    },
    {
      title: '2. Finalidade e limites do tratamento',
      paragraphs: [
        'A Operadora trata os dados exclusivamente para prestar o serviço contratado: guardar, organizar e exibir as informações da Controladora; enviar as mensagens, e-mails e avisos que a Controladora ou suas automações disparam; executar as rotinas automáticas configuradas; e prestar suporte quando a Controladora pedir.',
        'É proibido à Operadora usar os dados da Controladora para fins próprios, incluindo: vender ou ceder dados; fazer marketing próprio; comparar empresas (benchmarking); desenvolver outros produtos; ou treinar modelos de inteligência artificial.',
        'A Operadora usa apenas métricas de uso em números (quantidade de usuários, registros e mensagens; data da última atividade) para cobrança, capacidade e status do serviço, sem acesso ao conteúdo.',
      ],
    },
    {
      title: '3. O que a Operadora acessa e para quê',
      paragraphs: [
        'Por padrão, a equipe da Operadora (administração da plataforma) NÃO tem acesso ao conteúdo da Controladora. Ela vê apenas:',
      ],
      items: [
        'nome da empresa, plano, limite e quantidade de usuários, situação da licença;',
        'contagens de uso (empresas cadastradas, oportunidades em andamento, mensagens de WhatsApp nos últimos 30 dias) e a data da última atividade;',
        'se este contrato foi aceito e se há acesso de suporte liberado.',
      ],
      after: [
        'Conteúdo (clientes, contatos, oportunidades, propostas, mensagens, arquivos) só pode ser visto pelo acesso de suporte: liberado pelo administrador da Controladora em Configurações → Privacidade e dados, por prazo de 1 a 72 horas, somente leitura, podendo ser revogado a qualquer momento. Cada entrada, tela vista e tentativa de alteração fica registrada (quem, quando e o quê) e visível para a Controladora.',
        'Rotinas automáticas do sistema (envio de avisos, recebimento de mensagens, integrações, agentes de IA ativados pela Controladora) processam o conteúdo sem acesso humano da Operadora.',
      ],
    },
    {
      title: '4. Dados pessoais e titulares envolvidos',
      paragraphs: ['Titulares: usuários da Controladora; contatos de clientes e prospects; leads; pessoas que conversam com a Controladora pelo WhatsApp ou e-mail.'],
      items: [
        'Identificação e contato: nome, e-mail, telefone/WhatsApp, cargo.',
        'Dados da empresa do contato: razão social, CNPJ, endereço.',
        'Dados comerciais: oportunidades, propostas, contratos, valores, histórico de atendimento.',
        'Comunicações: mensagens de WhatsApp (texto e áudio), e-mails registrados, notas e atividades.',
        'Arquivos anexados pela Controladora e registros de uso (acessos e ações no sistema).',
        'O sistema não foi feito para dados pessoais sensíveis (art. 5º, II, da LGPD). A Controladora não deve inseri-los, salvo quando indispensável e sob sua responsabilidade. Outras categorias só com autorização prévia e por escrito da Controladora.',
      ],
    },
    {
      title: '5. Segurança',
      paragraphs: ['A Operadora mantém, no mínimo, as seguintes medidas técnicas e organizacionais (art. 46 da LGPD):'],
      items: [
        'Separação dos dados por empresa no próprio banco de dados (cada empresa só enxerga as próprias linhas).',
        'Conexões criptografadas (HTTPS) entre o navegador, o sistema e os fornecedores.',
        'Mensagens de WhatsApp e conversas da assistente virtual guardadas criptografadas no banco, com chave própria de cada empresa (AES-256-GCM).',
        'Chaves de integração da Controladora (IA, e-mail marketing etc.) guardadas criptografadas.',
        'Acesso por perfil dentro da Controladora e acesso de suporte com liberação, prazo, somente leitura e registro.',
        'Retenção configurável: a Controladora pode definir em quantos dias as mensagens de WhatsApp são apagadas automaticamente.',
      ],
    },
    {
      title: '6. Suboperadores',
      paragraphs: [
        'A Controladora autoriza os suboperadores abaixo, sujeitos a obrigações de proteção de dados equivalentes às deste contrato. A inclusão ou troca de suboperador será avisada com no mínimo 15 dias de antecedência, e a Controladora poderá se opor; não havendo acordo, poderá encerrar o contrato sem multa.',
      ],
      items: [
        'Supabase — banco de dados, autenticação e armazenamento de arquivos (servidores nos Estados Unidos).',
        'Vercel — hospedagem e execução do sistema.',
        'Servidor de WhatsApp (Evolution API) contratado pela Operadora — envio e recebimento de mensagens; e o próprio WhatsApp (Meta), por onde as mensagens trafegam.',
        'Anthropic — agentes de IA, somente quando a Controladora ativa e com a chave da própria Controladora.',
        'Usados apenas se a Controladora conectar: ZapSign (assinatura eletrônica), Google (login e e-mail), Mailchimp e RD Station (e-mail marketing), ERPs de faturamento.',
        'BrasilAPI — consulta de dados públicos de empresas pelo CNPJ (só o número do CNPJ é enviado).',
      ],
    },
    {
      title: '7. Incidentes de segurança',
      paragraphs: [
        'A Operadora comunicará à Controladora qualquer incidente que envolva os dados dela em até 48 horas da ciência, informando: a natureza do incidente; os titulares e dados afetados (ou a estimativa); as medidas tomadas para conter e reduzir os efeitos; e um contato responsável. A comunicação à ANPD e aos titulares cabe à Controladora (art. 48 da LGPD), com o apoio da Operadora.',
      ],
    },
    {
      title: '8. Direitos dos titulares',
      paragraphs: [
        'A Operadora apoiará a Controladora a atender os pedidos dos titulares do art. 18 da LGPD (confirmação, acesso, correção, anonimização, eliminação, portabilidade e informação) em até 5 dias úteis do pedido da Controladora. Pedido recebido diretamente de um titular será encaminhado à Controladora, sem resposta pela Operadora.',
        'O próprio sistema permite à Controladora corrigir e excluir registros, baixar a cópia dos dados e configurar a retenção.',
      ],
    },
    {
      title: '9. Confidencialidade',
      paragraphs: [
        'Quem atua pela Operadora com acesso ao ambiente está sujeito a dever de sigilo, recebe orientação sobre proteção de dados e só acessa o mínimo necessário à sua função — e, quanto ao conteúdo da Controladora, apenas pelo acesso de suporte liberado.',
      ],
    },
    {
      title: '10. Transferência internacional',
      paragraphs: [
        'Os dados são armazenados e processados por fornecedores com servidores nos Estados Unidos (item 6). A transferência ocorre para executar este contrato, com base no art. 33 da LGPD e na regulamentação da ANPD, apoiada nas cláusulas de proteção de dados dos fornecedores. A Operadora informará previamente qualquer mudança de país.',
      ],
    },
    {
      title: '11. Auditoria e informações',
      paragraphs: [
        'A Controladora pode pedir informações sobre o cumprimento deste contrato, com aviso de 30 dias, sem custo adicional uma vez por ano. O registro de acessos de suporte fica disponível a qualquer momento em Configurações → Privacidade e dados.',
      ],
    },
    {
      title: '12. Retenção, devolução e eliminação',
      paragraphs: [
        'Os dados ficam guardados enquanto durar o contrato ou pelo prazo de retenção que a Controladora configurar. Ao término, a Controladora pode baixar a cópia dos dados (planilha) e a Operadora elimina os dados em até 30 dias, emitindo declaração por escrito se solicitada, salvo obrigação legal de guarda. Cópias de segurança são sobrescritas no ciclo normal dos fornecedores.',
      ],
    },
    {
      title: '13. Responsabilidade',
      paragraphs: [
        'Cada parte responde pelos danos que causar ao violar a LGPD ou este contrato. A Operadora responde solidariamente quando descumprir a LGPD ou as instruções lícitas da Controladora (art. 42, § 1º, I). A Operadora indenizará a Controladora por perdas, multas e custos que decorram diretamente de violação sua.',
      ],
    },
    {
      title: '14. Vigência e aceite',
      paragraphs: [
        'Este contrato integra a licença de uso do sistema e vale enquanto ela durar, mais o prazo do item 12. O aceite é feito eletronicamente pelo administrador da Controladora; ficam registrados nome, e-mail, data e hora, IP e a impressão digital (hash) do texto aceito. Nova versão deste texto exige novo aceite.',
        `Contato da Operadora para privacidade: ${OPERATOR.email}.`,
      ],
    },
  ]
}

// Texto corrido (para a impressão digital do aceite)
export function dpaPlainText(controller: DpaParty): string {
  return buildDpa(controller).map(s => [s.title, ...s.paragraphs, ...(s.items ?? []).map(i => `- ${i}`), ...(s.after ?? [])].join('\n')).join('\n\n')
}
