// Rotinas diárias de privacidade, empresa por empresa (cron /api/cron/privacy):
//  1. retenção: apaga as mensagens de WhatsApp mais antigas que o prazo da empresa;
//  2. cifra o conteúdo antigo que ainda está em texto aberto (mensagens e conversas
//     da assistente), em lotes, até não sobrar nada.
// Só servidor (sem 'use server').

import { createRawAdminClient } from '@/lib/supabase/admin'
import { contentCryptoReady, encryptJson, encryptText, isEncrypted } from '@/lib/crypto/content'
import { resolvePrivacySettings } from './settings'

const BATCH = 300
const MAX_PER_RUN = 1500

export async function applyRetention(tenantId: string): Promise<{ days: number | null; deleted: number }> {
  const db = createRawAdminClient()
  const { data: org } = await db.from('organization_settings').select('privacy_settings').eq('tenant_id', tenantId).maybeSingle()
  const { whatsapp_retention_days: days } = resolvePrivacySettings((org as { privacy_settings?: unknown } | null)?.privacy_settings)
  if (!days) return { days: null, deleted: 0 }
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()
  const { count, error } = await db.from('contract_whatsapp_messages').delete({ count: 'exact' })
    .eq('tenant_id', tenantId).lt('created_at', cutoff)
  if (error) throw new Error(`retenção: ${error.message}`)
  return { days, deleted: count ?? 0 }
}

export async function encryptBacklog(tenantId: string): Promise<{ messages: number; sdr: number; remaining: boolean; skipped?: string }> {
  if (!contentCryptoReady()) return { messages: 0, sdr: 0, remaining: true, skipped: 'SETTINGS_ENCRYPTION_KEY ausente' }
  const db = createRawAdminClient()
  let messages = 0
  let remaining = false
  while (messages < MAX_PER_RUN) {
    const { data, error } = await db.from('contract_whatsapp_messages').select('id, message')
      .eq('tenant_id', tenantId).not('message', 'is', null).neq('message', '').not('message', 'like', 'enc:v1%')
      .order('created_at', { ascending: true }).limit(BATCH)
    if (error) throw new Error(`cifrar mensagens: ${error.message}`)
    if (!data?.length) break
    for (let i = 0; i < data.length; i += 20) {
      await Promise.all(data.slice(i, i + 20).map(r =>
        db.from('contract_whatsapp_messages').update({ message: encryptText(tenantId, r.message as string) })
          .eq('id', r.id).eq('tenant_id', tenantId).not('message', 'like', 'enc:v1%')))
    }
    messages += data.length
    if (data.length < BATCH) break
    if (messages >= MAX_PER_RUN) remaining = true
  }

  let sdr = 0
  const { data: convs } = await db.from('sdr_conversations').select('id, summary, answers').eq('tenant_id', tenantId).limit(1000)
  for (const c of convs ?? []) {
    const patch: Record<string, unknown> = {}
    if (c.summary && !isEncrypted(c.summary)) patch.summary = encryptText(tenantId, c.summary as string)
    if (c.answers && !isEncrypted(c.answers)) patch.answers = encryptJson(tenantId, c.answers)
    if (Object.keys(patch).length) { await db.from('sdr_conversations').update(patch).eq('id', c.id).eq('tenant_id', tenantId); sdr++ }
  }
  return { messages, sdr, remaining }
}
