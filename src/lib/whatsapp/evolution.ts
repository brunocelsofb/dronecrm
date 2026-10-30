// Integração com Evolution API (substitui Z-API)
// Docs: https://doc.evolution-api.com

import { evolutionWebhookUrl, EVO_WEBHOOK_EVENTS } from '@/lib/whatsapp/webhook-token'

export type EvoCredentials = {
  serverUrl: string
  apiKey: string
  instanceName: string
  instanceToken?: string | null  // token específico da instância (alternativo à global key)
}

export function sanitizePhoneForEvo(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  // Já tem DDI (13 dígitos com 9: 55 + 2 DDD + 9 dígitos)
  if (digits.length >= 12) return digits
  // Adiciona DDI 55 (Brasil)
  return `55${digits}`
}

// Mensagem citada (responder citando): id do WhatsApp + texto curto da original
// O WhatsApp só mostra a citação quando sabe de qual conversa ela é e quem mandou a original:
// sem remoteJid/fromMe, a mensagem chega solta no celular do contato.
export type EvoQuoted = { id: string; text?: string | null; fromMe?: boolean | null; phone?: string | null }
const quotedBody = (q?: EvoQuoted | null) => q?.id ? {
  quoted: {
    key: { id: q.id, fromMe: !!q.fromMe, ...(q.phone ? { remoteJid: `${sanitizePhoneForEvo(q.phone)}@s.whatsapp.net` } : {}) },
    message: { conversation: (q.text ?? '').slice(0, 500) },
  },
} : {}

// A mensagem original guardada no servidor (com a miniatura da foto e o identificador
// exato da conversa, que no Brasil às vezes não tem o 9). Melhor esforço: 4 s.
async function findEvoMessage({ serverUrl, apiKey, instanceName }: EvoCredentials, id: string): Promise<{ key: Record<string, unknown>; message: Record<string, unknown> } | null> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 4000)
    const res = await fetch(`${serverUrl}/chat/findMessages/${instanceName}`, {
      method: 'POST',
      headers: { 'apikey': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ where: { key: { id } }, page: 1, offset: 5 }),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(t))
    if (!res.ok) return null
    const d = await res.json().catch(() => null)
    const list: any[] = Array.isArray(d) ? d : Array.isArray(d?.messages) ? d.messages : Array.isArray(d?.messages?.records) ? d.messages.records : Array.isArray(d?.records) ? d.records : []
    const m = list.find(x => x?.key?.id === id)
    if (!m?.key?.remoteJid || !m?.message || typeof m.message !== 'object') return null
    // Só o conteúdo: tira mídia em base64, se o servidor guardar
    const { base64: _b, ...message } = m.message
    void _b
    return { key: { id: m.key.id, remoteJid: m.key.remoteJid, fromMe: !!m.key.fromMe, ...(m.key.participant ? { participant: m.key.participant } : {}) }, message }
  } catch { return null }
}

// Envia com citação: primeiro com a original do servidor (miniatura etc.); se o servidor
// recusar esse formato, repete com a citação simples, que sempre funcionou.
async function postWithQuote(creds: EvoCredentials, path: string, body: Record<string, unknown>, q?: EvoQuoted | null): Promise<Response> {
  const send = (extra: Record<string, unknown>) => fetch(`${creds.serverUrl}${path}/${creds.instanceName}`, {
    method: 'POST',
    headers: { 'apikey': creds.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, ...extra }),
  })
  if (!q?.id) return send({})
  const original = await findEvoMessage(creds, q.id)
  if (original) {
    const res = await send({ quoted: original })
    if (res.ok || res.status !== 400) return res
    console.warn('[evo] citação completa recusada; usando a simples')
  }
  return send(quotedBody(q))
}

export async function sendEvoTextMessage({
  serverUrl, apiKey, instanceName, phone, message, quoted
}: EvoCredentials & { phone: string; message: string; quoted?: EvoQuoted | null }): Promise<{ key?: { id: string } }> {
  const cleanPhone = sanitizePhoneForEvo(phone)
  console.log('[evo] sendText phone:', phone, '→', cleanPhone)
  const res = await postWithQuote({ serverUrl, apiKey, instanceName }, '/message/sendText', { number: cleanPhone, text: message }, quoted)
  if (!res.ok) {
    const text = await res.text()
    console.error('[evo] sendText falhou:', res.status, text)
    throw new Error(`Evolution API ${res.status}: ${text.slice(0, 200)}`)
  }
  return res.json()
}

