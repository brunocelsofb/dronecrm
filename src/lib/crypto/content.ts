// ─── Conteúdo criptografado por empresa (tenant) ──────────────────────────────
// AES-256-GCM com chave própria de cada empresa: HKDF-SHA256 sobre a
// SETTINGS_ENCRYPTION_KEY (nunca trocar) com o tenant_id como contexto.
// O tenant_id vai no início do texto cifrado (não é segredo) e entra como dado
// autenticado: trocar o texto de empresa faz a leitura falhar.
//   texto:  enc:v1:<tenant>:<iv>:<tag>:<dados>     (base64)
//   JSON:   enc:v1j:<tenant>:<iv>:<tag>:<dados>
// Uso só no servidor.

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

export const ENC_PREFIX = 'enc:v1:'
export const ENC_JSON_PREFIX = 'enc:v1j:'
export const UNAVAILABLE = '[conteúdo criptografado indisponível]'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const keyCache = new Map<string, Buffer>()

function masterKey(): Buffer | null {
  const raw = process.env.SETTINGS_ENCRYPTION_KEY
  if (!raw) return null
  const k = Buffer.from(raw, 'base64')
  return k.length === 32 ? k : null
}

export function contentCryptoReady(): boolean { return masterKey() !== null }

function tenantKey(tenantId: string): Buffer {
  const hit = keyCache.get(tenantId)
  if (hit) return hit
  const mk = masterKey()
  if (!mk) throw new Error('SETTINGS_ENCRYPTION_KEY ausente ou inválida.')
  const k = Buffer.from(hkdfSync('sha256', mk, Buffer.from('drone-tenant-content-v1'), Buffer.from(tenantId), 32))
  keyCache.set(tenantId, k)
  return k
}

export const isEncrypted = (v: unknown): v is string =>
  typeof v === 'string' && (v.startsWith(ENC_PREFIX) || v.startsWith(ENC_JSON_PREFIX))

function seal(prefix: string, tenantId: string, plain: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', tenantKey(tenantId), iv)
  c.setAAD(Buffer.from(tenantId))
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return `${prefix}${tenantId}:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${data.toString('base64')}`
}

// Texto → cifrado. Vazio/nulo ou já cifrado passa direto. Sem chave no servidor ou
// sem empresa válida: devolve o texto (a rotina diária cifra depois).
export function encryptText(tenantId: string | null | undefined, plain: string | null | undefined): string | null | undefined {
  if (plain === null || plain === undefined || plain === '' || isEncrypted(plain)) return plain
  if (!tenantId || !UUID_RE.test(tenantId) || !contentCryptoReady()) return plain
  return seal(ENC_PREFIX, tenantId, plain)
}

// Valor JSON (objeto/lista) → texto cifrado guardado na coluna jsonb
export function encryptJson(tenantId: string | null | undefined, value: unknown): unknown {
  if (value === null || value === undefined || isEncrypted(value)) return value
  if (!tenantId || !UUID_RE.test(tenantId) || !contentCryptoReady()) return value
  return seal(ENC_JSON_PREFIX, tenantId, JSON.stringify(value))
}

// Cifrado → original. Texto comum (antigo) passa direto.
export function decryptValue(v: unknown): unknown {
  if (!isEncrypted(v)) return v
  const json = v.startsWith(ENC_JSON_PREFIX)
  const body = v.slice(json ? ENC_JSON_PREFIX.length : ENC_PREFIX.length)
  const [tenantId, iv, tag, data] = body.split(':')
  try {
    const d = createDecipheriv('aes-256-gcm', tenantKey(tenantId), Buffer.from(iv, 'base64'))
    d.setAAD(Buffer.from(tenantId))
    d.setAuthTag(Buffer.from(tag, 'base64'))
    const plain = Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8')
    return json ? JSON.parse(plain) : plain
  } catch {
    return json ? null : UNAVAILABLE
  }
}

// Empresa dona de um valor cifrado (ou null)
export function encryptedTenant(v: unknown): string | null {
  if (!isEncrypted(v)) return null
  const body = v.slice(v.startsWith(ENC_JSON_PREFIX) ? ENC_JSON_PREFIX.length : ENC_PREFIX.length)
  return body.split(':')[0] || null
}

// Percorre o resultado de uma consulta e abre tudo o que estiver cifrado
export function decryptDeep<T>(v: T): T {
  if (isEncrypted(v)) return decryptValue(v) as T
  if (Array.isArray(v)) {
    let changed = false
    const out = v.map(x => { const y = decryptDeep(x); if (y !== x) changed = true; return y })
    return (changed ? out : v) as T
  }
  if (v && typeof v === 'object' && !(v instanceof Date) && !Buffer.isBuffer(v)) {
    let out: Record<string, unknown> | null = null
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      const y = decryptDeep(x)
      if (y !== x) { out ??= { ...(v as Record<string, unknown>) }; out[k] = y }
    }
    return (out ?? v) as T
  }
  return v
}

// Colunas guardadas cifradas (tabela → coluna → tipo)
export const ENCRYPTED_COLUMNS: Record<string, Record<string, 'text' | 'json'>> = {
  contract_whatsapp_messages: { message: 'text' },
  sdr_conversations: { summary: 'text', answers: 'json' },
}
