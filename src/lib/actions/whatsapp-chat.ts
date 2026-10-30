'use server'
// Central de WhatsApp como no app oficial: áudio de voz, reações, leitura e respostas rápidas.
// Tudo pela empresa do usuário (createScopedAdmin); instância só se for da empresa.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { resolveTenantId } from '@/lib/tenant/context'
import { withPlatformEvo, canTenantUseInstance } from '@/lib/whatsapp/tenant-evo'
import { sendEvoVoice, sendEvoReaction, markEvoRead, type EvoCredentials } from '@/lib/whatsapp/evolution'
import { applyReaction, normShortcut } from '@/lib/whatsapp/chat'
import { getSupportSession, SUPPORT_READONLY_MESSAGE } from '@/lib/tenant/support'

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

async function userId(): Promise<string | null> {
  const { data: { user } } = await (await createClient()).auth.getUser()
  return user?.id ?? null
}

// Acesso de suporte é só leitura: nada sai para o WhatsApp do contato
async function readOnlySupport(): Promise<boolean> {
  const s = await getSupportSession()
  return !!s && s.tenantId === (await resolveTenantId())
}

// Credenciais da empresa, já na instância pedida (se ela for da empresa)
async function credsFor(instanceName?: string | null): Promise<EvoCredentials | null> {
  const db = await createScopedAdmin()
  const tenantId = await resolveTenantId()
  const { data: raw } = await db.from('organization_settings')
    .select('evo_server_url, evo_api_key, evo_instance_name, evo_instance_token').eq('tenant_id', tenantId).maybeSingle()
  const data = withPlatformEvo(raw)
  if (!data?.evo_server_url || !data?.evo_api_key || !data?.evo_instance_name) return null
  const base: EvoCredentials = { serverUrl: data.evo_server_url, apiKey: data.evo_api_key, instanceName: data.evo_instance_name, instanceToken: (data as { evo_instance_token?: string | null }).evo_instance_token ?? null }
  if (!instanceName || instanceName === base.instanceName) return base
  if (!tenantId || !(await canTenantUseInstance(tenantId, instanceName))) return null
  return { ...base, instanceName }
}

const normPhone = (p: string) => { const d = String(p ?? '').replace(/\D/g, ''); return d.length <= 11 ? `55${d}` : d }

const MSG_COLS = 'id, phone, message, direction, status, triggered_automatically, error_message, created_at, media_url, media_type, media_filename, sender_photo_url, delivery_status, lead_id, zapi_message_id, quoted_id, reactions, instance_name'

// Mensagem citada: id no WhatsApp + texto (para o balão de citação do contato)
async function quotedFrom(rowId?: string | null): Promise<{ id: string; text: string } | null> {
  if (!rowId) return null
  const db = await createScopedAdmin()
  const { data } = await db.from('contract_whatsapp_messages').select('zapi_message_id, message').eq('id', rowId).maybeSingle()
  return data?.zapi_message_id ? { id: data.zapi_message_id, text: String(data.message ?? '') } : null
}

