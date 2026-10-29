// Assinaturas do Meta (só node:crypto, para poder testar):
// - X-Hub-Signature-256 dos avisos (webhook): HMAC-SHA256 do corpo com o segredo do app
// - signed_request do pedido de exclusão de dados: "assinatura.dados" em base64url
import { createHmac, timingSafeEqual } from 'node:crypto'

export function validWebhookSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  const sig = String(header ?? '').replace(/^sha256=/, '')
  if (!/^[0-9a-f]{64}$/i.test(sig)) return false
  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')
  return timingSafeEqual(Buffer.from(sig.toLowerCase(), 'hex'), Buffer.from(expected, 'hex'))
}

const b64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')

export function parseSignedRequest(signed: string, appSecret: string): Record<string, unknown> | null {
  const [sig, payload] = String(signed ?? '').split('.')
  if (!sig || !payload) return null
  const expected = createHmac('sha256', appSecret).update(payload).digest()
  const got = b64url(sig)
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null
  try {
    const data = JSON.parse(b64url(payload).toString('utf8')) as Record<string, unknown>
    return String(data.algorithm ?? '').toUpperCase() === 'HMAC-SHA256' ? data : null
  } catch { return null }
}