// Foto, vídeo ou documento. Devolve a resposta do servidor (key.id = id no WhatsApp) e
// falha quando o servidor recusa — assim a mensagem fica como "falhou", e não como enviada.
async function sendEvoMedia(
  { serverUrl, apiKey, instanceName }: EvoCredentials,
  body: Record<string, unknown>,
  quoted?: EvoQuoted | null,
): Promise<{ key?: { id: string } }> {
  const res = await postWithQuote({ serverUrl, apiKey, instanceName }, '/message/sendMedia', body, quoted)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    console.error('[evo] sendMedia falhou:', res.status, text.slice(0, 300))
    throw new Error(`Evolution API ${res.status}: ${text.slice(0, 200)}`)
  }
  return res.json().catch(() => ({}))
}

export async function sendEvoImageMessage({
  phone, imageUrl, caption, quoted, ...creds
}: EvoCredentials & { phone: string; imageUrl: string; caption?: string; quoted?: EvoQuoted | null }): Promise<{ key?: { id: string } }> {
  return sendEvoMedia(creds, { number: sanitizePhoneForEvo(phone), mediatype: 'image', media: imageUrl, caption: caption ?? '' }, quoted)
}

export async function sendEvoVideoMessage({
  phone, videoUrl, caption, quoted, ...creds
}: EvoCredentials & { phone: string; videoUrl: string; caption?: string; quoted?: EvoQuoted | null }): Promise<{ key?: { id: string } }> {
  return sendEvoMedia(creds, { number: sanitizePhoneForEvo(phone), mediatype: 'video', media: videoUrl, caption: caption ?? '' }, quoted)
}

export async function sendEvoDocumentMessage({
  phone, documentUrl, fileName, caption, quoted, ...creds
}: EvoCredentials & { phone: string; documentUrl: string; fileName: string; caption?: string; quoted?: EvoQuoted | null }): Promise<{ key?: { id: string } }> {
  return sendEvoMedia(creds, { number: sanitizePhoneForEvo(phone), mediatype: 'document', media: documentUrl, fileName, caption: caption ?? '' }, quoted)
}

// Áudio de voz (aparece como mensagem de voz gravada, com o microfone azul)
export async function sendEvoVoice({
  serverUrl, apiKey, instanceName, phone, audioUrl, quoted,
}: EvoCredentials & { phone: string; audioUrl: string; quoted?: EvoQuoted | null }): Promise<{ key?: { id: string } }> {
  const res = await postWithQuote({ serverUrl, apiKey, instanceName }, '/message/sendWhatsAppAudio', { number: sanitizePhoneForEvo(phone), audio: audioUrl }, quoted)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Evolution API ${res.status}: ${text.slice(0, 200)}`)
  }
  return res.json().catch(() => ({}))
}

const jidOf = (phone: string) => `${sanitizePhoneForEvo(phone)}@s.whatsapp.net`

// Reação numa mensagem (emoji vazio tira a reação)
export async function sendEvoReaction({
  serverUrl, apiKey, instanceName, phone, messageId, fromMe, emoji,
}: EvoCredentials & { phone: string; messageId: string; fromMe: boolean; emoji: string }): Promise<void> {
  const res = await fetch(`${serverUrl}/message/sendReaction/${instanceName}`, {
    method: 'POST',
    headers: { 'apikey': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: { id: messageId, remoteJid: jidOf(phone), fromMe }, reaction: emoji }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Evolution API ${res.status}: ${text.slice(0, 200)}`)
  }
}

// Avisa o WhatsApp que as mensagens recebidas foram lidas (tiques azuis para o contato)
export async function markEvoRead({
  serverUrl, apiKey, instanceName, phone, messageIds,
}: EvoCredentials & { phone: string; messageIds: string[] }): Promise<boolean> {
  if (!messageIds.length) return true
  try {
    const remoteJid = jidOf(phone)
    const res = await fetch(`${serverUrl}/chat/markMessageAsRead/${instanceName}`, {
      method: 'POST',
      headers: { 'apikey': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ readMessages: messageIds.map(id => ({ id, fromMe: false, remoteJid })) }),
    })
    return res.ok
  } catch { return false }
}