// ─── Áudio de voz gravado no navegador ───────────────────────────────────────
export async function sendWhatsAppVoice(phone: string, audioUrl: string, instanceName?: string | null, quotedRowId?: string | null): Promise<Result<{ message?: unknown }>> {
  const uid = await userId()
  if (!uid) return { ok: false, error: 'Usuário não autenticado.' }
  if (await readOnlySupport()) return { ok: false, error: SUPPORT_READONLY_MESSAGE }
  if (!/^https:\/\//.test(audioUrl)) return { ok: false, error: 'Áudio inválido.' }
  const creds = await credsFor(instanceName)
  if (!creds) return { ok: false, error: 'WhatsApp não conectado ou instância não disponível.' }
  const db = await createScopedAdmin()
  const to = normPhone(phone)
  const quoted = await quotedFrom(quotedRowId)
  const row = { sent_by: uid, direction: 'enviado', phone: to, message: '[Áudio]', media_url: audioUrl, media_type: 'audio', media_filename: 'audio.webm', instance_name: creds.instanceName, quoted_id: quoted?.id ?? null }
  try {
    const r = await sendEvoVoice({ ...creds, phone: to, audioUrl, quoted })
    const { data } = await db.from('contract_whatsapp_messages').insert({ ...row, status: 'enviado', zapi_message_id: r?.key?.id ?? null }).select(MSG_COLS).single()
    revalidatePath('/whatsapp')
    return { ok: true, message: data ?? undefined }
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Falha ao enviar o áudio.'
    await db.from('contract_whatsapp_messages').insert({ ...row, status: 'falhou', error_message: error })
    return { ok: false, error }
  }
}

// ─── Reação (👍 ❤️ …) numa mensagem; emoji vazio tira ────────────────────────
export async function reactToWhatsAppMessage(rowId: string, emoji: string): Promise<Result<{ reactions?: unknown }>> {
  if (!(await userId())) return { ok: false, error: 'Usuário não autenticado.' }
  if (await readOnlySupport()) return { ok: false, error: SUPPORT_READONLY_MESSAGE }
  const db = await createScopedAdmin()
  const { data: m } = await db.from('contract_whatsapp_messages')
    .select('id, phone, direction, zapi_message_id, instance_name, reactions').eq('id', rowId).maybeSingle()
  if (!m) return { ok: false, error: 'Mensagem não encontrada.' }
  if (!m.zapi_message_id) return { ok: false, error: 'Esta mensagem não tem o código do WhatsApp; não dá para reagir a ela.' }
  const creds = await credsFor(m.instance_name)
  if (!creds) return { ok: false, error: 'WhatsApp não conectado ou instância não disponível.' }
  const clean = String(emoji ?? '').slice(0, 16)
  try {
    await sendEvoReaction({ ...creds, phone: m.phone, messageId: m.zapi_message_id, fromMe: m.direction === 'enviado', emoji: clean })
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Falha ao reagir.' }
  }
  const reactions = applyReaction(m.reactions, 'me', clean)
  await db.from('contract_whatsapp_messages').update({ reactions }).eq('id', m.id)
  return { ok: true, reactions }
}

// ─── Conversa lida: zera as não lidas e manda os tiques azuis ao contato ─────
export async function markWhatsAppConversationRead(phone: string, instanceName?: string | null): Promise<Result> {
  if (!(await userId())) return { ok: false, error: 'Usuário não autenticado.' }
  if (await readOnlySupport()) return { ok: true } // suporte só olha: não marca como lida
  const db = await createScopedAdmin()
  const inst = instanceName ?? ''
  const last8 = String(phone ?? '').replace(/\D/g, '').slice(-8)
  if (last8.length < 8) return { ok: false, error: 'Telefone inválido.' }
  const now = new Date().toISOString()

  const { data: rows } = await db.from('whatsapp_conversation_status')
    .select('phone, last_read_at').ilike('phone', `%${last8}`).eq('instance_name', inst)
  const since = (rows ?? []).map(r => r.last_read_at as string | null).filter(Boolean).sort().pop()
    ?? new Date(Date.now() - 3 * 86_400_000).toISOString()

  if (rows?.length) {
    await db.from('whatsapp_conversation_status').update({ last_read_at: now }).ilike('phone', `%${last8}`).eq('instance_name', inst)
  } else {
    await db.from('whatsapp_conversation_status').insert({ phone: String(phone).replace(/\D/g, ''), instance_name: inst, last_read_at: now })
  }

  // Tiques azuis no celular do contato (melhor esforço; não atrapalha se falhar)
  try {
    let q = db.from('contract_whatsapp_messages').select('zapi_message_id, phone')
      .ilike('phone', `%${last8}`).eq('direction', 'recebido').gt('created_at', since)
      .not('zapi_message_id', 'is', null).order('created_at', { ascending: false }).limit(20)
    if (inst) q = q.eq('instance_name', inst)
    const { data: unread } = await q
    if (unread?.length) {
      const creds = await credsFor(inst || null)
      if (creds) await markEvoRead({ ...creds, phone: unread[0].phone, messageIds: unread.map(u => u.zapi_message_id as string) })
    }
  } catch { /* sem tique azul, segue */ }
  return { ok: true }
}

// ─── Respostas rápidas da empresa ("/atalho") ────────────────────────────────
export type QuickReply = { id: string; shortcut: string; body: string }

export async function listQuickReplies(): Promise<QuickReply[]> {
  if (!(await userId())) return []
  const db = await createScopedAdmin()
  const { data } = await db.from('whatsapp_quick_replies').select('id, shortcut, body').order('shortcut').limit(300)
  return (data ?? []) as QuickReply[]
}

export async function saveQuickReply(input: { id?: string | null; shortcut: string; body: string }): Promise<Result<{ reply?: QuickReply }>> {
  const uid = await userId()
  if (!uid) return { ok: false, error: 'Usuário não autenticado.' }
  if (await readOnlySupport()) return { ok: false, error: SUPPORT_READONLY_MESSAGE }
  const shortcut = normShortcut(input.shortcut)
  const body = String(input.body ?? '').trim().slice(0, 4000)
  if (!shortcut) return { ok: false, error: 'Dê um atalho (letras, números, - ou _), ex.: boasvindas.' }
  if (!body) return { ok: false, error: 'Escreva o texto da resposta.' }
  const db = await createScopedAdmin()
  const q = input.id
    ? db.from('whatsapp_quick_replies').update({ shortcut, body }).eq('id', input.id)
    : db.from('whatsapp_quick_replies').insert({ shortcut, body, created_by: uid })
  const { data, error } = await q.select('id, shortcut, body').single()
  if (error) return { ok: false, error: /duplicate|unique/i.test(error.message) ? `Já existe uma resposta com o atalho /${shortcut}.` : error.message }
  return { ok: true, reply: data as QuickReply }
}

export async function deleteQuickReply(id: string): Promise<Result> {
  if (!(await userId())) return { ok: false, error: 'Usuário não autenticado.' }
  if (await readOnlySupport()) return { ok: false, error: SUPPORT_READONLY_MESSAGE }
  const db = await createScopedAdmin()
  const { error } = await db.from('whatsapp_quick_replies').delete().eq('id', id)
  return error ? { ok: false, error: error.message } : { ok: true }
}
