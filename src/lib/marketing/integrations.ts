// ─── Catálogo da Central de integrações (Marketing → Integrações) ───────────
// Cada integração recebe leads num endereço próprio (com chave). O passo a
// passo aparece na tela. Texto neutro: vale para qualquer empresa.
// Sem dependências de servidor.

import type { IntegrationKind } from '@/lib/leads/parse'

export type IntegrationCategory = 'ads' | 'automacao' | 'site'
export const CATEGORY_LABEL: Record<IntegrationCategory, string> = {
  ads: 'Anúncios (ADS)',
  automacao: 'Automação de marketing',
  site: 'Site e formulários',
}

export type IntegrationDef = {
  kind: IntegrationKind
  name: string
  category: IntegrationCategory
  short: string
  how: 'direto' | 'ponte'       // direto: a ferramenta manda para o CRM; ponte: via Zapier/Make
  source: string                // origem gravada no lead
  steps: string[]               // {url} = endereço desta integração
  note?: string
}

export const INTEGRATIONS: IntegrationDef[] = [
  {
    kind: 'meta_lead_ads', name: 'Facebook / Instagram Lead Ads', category: 'ads', short: 'Formulário dentro do anúncio do Meta', how: 'ponte', source: 'anuncio',
    steps: [
      'No Zapier (ou Make), crie uma automação com o gatilho "Facebook Lead Ads → New Lead" e escolha a página e o formulário.',
      'Como ação, use "Webhooks → POST" (no Make: "HTTP → Make a request", método POST, formato JSON).',
      'Endereço (URL): {url}',
      'Mapeie os campos: name (nome), email, phone (telefone), company_name (empresa), cnpj e, se quiser, utm_campaign com o código da campanha do CRM.',
      'Faça um teste no Zapier/Make: o lead aparece em Leads, com canal Meta.',
    ],
    note: 'Ligação direta com o Meta (sem Zapier/Make) depende de aprovação do app da plataforma pelo Meta.',
  },
  {
    kind: 'linkedin_lead_forms', name: 'LinkedIn Lead Gen Forms', category: 'ads', short: 'Formulário dentro do anúncio do LinkedIn', how: 'ponte', source: 'anuncio',
    steps: [
      'No Zapier (ou Make), crie uma automação com o gatilho do LinkedIn Lead Gen Forms ("New Form Response") e escolha a conta de anúncios e o formulário.',
      'Como ação, use "Webhooks → POST" com formato JSON.',
      'Endereço (URL): {url}',
      'Mapeie os campos: name (ou firstName + lastName), email, phone, company_name e, se quiser, utm_campaign com o código da campanha.',
      'Faça um teste: o lead aparece em Leads, com canal LinkedIn.',
    ],
    note: 'Confira no Zapier/Make se o gatilho do LinkedIn está disponível no seu plano. Ligação direta depende de aprovação do LinkedIn.',
  },
  {
    kind: 'google_ads_form', name: 'Formulário de lead do Google Ads', category: 'ads', short: 'Formulário dentro do anúncio do Google', how: 'direto', source: 'anuncio',
    steps: [
      'No Google Ads, abra o recurso de formulário de lead da campanha e vá em "Exportar leads / Integração com CRM (webhook)".',
      'URL do webhook: {url}',
      'Chave: use qualquer texto (o endereço acima já tem a chave do CRM).',
      'Clique em "Enviar dados de teste": um lead de teste deve aparecer em Leads.',
    ],
    note: 'Os nomes dos menus do Google Ads mudam com frequência; procure por "webhook" no formulário de lead.',
  },
  {
    kind: 'rd_station', name: 'RD Station Marketing', category: 'automacao', short: 'Conversões do RD viram leads no CRM', how: 'direto', source: 'formulario_site',
    steps: [
      'No RD Station Marketing, vá em Integrações → Webhooks e crie um webhook.',
      'Gatilho: conversão (ou "marcado como oportunidade", se quiser só os leads quentes).',
      'URL: {url}',
      'Salve e faça uma conversão de teste numa landing page ou formulário do RD.',
      'Se a mesma pessoa converter de novo, o CRM não duplica: registra a nova conversão no histórico do lead.',
    ],
    note: 'O caminho dos menus pode variar conforme o plano do RD. Envio de listas do CRM para o RD: próxima etapa.',
  },
  {
    kind: 'mailchimp', name: 'Mailchimp', category: 'automacao', short: 'Novos inscritos e descadastros do Mailchimp', how: 'direto', source: 'formulario_site',
    steps: [
      'No Mailchimp, abra o Público (Audience) → Configurações (Settings) → Webhooks → criar webhook.',
      'URL de retorno (Callback URL): {url}',
      'Marque os eventos: inscrições (subscribes), atualizações de perfil e descadastros (unsubscribes).',
      'Salve. Novo inscrito vira lead; descadastro fica registrado no histórico do lead.',
    ],
    note: 'Envio de listas do CRM para o Mailchimp: próxima etapa.',
  },
  {
    kind: 'site', name: 'Site (JSON / JavaScript)', category: 'site', short: 'Formulário próprio do site, envio em JSON ou formulário comum', how: 'direto', source: 'formulario_site',
    steps: [
      'Quem cuida do site faz o formulário enviar (POST) para: {url}',
      'Campos aceitos: name/nome, email, phone/telefone, company_name/empresa, cnpj, message/mensagem — em português ou inglês.',
      'A origem do link (utm_source, utm_campaign, gclid, fbclid) pode ir junto; o código pronto abaixo já faz isso.',
    ],
  },
  {
    kind: 'wordpress', name: 'WordPress (Elementor / Contact Form 7)', category: 'site', short: 'Formulários de sites WordPress', how: 'direto', source: 'formulario_site',
    steps: [
      'Elementor Pro: no formulário, em "Ações após o envio", adicione "Webhook" e cole: {url}',
      'Contact Form 7: instale um plugin de webhook para o CF7 (procure "CF7 webhook" no repositório de plugins) e cole o mesmo endereço.',
      'Dê aos campos nomes reconhecíveis (nome, email, telefone, empresa, cnpj, mensagem). O CRM entende variações em português e inglês.',
      'Envie o formulário uma vez para testar: o lead aparece em Leads.',
    ],
  },
  {
    kind: 'google_forms', name: 'Google Forms', category: 'site', short: 'Respostas de um Formulário Google viram leads', how: 'direto', source: 'formulario_site',
    steps: [
      'Abra o formulário no Google Forms → menu ⋮ → Editor de scripts (Apps Script).',
      'Cole o código abaixo, salve e clique em Executar uma vez para autorizar.',
      'Em Acionadores (relógio), adicione: função onFormSubmit, evento "Ao enviar formulário".',
      'As perguntas são lidas pelo título (Nome, E-mail, Telefone, Empresa, CNPJ…). Envie uma resposta de teste.',
    ],
  },
  {
    kind: 'whatsapp_button', name: 'Botão de WhatsApp no site', category: 'site', short: 'Botão flutuante: a pessoa deixa os dados, vira lead e abre o WhatsApp', how: 'direto', source: 'formulario_site',
    steps: [
      'Informe abaixo o número do WhatsApp (com DDD) e a mensagem inicial, e salve.',
      'Copie o código e cole no site, antes do fechamento da página (</body>). No WordPress: plugin de "inserir código no rodapé".',
      'Quem clica no botão preenche nome, empresa e telefone: vira lead (com a origem do anúncio) e o WhatsApp abre com a mensagem.',
    ],
  },
  {
    kind: 'zapier', name: 'Zapier / Make (qualquer ferramenta)', category: 'site', short: 'Liga ao CRM ferramentas que não estão na lista', how: 'ponte', source: 'formulario_site',
    steps: [
      'No Zapier (Webhooks → POST) ou no Make (HTTP → Make a request), use o endereço: {url}',
      'Formato JSON, com os campos name, email, phone, company_name, cnpj, message e, se tiver, utm_source, utm_campaign.',
      'Faça um teste: o lead aparece em Leads.',
    ],
  },
]

export const integrationDef = (kind: string) => INTEGRATIONS.find(i => i.kind === kind) ?? null
