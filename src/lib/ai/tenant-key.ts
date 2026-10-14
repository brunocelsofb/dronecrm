// ─── Chave da Anthropic de cada empresa (Copiloto IA) ─────────────────────────
// A empresa cadastra a própria chave em Configurações → Copiloto IA; o consumo
// é cobrado na conta dela. A chave fica criptografada (AES-256-GCM) com a
// variável SETTINGS_ENCRYPTION_KEY do Vercel (32 bytes em base64) e nunca volta
// para o navegador — a tela só mostra o final.
//
// Sem chave cadastrada, o Copiloto fica desligado. Exceção temporária: a
// empresa padrão (Orbis) usa ANTHROPIC_API_KEY do Vercel até cadastrar a dela.

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { getDefaultTenantId } from '@/lib/tenant/context'

function encKey(): Buffer {
  const raw = process.env.SETTINGS_ENCRYPTION_KEY
  if (!raw) throw new Error('SETTINGS_ENCRYPTION_KEY não configurada no servidor.')
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) throw new Error('SETTINGS_ENCRYPTION_KEY deve ter 32 bytes (base64).')
  return key
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encKey(), iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${data.toString('base64')}`
}

export function decryptSecret(blob: string): string {
  const [v, iv, tag, data] = blob.split(':')
  if (v !== 'v1' || !iv || !tag || !data) throw new Error('Formato de segredo inválido.')
  const decipher = createDecipheriv('aes-256-gcm', encKey(), Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8')
}

export type AnthropicKeyInfo = { key: string | null; source: 'tenant' | 'platform' | null; last4: string | null }

export async function getAnthropicKeyForTenant(tenantId: string | null | undefined): Promise<AnthropicKeyInfo> {
  if (!tenantId) return { key: null, source: null, last4: null }
  const { data } = await createAdminClient()
    .from('organization_settings').select('anthropic_api_key_enc').eq('tenant_id', tenantId).maybeSingle()
  if (data?.anthropic_api_key_enc) {
    try {
      const key = decryptSecret(String(data.anthropic_api_key_enc))
      return { key, source: 'tenant', last4: key.slice(-4) }
    } catch (e) {
      console.error('[ai-key] falha ao ler a chave da empresa:', e instanceof Error ? e.message : e)
      return { key: null, source: null, last4: null }
    }
  }
  if (tenantId === (await getDefaultTenantId()) && process.env.ANTHROPIC_API_KEY) {
    return { key: process.env.ANTHROPIC_API_KEY, source: 'platform', last4: process.env.ANTHROPIC_API_KEY.slice(-4) }
  }
  return { key: null, source: null, last4: null }
}

export const NO_AI_KEY_MESSAGE =
  'O Copiloto IA não está ativado: cadastre a chave da Anthropic da sua empresa em Configurações → Copiloto IA.'