export async function getEvoQrCode({
  serverUrl, apiKey, instanceName,
}: EvoCredentials): Promise<{ base64?: string; status?: string; error?: string }> {
  const auth = { 'apikey': apiKey, 'Content-Type': 'application/json' }

  const fetchQr = async (): Promise<string | null> => {
    try {
      const res = await fetch(`${serverUrl}/instance/connect/${instanceName}`, { headers: auth })
      if (!res.ok) return null
      const d = await res.json().catch(() => ({}))
      const qr = d?.qrcode?.base64 ?? d?.base64 ?? d?.code ?? null
      return qr && typeof qr === 'string' && qr !== 'undefined' && qr !== '' ? qr : null
    } catch { return null }
  }

  // 1. Tenta direto (instância pode já estar gerando)
  let qr = await fetchQr()

  // 2. Se não veio, cria a instância (ignora erro se já existir)
  if (!qr) {
    try {
      const cr = await fetch(`${serverUrl}/instance/create`, {
        method: 'POST', headers: auth,
        body: JSON.stringify({ instanceName, qrcode: true, integration: 'WHATSAPP-BAILEYS' }),
      })
      const cd = await cr.json().catch(() => ({}))
      console.log('[evo] create:', cr.status, JSON.stringify(cd))
      const earlyQr = cd?.qrcode?.base64 ?? cd?.base64 ?? cd?.code ?? null
      if (earlyQr && typeof earlyQr === 'string' && earlyQr !== 'undefined') qr = earlyQr
    } catch { /* ignora */ }
  }

  // 3. Polling: 3 tentativas a cada 2s
  for (let i = 0; i < 3 && !qr; i++) {
    console.log(`[evo] polling ${i + 1}/3`)
    await new Promise(r => setTimeout(r, 2000))
    qr = await fetchQr()
  }

  // 4. Retorna QR formatado ou aviso para tentar novamente
  if (qr) {
    return { base64: qr.startsWith('data:image') ? qr : `data:image/png;base64,${qr}` }
  }

  return { error: 'Gerando QR Code... Aguarde 5 segundos e clique em Salvar novamente.' }
}

function formatQr(raw: string): string {
  return raw.startsWith('data:image') ? raw : `data:image/png;base64,${raw}`
}

function parseEvoError(data: any, status: number): string {
  if (typeof data?.message === 'string') return data.message
  if (Array.isArray(data?.message) && data.message.length > 0)
    return typeof data.message[0] === 'string' ? data.message[0] : JSON.stringify(data.message[0])
  if (typeof data?.error === 'string') return data.error
  return `HTTP ${status}`
}

export async function getEvoInstanceStatus({
  serverUrl, apiKey, instanceName
}: EvoCredentials): Promise<{ state?: string }> {
  try {
    const res = await fetch(`${serverUrl}/instance/connectionState/${instanceName}`, {
      headers: { 'apikey': apiKey },
    })
    if (!res.ok) return {}
    const data = await res.json()
    return { state: data?.instance?.state ?? data?.state ?? data?.connectionStatus }
  } catch { return {} }
}

export async function verifyEvoConnection(creds: EvoCredentials): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${creds.serverUrl}/instance/fetchInstances?instanceName=${creds.instanceName}`, {
      headers: { 'apikey': creds.apiKey },
    })
    if (!res.ok) return { ok: true } // assume ok se o servidor respondeu (sem dados ainda)
    const data = await res.json().catch(() => [])
    const inst = Array.isArray(data) ? data[0] : data
    const state = inst?.instance?.state ?? inst?.state
    // Se não tem estado ainda (instância nova), considera ok
    return { ok: true, error: state === 'close' ? undefined : undefined }
  } catch (e: any) {
    return { ok: false, error: e.message }
  }
}

// URL com o token da instância (webhook-token.ts); o webhook recusa token errado.
export async function setEvoWebhook({
  serverUrl, apiKey, instanceName,
}: EvoCredentials): Promise<{ ok: boolean; error?: string }> {
  try {
    const webhookUrl = evolutionWebhookUrl(instanceName)
    const res = await fetch(`${serverUrl}/webhook/set/${encodeURIComponent(instanceName)}`, {
      method: 'POST',
      headers: { 'apikey': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        webhook: {
          enabled: true,
          url: webhookUrl,
          webhookByEvents: true,
          webhookBase64: false,
          events: EVO_WEBHOOK_EVENTS,
        },
      }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      return { ok: false, error: data?.message ?? `HTTP ${res.status}` }
    }
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e.message }
  }
}
