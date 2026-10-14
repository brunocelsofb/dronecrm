import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isPrivateInstance, PRIVATE_INSTANCE_ERROR } from '@/lib/whatsapp/private-instances'
import { resolveTenantId } from '@/lib/tenant/context'
import { withPlatformEvo } from '@/lib/whatsapp/tenant-evo'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

export async function POST(req: Request) {
  const userClient = await createClient()
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { phone, instanceName } = await req.json()
  if (!phone) return NextResponse.json({ error: 'phone obrigatório' }, { status: 400 })

  const admin = (await createScopedAdmin())
  const { data: org__raw } = await admin
    .from('organization_settings')
    .select('evo_server_url, evo_api_key, evo_instance_name')
    .eq('tenant_id', await resolveTenantId())
    .maybeSingle()
  const org = withPlatformEvo(org__raw)

  if (!org?.evo_server_url || !org?.evo_api_key) {
    return NextResponse.json({ error: 'Evolution API não configurada' }, { status: 400 })
  }

  const instance = instanceName ?? org.evo_instance_name
  if (await isPrivateInstance(instance)) return NextResponse.json({ error: PRIVATE_INSTANCE_ERROR }, { status: 403 })
  const cleanPhone = phone.replace(/\D/g, '')
  const remoteJid = `${cleanPhone}@s.whatsapp.net`

  // Evolution v2 — tenta /chat/findMessages
  let evoMessages: any[] = []
  const auth = { 'apikey': org.evo_api_key, 'Content-Type': 'application/json' }

  const attempts = [
    // Formato 1: findMessages com where
    async () => {
      const r = await fetch(`${org.evo_server_url}/chat/findMessages/${instance}`, {
        method: 'POST', headers: auth,
        body: JSON.stringify({ where: { key: { remoteJid } }, limit: 200 }),
      })
      const d = await r.json().catch(() => ({}))
      console.log('[import] findMessages status:', r.status, 'data keys:', Object.keys(d))
      return d?.messages ?? (Array.isArray(d) ? d : [])
    },
    // Formato 2: fetchMessages com remoteJid direto
    async () => {
      const r = await fetch(`${org.evo_server_url}/chat/fetchMessages/${instance}?remoteJid=${remoteJid}&limit=200`, {
        headers: { 'apikey': org.evo_api_key },
      })
      const d = await r.json().catch(() => ({}))
      console.log('[import] fetchMessages status:', r.status)
      return d?.messages ?? (Array.isArray(d) ? d : [])
    },
    // Formato 3: getMessages
    async () => {
      const r = await fetch(`${org.evo_server_url}/chat/getMessages/${instance}`, {
        method: 'POST', headers: auth,
        body: JSON.stringify({ number: cleanPhone, count: 200 }),
      })
      const d = await r.json().catch(() => ({}))
      console.log('[import] getMessages status:', r.status)
      return d?.messages ?? (Array.isArray(d) ? d : [])
    },
  ]

  for (const attempt of attempts) {
    try {
      const msgs = await attempt()
      if (msgs.length > 0) { evoMessages = msgs; break }
    } catch (e) { console.warn('[import] tentativa falhou:', e) }
  }

  console.log('[import] total mensagens encontradas:', evoMessages.length)

  if (!evoMessages.length) {
    return NextResponse.json({ ok: true, imported: 0, message: 'Nenhuma mensagem encontrada. Verifique se o número está correto e a instância conectada.' })
  }

  const rows = evoMessages.map((m: any) => {
    const key = m.key ?? m
    const msg = m.message ?? {}
    const text = msg.conversation ?? msg.extendedTextMessage?.text ?? msg.imageMessage?.caption ?? null

    let mediaType: string | null = null
    let mediaUrl: string | null = null
    let mediaFilename: string | null = null
    if (msg.imageMessage)    { mediaType = 'image';    mediaUrl = msg.imageMessage.url ?? null }
    if (msg.audioMessage)    { mediaType = 'audio';    mediaUrl = msg.audioMessage.url ?? null }
    if (msg.videoMessage)    { mediaType = 'video';    mediaUrl = msg.videoMessage.url ?? null }
    if (msg.documentMessage) { mediaType = 'document'; mediaUrl = msg.documentMessage.url ?? null; mediaFilename = msg.documentMessage.fileName ?? null }

    const ts = m.messageTimestamp ?? m.messageStamp ?? null
    return {
      phone: cleanPhone,
      message: text ?? (mediaType ? `[${mediaType}]` : '[mensagem]'),
      direction: key.fromMe ? 'enviado' : 'recebido',
      status: key.fromMe ? 'enviado' : null,
      zapi_message_id: key.id ?? null,
      media_url: mediaUrl,
      media_type: mediaType,
      media_filename: mediaFilename,
      triggered_automatically: false,
      created_at: ts ? new Date(Number(ts) * 1000).toISOString() : new Date().toISOString(),
    }
  }).filter((r: any) => r.zapi_message_id)

  const { error } = await admin
    .from('contract_whatsapp_messages')
    .upsert(rows, { onConflict: 'zapi_message_id', ignoreDuplicates: true })

  if (error) {
    console.error('[import] erro upsert:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, imported: rows.length })
}
