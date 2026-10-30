// Política de Privacidade (pública). Exigida pelo Google (OAuth/Gmail) e pelo Meta (app da plataforma).
// ATENÇÃO: texto técnico; revisar com advogado. Mudou o que o sistema faz com dados → atualize aqui.
import { LegalPage, type LegalSection } from '@/components/legal/legal-page'
import { OPERATOR } from '@/lib/legal/dpa'

export const metadata = {
  title: 'Política de Privacidade — Comercial Drone',
  description: 'Política de Privacidade do CRM Comercial Drone, da 2B Soluções Comerciais.',
}

const S: LegalSection[] = [
  { title: '1. Quem somos e a quem se aplica', body: [
    `O ${OPERATOR.product} é um CRM vendido por licença a empresas (as "empresas clientes"), operado pela ${OPERATOR.legalName}${OPERATOR.cnpj ? `, CNPJ ${OPERATOR.cnpj}` : ''}, e acessado em https://${OPERATOR.site}.`,
    'Cada empresa cliente é a CONTROLADORA dos dados pessoais que coloca no sistema (seus clientes, contatos, leads e conversas) e decide para que os usa. A 2B é a OPERADORA desses dados: trata-os somente em nome e conforme as instruções da empresa cliente, nos termos da LGPD (Lei nº 13.709/2018) e do Contrato de Tratamento de Dados.',
    'A 2B é a controladora apenas dos dados de cadastro e acesso dos usuários do sistema e dos dados necessários para cobrar e dar suporte à licença.',
  ] },
  { title: '2. Dados tratados', body: [{ list: [
    'Usuários do sistema: nome, e-mail, perfil de acesso e registros de acesso e atividade (auditoria).',
    'Dados que a empresa cliente coloca no CRM: empresas, contatos, leads, oportunidades, contratos, propostas, pedidos, clientes de loja, mensagens de WhatsApp e e-mail, arquivos e anotações.',
    'Dados recebidos de integrações que a empresa cliente liga: formulários do site, anúncios (Meta, Google, LinkedIn), ferramentas de marketing e pagamentos — detalhes abaixo.',
  ] }] },
  { title: '3. Finalidades', body: [
    'Os dados são usados exclusivamente para prestar o serviço contratado pela empresa cliente: organizar o funil comercial, registrar e responder clientes e leads, enviar mensagens e e-mails que a empresa pede, gerar propostas e contratos, emitir relatórios e manter a segurança do sistema.',
    'A 2B não vende dados, não os usa para publicidade própria e não os compartilha com terceiros além dos fornecedores necessários ao funcionamento (item 7).',
  ] },
  { title: '4. Integração com o Meta (Facebook e Instagram)', body: [
    'Quando um usuário de uma empresa cliente clica em "Continuar com o Facebook" no sistema, ele autoriza o app da 2B no Meta a acessar, em nome da empresa, somente o que for marcado na tela do Facebook:',
    { list: [
      'Contas de anúncio (permissão ads_read): nome e número da conta e, de cada campanha, nome, situação, valor gasto, alcance, impressões e cliques no link. Usado para mostrar o investimento e o retorno das campanhas da própria empresa.',
      'Páginas do Facebook (pages_show_list, pages_manage_metadata, pages_read_engagement): nome e identificação das páginas e o aviso de novos leads. A única configuração feita na página é ligar esse aviso para o app.',
      'Formulários de cadastro dos anúncios (leads_retrieval): as respostas que a pessoa enviou no formulário da empresa (por exemplo nome, e-mail, telefone e perguntas do formulário), o formulário, o anúncio e a campanha de origem. Esses dados entram como lead no CRM da própria empresa cliente, que é a controladora deles.',
      'Do usuário que conecta: nome e identificação no Facebook, para mostrar quem conectou e atender pedidos de exclusão.',
    ] },
    'Os acessos fornecidos pelo Meta são guardados criptografados e nunca são exibidos no navegador. Os dados do Meta não são vendidos, não são usados para criar perfis, para anúncios de terceiros ou para treinar modelos de inteligência artificial, e só são vistos pelos usuários da própria empresa cliente.',
    'Para revogar: clique em Desconectar na tela Anúncios (Meta) do sistema, ou remova o app nas configurações do Facebook (Configurações e privacidade → Integrações comerciais). Para pedir a exclusão, veja a página Exclusão de dados (/exclusao-de-dados).',
  ] },
  { title: '5. Integração com o Google', body: [
    'O sistema usa o Google OAuth 2.0 para que usuários conectem o Gmail e enviem e-mails pelo sistema. O acesso pedido é limitado a gmail.send (enviar e-mails em nome do usuário). O sistema não lê a caixa de entrada nem os contatos da conta Google. Os acessos são guardados criptografados.',
    'O uso das informações recebidas das APIs do Google segue a Política de Dados do Usuário dos Serviços de API do Google, incluindo os requisitos de Uso Limitado (https://developers.google.com/terms/api-services-user-data-policy).',
  ] },
  { title: '6. Inteligência artificial', body: [
    'Recursos de IA (copiloto, textos e imagens de produtos) usam a chave da própria empresa cliente nos provedores escolhidos por ela (como Anthropic, OpenAI ou Google). Só é enviado ao provedor o conteúdo necessário para a tarefa pedida. A 2B não usa os dados das empresas clientes para treinar modelos.',
  ] },
  { title: '7. Fornecedores (suboperadores)', body: [{ list: [
    'Supabase — banco de dados e autenticação;',
    'Vercel — hospedagem do sistema; Cloudflare — vitrine das lojas e DNS;',
    'Google (Gmail API), Mailgun e Resend — envio e recebimento de e-mails;',
    'Evolution API — conexão com o WhatsApp das empresas clientes;',
    'Meta (Facebook/Instagram), Google Ads, LinkedIn, RD Station, Mailchimp, Zapier/Make — somente quando a empresa cliente liga a integração;',
    'ZapSign — assinatura de documentos; Mercado Pago — pagamentos das lojas, quando ligados;',
    'Provedores de IA indicados no item 6, com a chave da empresa cliente.',
  ] }] },
  { title: '8. Segurança', body: [
    'Criptografia em trânsito (HTTPS/TLS), isolamento por empresa no banco de dados (Row-Level Security), criptografia de chaves e acessos de integrações e de conteúdos sensíveis (como mensagens), controle de acesso por perfil e registro de acessos. Senhas são guardadas pelo provedor de autenticação apenas em forma cifrada (hash), nunca em texto; o login termina ao fechar o navegador; senha provisória definida por um administrador precisa ser trocada pela pessoa no próximo acesso. O suporte da 2B só vê dados de uma empresa com liberação do administrador dela, por tempo limitado, somente leitura e com registro.',
  ] },
  { title: '9. Retenção e exclusão', body: [
    'Os dados ficam enquanto a licença da empresa cliente estiver ativa ou pelo prazo que ela configurar; mensagens podem ter retenção automática. Ao fim da licença, a empresa pode exportar os dados e pedir a eliminação. Dados recebidos do Meta são apagados quando a empresa desconecta ou quando o Meta envia um pedido de exclusão (ver /exclusao-de-dados).',
  ] },
  { title: '10. Direitos dos titulares', body: [
    'Pela LGPD, o titular pode pedir confirmação, acesso, correção, anonimização, portabilidade, eliminação e informação sobre compartilhamento. Se os seus dados estão no CRM de uma empresa cliente (por exemplo, você preencheu um formulário dela), o pedido deve ser feito a essa empresa, que é a controladora; a 2B ajuda a empresa a atender. Pedidos sobre dados de usuário do sistema ou dúvidas: veja o contato abaixo.',
  ] },
  { title: '11. Contato', body: [`E-mail: ${OPERATOR.email}`] },
  { title: '12. Alterações', body: ['Esta política pode ser atualizada; a data da última revisão fica no topo. Mudanças relevantes são avisadas no sistema.'] },
]

export default function PrivacyPage() {
  return <LegalPage title="Política de Privacidade" updated="29 de outubro de 2026" sections={S} />
}
