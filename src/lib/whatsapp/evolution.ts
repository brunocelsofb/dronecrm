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

export async function sendEvoTextMessage({
  serverUrl, apiKey, instanceName, phone, message
}: EvoCredentials & { phone: string; message: string }): Promise<{ key?: { id: string } }> {
  const cleanPhone = sanitizePhoneForEvo(phone)
  console.log('[evo] sendText phone:', phone, '→', cleanPhone)
  const res = await fetch(`${serverUrl}/message/sendText/${instanceName}`, {
    method: 'POST',
    headers: { 'apikey': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ number: cleanPhone, text: message }),
  })
  if (!res.ok) {
    const text = await res.text()
    console.error('[evo] sendText falhou:', res.status, text)
    throw new Error(`Evolution API ${res.status}: ${text.slice(0, 200)}`)
  }
  return res.json()
}

export async function sendEvoImageMessage({
  serverUrl, apiKey, instanceName, phone, imageUrl, caption
}: EvoCredentials & { phone: string; imageUrl: string; caption?: string }): Promise<void> {
  const cleanPhone = sanitizePhoneForEvo(phone)
  await fetch(`${serverUrl}/message/sendMedia/${instanceName}`, {
    method: 'POST',
    headers: { 'apikey': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ number: cleanPhone, mediatype: 'image', media: imageUrl, caption: caption ?? '' }),
  })
}

export async function sendEvoDocumentMessage({
  serverUrl, apiKey, instanceName, phone, documentUrl, fileName, caption
}: EvoCredentials & { phone: string; documentUrl: string; fileName: string; caption?: string }): Promise<void> {
  const cleanPhone = sanitizePhoneForEvo(phone)
  await fetch(`${serverUrl}/message/sendMedia/${instanceName}`, {
    method: 'POST',
    headers: { 'apikey': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ number: cleanPhone, mediatype: 'document', media: documentUrl, fileName, caption: caption ?? '' }),
  })
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
