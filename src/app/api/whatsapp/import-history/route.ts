/* eslint-disable @typescript-eslint/no-explicit-any -- respostas da Evolution têm formato variável */
// ─── Importar histórico de uma conversa da Evolution para a Central ───────────
// O CRM guarda o telefone sem o 55 (ex.: 62996946012); o WhatsApp só conhece com
// o 55 e, em números antigos, às vezes sem o 9º dígito. Por isso procura nas
// variações. A Evolution v2 devolve as mensagens paginadas (messages.records).
// Grava só o que ainda não existe (pelo id da mensagem), com a instância e a
// empresa, ligado ao mesmo lead/oportunidade da conversa.

import { NextResponse } from 'next/server'
import { unwrapMessage } from '@/lib/whatsapp/chat'
import { createClient } from '@/lib/supabase/server'
import { isPrivateInstance, PRIVATE_INSTANCE_ERROR } from '@/lib/whatsapp/private-instances'
import { resolveTenantId } from '@/lib/tenant/context'
import { canTenantUseInstance, getTenantEvoCreds } from '@/lib/whatsapp/tenant-evo'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { jidCandidates } from '@/lib/whatsapp/jid'

export const maxDuration = 60

const MAX_PAGES = 10
const PAGE_SIZE = 100

type EvoMsg = { key?: { id?: string; fromMe?: boolean; remoteJid?: string }; message?: Record<string, any>; messageTimestamp?: number | string; pushName?: string }

// Lista de mensagens em qualquer dos formatos conhecidos da resposta
function readList(d: any): { list: EvoMsg[]; pages: number } {
  if (Array.isArray(d)) return { list: d, pages: 1 }
  const m = d?.messages
  if (Array.isArray(m)) return { list: m, pages: 1 }
  if (m && Array.isArray(m.records)) return { list: m.records, pages: Number(m.pages) || 1 }
  if (Array.isArray(d?.records)) return { list: d.records, pages: Number(d.pages) || 1 }
  return { list: [], pages: 0 }
}

function describe(msg: Record<string, any>): { text: string; mediaType: string | null; filename: string | null } {
  const inner = unwrapMessage(msg) ?? msg
  const doc = inner.documentMessage ?? inner.documentWithCaptionMessage?.message?.documentMessage
  const caption = inner.imageMessage?.caption ?? inner.videoMessage?.caption ?? doc?.caption ?? null
  const text = inner.conversation ?? inner.extendedTextMessage?.text ?? caption ?? null
  let mediaType: string | null = null
  if (inner.imageMessage || inner.stickerMessage) mediaType = 'image'
  else if (inner.audioMessage) mediaType = 'audio'
  else if (inner.videoMessage) mediaType = 'video'
  else if (doc) mediaType = 'document'
  const label: Record<string, string> = { image: '[Imagem]', audio: '[Áudio]', video: '[Vídeo]', document: '[Documento]' }
  return {
    text: text ?? (doc?.fileName ? String(doc.fileName) : null) ?? (mediaType ? label[mediaType] : inner.contactMessage ? '[Contato]' : inner.locationMessage ? '[Localização]' : '[mensagem]'),
    mediaType,
    filename: doc?.fileName ?? null,
  }
}

export async function POST(req: Request) {
  const userClient = await createClient()
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { phone, instanceName } = await req.json().catch(() => ({}))
  if (!phone) return NextResponse.json({ error: 'Telefone obrigatório' }, { status: 400 })

  const tenantId = await resolveTenantId()
  const db = await createScopedAdmin(tenantId)
  const { data: org } = await db.from('organization_settings').select('evo_instance_name').eq('tenant_id', tenantId).maybeSingle()
  const instance = (instanceName as string | undefined) || (org?.evo_instance_name as string | null) || null
  if (!instance) return NextResponse.json({ error: 'Número (instância) da conversa não identificado.' }, { status: 400 })
  if (await isPrivateInstance(instance)) return NextResponse.json({ error: PRIVATE_INSTANCE_ERROR }, { status: 403 })
  if (!(await canTenantUseInstance(tenantId, instance))) return NextResponse.json({ error: 'Este número não é da sua empresa.' }, { status: 403 })

  const creds = await getTenantEvoCreds(tenantId)
  if (!creds) return NextResponse.json({ error: 'Servidor do WhatsApp não configurado.' }, { status: 400 })
  const headers = { apikey: creds.apiKey, 'Content-Type': 'application/json' }

  const candidates = jidCandidates(String(phone))
  const found = new Map<string, EvoMsg>()
  let lastError: string | null = null

  for (const remoteJid of candidates) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      let data: any
      try {
        const r = await fetch(`${creds.serverUrl}/chat/findMessages/${encodeURIComponent(instance)}`, {
          method: 'POST', headers,
          body: JSON.stringify({ where: { key: { remoteJid } }, page, offset: PAGE_SIZE }),
        })
        data = await r.json().catch(() => null)
        if (!r.ok) { lastError = `WhatsApp respondeu ${r.status}`; break }
      } catch (e) {
        lastError = e instanceof Error ? e.message : 'falha de conexão'
        break
      }
      const { list, pages } = readList(data)
      // Só desta conversa (algumas versões ignoram o filtro e devolvem tudo)
      for (const m of list) {
        const jid = m.key?.remoteJid
        if (m.key?.id && (!jid || candidates.includes(jid))) found.set(m.key.id, m)
      }
      if (!list.length || page >= pages) break
    }
  }

  if (!found.size) {
    return NextResponse.json({
      ok: true, found: 0, imported: 0, existing: 0,
      message: lastError ? `Não foi possível ler o histórico (${lastError}).` : 'O WhatsApp não devolveu mensagens desta conversa neste número.',
    })
  }

  // Já existentes (pelo id da mensagem)
  const ids = [...found.keys()]
  const existing = new Set<string>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from('contract_whatsapp_messages').select('zapi_message_id').in('zapi_message_id', ids.slice(i, i + 200))
    for (const r of data ?? []) existing.add(r.zapi_message_id as string)
  }

  // Mesma ligação (lead/oportunidade) que a conversa já tem
  const canonical = String(phone).replace(/\D/g, '')
  const { data: link } = await db.from('contract_whatsapp_messages').select('lead_id, contract_id')
    .eq('phone', canonical).eq('instance_name', instance).or('lead_id.not.is.null,contract_id.not.is.null')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()

  const rows = [...found.values()].filter(m => !existing.has(m.key!.id!)).map(m => {
    const d = describe(m.message ?? {})
    const ts = Number(m.messageTimestamp)
    const id = m.key!.id!
    return {
      tenant_id: tenantId,
      phone: canonical,
      instance_name: instance,
      message: d.text,
      direction: m.key?.fromMe ? 'enviado' : 'recebido',
      status: m.key?.fromMe ? 'enviado' : 'recebido',
      zapi_message_id: id,
      media_type: d.mediaType,
      media_filename: d.filename,
      media_url: d.mediaType ? `/api/whatsapp/media?${new URLSearchParams({ id, instance }).toString()}` : null,
      unlinked_sender_name: m.key?.fromMe ? null : (m.pushName ?? null),
      lead_id: link?.lead_id ?? null,
      contract_id: link?.contract_id ?? null,
      triggered_automatically: false,
      created_at: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : new Date().toISOString(),
    }
  })

  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db.from('contract_whatsapp_messages').insert(rows.slice(i, i + 200))
    if (error) {
      console.error('[import] erro ao gravar:', error.message)
      return NextResponse.json({ error: `Erro ao gravar: ${error.message}` }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true, found: found.size, imported: rows.length, existing: existing.size })
}
