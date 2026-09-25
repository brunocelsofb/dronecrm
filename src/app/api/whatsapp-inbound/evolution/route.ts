import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isOptOutMessage, recordWhatsAppOptOut } from '@/lib/whatsapp/guardrails'

export async function POST(request: Request) {
  const supabase = createAdminClient()

  let body: any
  try {
    body = await request.json()
  } catch (e) {
    console.error('[evo-webhook] JSON parse error:', e)
    return NextResponse.json({ ok: false, error: 'invalid json' })
  }

  console.log('[evo-webhook] WEBHOOK RECEBIDO | event:', body?.event ?? body?.type, '| instance:', body?.instance ?? body?.instanceName, '| keys:', JSON.stringify(Object.keys(body ?? {})))

  try {
    const eventRaw = body?.event ?? body?.type ?? ''
    const event = eventRaw.toLowerCase().replace(/[.\-]/g, '_')
    const instanceName = body?.instance ?? body?.instanceName ?? null

    if (!['messages_upsert', 'messages_delete', 'messages.delete'].includes(event)) {
      return NextResponse.json({ ok: true, skipped: `event=${eventRaw}` })
    }

    // 1. Trata evento de exclusão no aparelho
    if (event === 'messages_delete' || event === 'messages.delete') {
      try {
        const admin = createAdminClient()
        let keys: any[] = []

        if (body?.data?.keys) {
          keys = body.data.keys
        } else if (body?.keys) {
          keys = body.keys
        } else if (body?.data?.messageId) {
          keys = [{ id: body.data.messageId }]
        } else if (body?.data?.id) {
          keys = [{ id: body.data.id }]
        }

        const singleId = body?.data?.message?.key?.id
        if (singleId && keys.length === 0) {
          keys = [{ id: singleId }]
        }

        for (const k of keys) {
          const msgId = k?.id ?? k?.messageId ?? k?.key?.id
          if (!msgId) continue
          await admin.from('contract_whatsapp_messages')
            .delete()
            .eq('zapi_message_id', msgId)
        }
      } catch (e) {
        console.error('[evo-webhook] erro ao processar delete:', e)
      }
      return NextResponse.json({ ok: true })
    }

    // 2. Trata envio/recebimento de mensagem
    const msgData = Array.isArray(body?.data) ? body.data[0] : (body?.data ?? body)
    const key = msgData?.key ?? msgData?.message?.key
    const msg = msgData?.message ?? msgData?.data?.message ?? null
    const pushName = msgData?.contactName ?? msgData?.pushName ?? msgData?.contact?.name ?? null
    const messageTimestamp = msgData?.messageTimestamp ?? msgData?.data?.messageTimestamp ?? null

    if (!key?.remoteJid || key.remoteJid.endsWith('@g.us')) {
      return NextResponse.json({ ok: true, skipped: 'group or no remoteJid' })
    }

    const phone = key.remoteJid.replace(/@.*/, '').replace(/\D/g, '')
    if (!phone) return NextResponse.json({ ok: true, skipped: 'no phone' })

    const isFromMe = key.fromMe === true
    const messageId = key.id

    // Ignora eco do CRM (mensagens enviadas pela própria action)
    if (isFromMe && messageId) {
      const { data: existing } = await supabase
        .from('contract_whatsapp_messages')
        .select('id')
        .eq('zapi_message_id', messageId)
        .maybeSingle()
      if (existing) {
        return NextResponse.json({ ok: true, skipped: 'fromMe-duplicate' })
      }
    }

    // Extração de conteúdo
    const text =
      msg?.conversation ??
      msg?.extendedTextMessage?.text ??
      msg?.imageMessage?.caption ??
      msg?.videoMessage?.caption ??
      msg?.documentMessage?.caption ??
      msg?.documentWithCaptionMessage?.message?.documentMessage?.caption ??
      msgData?.body ?? msgData?.text ?? msgData?.content ?? null

    let mediaUrl: string | null = null
    let mediaType: string | null = null
    let mediaFilename: string | null = null

    const FRIENDLY: Record<string, string> = {
      image: '[Imagem]', audio: '[Áudio]', video: '[Vídeo]',
      document: '[Documento]', sticker: '[Figurinha]', contact: '[Contato]',
      location: '[Localização]', poll: '[Enquete]', protocol: '[Ação do Sistema]',
      system: '[Aviso do Sistema]',
    }

    if (msg?.imageMessage)    { mediaType = 'image' }
    if (msg?.audioMessage)    { mediaType = 'audio' }
    if (msg?.videoMessage)    { mediaType = 'video' }
    if (msg?.documentMessage) { mediaType = 'document'; mediaFilename = msg.documentMessage.fileName ?? null }
    if (msg?.stickerMessage)  { mediaType = 'sticker' }
    if (msg?.contactMessage || msg?.contactsArrayMessage) { mediaType = 'contact' }
    if (msg?.locationMessage || msg?.liveLocationMessage) { mediaType = 'location' }
    if (msg?.pollCreationMessage || msg?.pollUpdateMessage) { mediaType = 'poll' }
    if (msg?.protocolMessage) { mediaType = 'protocol' }
    if (msgData?.messageStubType) { mediaType = 'system' }

    const rawUrl = msg?.imageMessage?.url ?? msg?.audioMessage?.url ?? msg?.videoMessage?.url ?? msg?.documentMessage?.url ?? msg?.stickerMessage?.url ?? null
    const rawBase64 = msg?.imageMessage?.base64 ?? msg?.audioMessage?.base64 ?? msg?.videoMessage?.base64 ?? msg?.documentMessage?.base64 ?? msg?.stickerMessage?.base64 ?? null

    if (mediaType && (rawBase64 || (rawUrl && messageId))) {
      try {
        const admin = createAdminClient()
        let b64: string | null = rawBase64 ?? null
        let mimeType = mediaType === 'image' ? 'image/jpeg' : mediaType === 'sticker' ? 'image/webp' : mediaType === 'audio' ? 'audio/mp4' : mediaType === 'video' ? 'video/mp4' : 'application/octet-stream'
        const ext = mediaType === 'image' ? 'jpg' : mediaType === 'sticker' ? 'webp' : mediaType === 'audio' ? 'mp4' : mediaType === 'video' ? 'mp4' : 'bin'

        const msgMime = msg?.imageMessage?.mimetype ?? msg?.stickerMessage?.mimetype ?? msg?.audioMessage?.mimetype ?? msg?.videoMessage?.mimetype ?? msg?.documentMessage?.mimetype
        if (msgMime && mediaType !== 'audio') mimeType = msgMime

        if (!b64 && rawUrl && messageId) {
          const { data: orgSettings } = await admin
            .from('organization_settings')
            .select('evo_server_url, evo_api_key, evo_instance_name')
            .eq('id', 'default').maybeSingle()

          const instForDl = instanceName ?? orgSettings?.evo_instance_name
          if (orgSettings?.evo_server_url && instForDl) {
            try {
              const dlRes = await fetch(
                `${orgSettings.evo_server_url}/chat/getBase64FromMediaMessage/${instForDl}`,
                {
                  method: 'POST',
                  headers: { 'apikey': orgSettings.evo_api_key, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ message: msgData.message ?? msg, convertToMp4: mediaType === 'audio' }),
                }
              )
              if (dlRes.ok) {
                const dlData = await dlRes.json().catch(() => ({}))
                b64 = dlData?.base64 ?? dlData?.data ?? null
                console.log('[evo-webhook] getBase64 status:', dlRes.status, '| b64 presente:', !!b64)
              } else {
                console.warn('[evo-webhook] getBase64 falhou:', dlRes.status)
              }
            } catch (dlErr) {
