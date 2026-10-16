// Integração com a API da ZapSign (https://docs.zapsign.com.br).
// Endpoints conferidos na documentação em 16/10/2026:
//   POST /models/create-doc/        — documento a partir de modelo (1 signatário na criação)
//   POST /docs/{token}/add-signer/  — demais signatários
//   POST /docs/                     — documento a partir de PDF (base64_pdf)
//   GET  /docs/{token}/             — detalhes/status
//   POST /user/company/webhook/     — cadastra webhook
// Os links original_file/signed_file da ZapSign valem só 60 minutos: o CRM
// baixa o PDF assinado e guarda nos arquivos do contrato.

// Ambientes (docs.zapsign.com.br → ZapSign Environments): produção tem validade
// jurídica e exige plano de API; sandbox (teste) tem conta e token próprios.
const BASE_URL = { producao: 'https://api.zapsign.com.br/api/v1', sandbox: 'https://sandbox.api.zapsign.com.br/api/v1' }
export type ZapAuth = { token: string; sandbox: boolean }

function friendlyError(status: number, text: string): string {
  if (status === 402) {
    return 'A conta da ZapSign não tem Plano de API: em produção a ZapSign exige esse plano para o CRM criar documentos. ' +
      'Contrate o Plano de API com a ZapSign (o token já está certo) ou use o ambiente "Teste" com uma conta sandbox para testar. ' +
      'Enquanto isso, assine pela própria ZapSign e anexe o PDF na aba Contrato e aditivos marcando "já está assinado".'
  }
  if (status === 401 || status === 403) {
    if (/token/i.test(text)) {
      return 'A ZapSign não reconheceu o token da API. Confira em Configurações → ZapSign: (1) o token foi copiado em Configurações → Integrações → API ZapSign da conta certa e não foi gerado de novo depois; ' +
        '(2) o Ambiente bate com a conta (token de teste/sandbox só funciona em "Teste"); (3) a conta de produção tem plano de API ativo.'
    }
    return `A ZapSign recusou o acesso (${status}). Verifique o plano de API e as permissões da conta.`
  }
  return `ZapSign respondeu ${status}: ${text.slice(0, 300)}`
}

export type ZapSignSignerInput = {
  name: string
  email: string
  phone?: string            // só dígitos, com DDD
  qualification?: string
  sendWhatsApp?: boolean
}

export type ZapSignSigner = {
  token: string
  name: string
  email: string
  status: string
  sign_url: string
  signed_at?: string | null
}

export type ZapSignDocument = {
  token: string
  status: string            // pending | signed | refused | ...
  name: string
  original_file: string | null
  signed_file: string | null
  signers: ZapSignSigner[]
}

async function call<T>(auth: ZapAuth, path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`${auth.sandbox ? BASE_URL.sandbox : BASE_URL.producao}${path}`, {
    method: init?.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token.trim()}` },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    cache: 'no-store',
  })
  const text = await res.text()
  if (!res.ok) throw new Error(friendlyError(res.status, text))
  return (text ? JSON.parse(text) : {}) as T
}

const digits = (s?: string) => (s ?? '').replace(/\D/g, '')

function signerBody(s: ZapSignSignerInput) {
  const phone = digits(s.phone)
  return {
    name: s.name,
    email: s.email,
    phone_country: phone ? '55' : '',
    phone_number: phone,
    send_automatic_email: true,
    send_automatic_whatsapp: !!(s.sendWhatsApp && phone),
    qualification: s.qualification ?? '',
  }
}

export async function addZapSignSigner(apiToken: ZapAuth, docToken: string, s: ZapSignSignerInput): Promise<ZapSignSigner> {
  return call<ZapSignSigner>(apiToken, `/docs/${docToken}/add-signer/`, { method: 'POST', body: signerBody(s) })
}

// Documento a partir de um modelo DOCX cadastrado na ZapSign ({{variáveis}} preenchidas pelo CRM)
export async function createZapSignFromTemplate(opts: {
  apiToken: ZapAuth
  templateToken: string
  documentName: string
  data: Record<string, string>
  signers: ZapSignSignerInput[]
  externalId: string
}): Promise<ZapSignDocument> {
  const [first, ...rest] = opts.signers
  const phone = digits(first.phone)
  const doc = await call<ZapSignDocument>(opts.apiToken, '/models/create-doc/', {
    method: 'POST',
    body: {
      template_id: opts.templateToken,
      signer_name: first.name,
      signer_email: first.email,
      signer_phone_country: phone ? '55' : '',
      signer_phone_number: phone,
      send_automatic_email: true,
      send_automatic_whatsapp: !!(first.sendWhatsApp && phone),
      lang: 'pt-br',
      external_id: opts.externalId,
      data: Object.entries(opts.data).map(([k, v]) => ({ de: `{{${k}}}`, para: v })),
    },
  })
  // O nome definido no CRM; a ZapSign usa o nome do modelo na criação
  for (const s of rest) doc.signers = [...(doc.signers ?? []), await addZapSignSigner(opts.apiToken, doc.token, s)]
  return { ...doc, name: opts.documentName }
}

// Documento a partir de um PDF já anexado no CRM
export async function createZapSignFromPdf(opts: {
  apiToken: ZapAuth
  documentName: string
  pdfBase64: string
  signers: ZapSignSignerInput[]
  externalId: string
}): Promise<ZapSignDocument> {
  return call<ZapSignDocument>(opts.apiToken, '/docs/', {
    method: 'POST',
    body: {
      name: opts.documentName.slice(0, 255),
      base64_pdf: opts.pdfBase64,
      lang: 'pt-br',
      external_id: opts.externalId,
      signers: opts.signers.map(signerBody),
    },
  })
}

export async function getZapSignDocument(apiToken: ZapAuth, docToken: string): Promise<ZapSignDocument> {
  return call<ZapSignDocument>(apiToken, `/docs/${docToken}/`)
}

// Cadastra o webhook da conta ZapSign da empresa (todos os eventos: type "")
// Teste de conexão: lista a 1ª página de documentos (não cria nada)
export async function testZapSignConnection(apiToken: ZapAuth): Promise<void> {
  await call(apiToken, '/docs/?page=1')
}

export async function createZapSignWebhook(apiToken: ZapAuth, url: string): Promise<unknown> {
  return call(apiToken, '/user/company/webhook/', { method: 'POST', body: { url, type: '' } })
}
