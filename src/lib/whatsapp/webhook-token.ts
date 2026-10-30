// ─── Token do webhook da Evolution, por instância ─────────────────────────────
// O servidor Evolution não assina os webhooks. Para o CRM saber que o evento veio
// mesmo do servidor (e de qual instância), cada instância é registrada com uma URL
// própria: /api/whatsapp-inbound/evolution/<token>. O token é um HMAC do nome da
// instância com uma chave derivada de SETTINGS_ENCRYPTION_KEY (nunca trocar), então
// não precisa de variável nova e não fica gravado em lugar nenhum.
//
// O token vai no caminho (não na query) porque, com webhookByEvents, a Evolution
// pode acrescentar o nome do evento ao fim da URL.

import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto'

let cachedKey: Buffer | null = null

function webhookKey(): Buffer {
  if (cachedKey) return cachedKey
  const raw = process.env.SETTINGS_ENCRYPTION_KEY
  const mk = raw ? Buffer.from(raw, 'base64') : null
  if (!mk || mk.length !== 32) throw new Error('SETTINGS_ENCRYPTION_KEY ausente ou inválida.')
  cachedKey = Buffer.from(hkdfSync('sha256', mk, Buffer.from('drone-evo-webhook-v1'), Buffer.from('evolution-webhook'), 32))
  return cachedKey
}

export function evoWebhookToken(instanceName: string): string {
  return createHmac('sha256', webhookKey()).update(instanceName, 'utf8').digest('base64url').slice(0, 32)
}

export function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? 'https://crm-gestaocontratos-pi.vercel.app').replace(/\/+$/, '')
}

export function evolutionWebhookUrl(instanceName: string): string {
  return `${appBaseUrl()}/api/whatsapp-inbound/evolution/${evoWebhookToken(instanceName)}`
}

export function isValidEvoWebhookToken(instanceName: string, token: string): boolean {
  let expected: Buffer
  try { expected = Buffer.from(evoWebhookToken(instanceName)) } catch { return false }
  const got = Buffer.from(token)
  return got.length === expected.length && timingSafeEqual(got, expected)
}

// MESSAGES_UPDATE: tiques de entregue e lido
export const EVO_WEBHOOK_EVENTS = ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'MESSAGES_DELETE', 'SEND_MESSAGE', 'CONNECTION_UPDATE']
