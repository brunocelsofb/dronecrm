// Integração com a API da ZapSign (https://docs.zapsign.com.br).
// Endpoints conferidos na documentação em 16/10/2026:
//   POST /models/create-doc/        — documento a partir de modelo (1 signatário na criação)
//   POST /docs/{token}/add-signer/  — demais signatários
//   POST /docs/                     — documento a partir de PDF (base64_pdf)
//   GET  /docs/{token}/             — detalhes/status
//   POST /user/company/webhook/     — cadastra webhook
// Os links original_file/signed_file da ZapSign valem só 60 minutos: o CRM
// baixa o PDF assinado e guarda nos arquivos do contrato.

const ZAPSIGN_BASE_URL = 'https://api.zapsign.com.br/api/v1'

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

async function call<T>(apiToken: string, path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`${ZAPSIGN_BASE_URL}${path}`, {
    method: init?.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiToken}` },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    cache: 'no-store',
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`ZapSign respondeu ${res.status}: ${text.slice(0, 300)}`)
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

export async function addZapSignSigner(apiToken: string, docToken: string, s: ZapSignSignerInput): Promise<ZapSignSigner> {
  return call<ZapSignSigner>(apiToken, `/docs/${docToken}/add-signer/`, { method: 'POST', body: signerBody(s) })
}

// Documento a partir de um modelo DOCX cadastrado na ZapSign ({{variáveis}} preenchidas pelo CRM)
export async function createZapSignFromTemplate(opts: {
  apiToken: string
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
  apiToken: string
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

export async function getZapSignDocument(apiToken: string, docToken: string): Promise<ZapSignDocument> {
  return call<ZapSignDocument>(apiToken, `/docs/${docToken}/`)
}

// Cadastra o webhook da conta ZapSign da empresa (todos os eventos: type "")
export async function createZapSignWebhook(apiToken: string, url: string): Promise<unknown> {
  return call(apiToken, '/user/company/webhook/', { method: 'POST', body: { url, type: '' } })
}
