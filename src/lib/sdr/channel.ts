// ─── Canal de envio do SDR de IA ──────────────────────────────────────────────
// Hoje: Evolution (servidor da plataforma ou da empresa). Preparado: API oficial
// da Meta (WhatsApp Cloud API). Trocar de canal é só configuração da empresa.
//
// Meta: POST https://graph.facebook.com/{versão}/{phone_number_id}/messages com
// o token da empresa. A versão da API é informada na configuração; confira a
// versão vigente na documentação da Meta antes de ligar (ela muda com o tempo).
// O recebimento pela Meta (webhook) ainda não está ligado — ver README do SDR.

import { createAdminClient } from '@/lib/supabase/admin'
import { getTenantEvoCreds } from '@/lib/whatsapp/tenant-evo'
import { sendEvoTextMessage } from '@/lib/whatsapp/evolution'
import { decryptSecret } from '@/lib/ai/tenant-key'
import type { SdrSettings } from './settings'

export type SendResult = { ok: true; messageId: string | null } | { ok: false; error: string }

export async function sendSdrText(opts: {
  tenantId: string
  settings: SdrSettings
  instanceName: string
  phone: string
  text: string
}): Promise<SendResult> {
  const { tenantId, settings, instanceName, phone, text } = opts
  try {
    if (settings.channel === 'meta') return await sendViaMeta(tenantId, settings, phone, text)
    const creds = await getTenantEvoCreds(tenantId)
    if (!creds) return { ok: false, error: 'Servidor do WhatsApp não configurado.' }
    const res = await sendEvoTextMessage({ ...creds, instanceName, phone, message: text })
    return { ok: true, messageId: res?.key?.id ?? null }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : 'Falha no envio.' }
  }
}

async function sendViaMeta(tenantId: string, s: SdrSettings, phone: string, text: string): Promise<SendResult> {
  if (!s.meta.phone_number_id || !s.meta.api_version) return { ok: false, error: 'API da Meta incompleta: informe o ID do número e a versão.' }
  const { data } = await createAdminClient().from('organization_settings').select('sdr_meta_token_enc').eq('tenant_id', tenantId).maybeSingle()
  if (!data?.sdr_meta_token_enc) return { ok: false, error: 'Token da Meta não cadastrado.' }
  const token = decryptSecret(String(data.sdr_meta_token_enc))
  const digits = phone.replace(/\D/g, '')
  const to = digits.length >= 12 ? digits : `55${digits}`
  const res = await fetch(`https://graph.facebook.com/${s.meta.api_version}/${s.meta.phone_number_id}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
  })
  const body = await res.json().catch(() => null) as { messages?: { id?: string }[]; error?: { message?: string } } | null
  if (!res.ok) return { ok: false, error: `Meta ${res.status}: ${body?.error?.message ?? 'erro'}`.slice(0, 300) }
  return { ok: true, messageId: body?.messages?.[0]?.id ?? null }
}
