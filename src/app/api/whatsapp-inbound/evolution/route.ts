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

    // 1. Trata evento de exclusÃ£o no aparelho
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

    // Ignora eco do CRM (mensagens enviadas pela prÃ³pria action)
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

    // ExtraÃ§Ã£o de conteÃºdo
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
      image: '[Imagem]', audio: '[Ãudio]', video: '[VÃ­deo]',
      document: '[Documento]', sticker: '[Figurinha]', contact: '[Contato]',
      location: '[LocalizaÃ§Ã£o]', poll: '[Enquete]', protocol: '[AÃ§Ã£o do Sistema]',
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

        // Repassa o mimetype real do payload se disponÃ­vel
        const msgMime = msg?.imageMessage?.mimetype ?? msg?.stickerMessage?.mimetype ?? msg?.audioMessage?.mimetype ?? msg?.videoMessage?.mimetype ?? msg?.documentMessage?.mimetype
        if (msgMime && mediaType !== 'audio') mimeType = msgMime

        // Se nÃ£o veio base64 no payload, baixa da Evolution com o msgData completo
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
                  // Envia o msgData completo â formato exigido pela Evolution v1/v2
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
              console.warn('[evo-webhook] erro ao chamar getBase64:', dlErr)
            }
          }
        }

        if (b64) {
          const path = `${instanceName ?? 'default'}/${messageId ?? Date.now()}.${ext}`
          const buffer = Buffer.from(b64, 'base64')
          const { error: upErr } = await admin.storage
            .from('whatsapp-media')
            .upload(path, buffer, { contentType: mimeType, upsert: true })

          if (!upErr) {
            const { data: pub } = admin.storage.from('whatsapp-media').getPublicUrl(path)
            mediaUrl = pub.publicUrl
            console.log('[evo-webhook] mÃ­dia salva:', path)
          } else {
            console.warn('[evo-webhook] upload Storage falhou:', upErr.message)
            // Fallback para proxy
            if (messageId) {
              const instParam = instanceName ? `&instance=${encodeURIComponent(instanceName)}` : ''
              mediaUrl = `/api/whatsapp/media?id=${encodeURIComponent(messageId)}${instParam}`
            }
          }
        } else if (messageId) {
          // Nem base64 nem download funcionou â usa proxy como Ãºltimo recurso
          const instParam = instanceName ? `&instance=${encodeURIComponent(instanceName)}` : ''
          mediaUrl = `/api/whatsapp/media?id=${encodeURIComponent(messageId)}${instParam}`
          console.warn('[evo-webhook] sem b64, usando proxy:', mediaUrl)
        }
      } catch (e) {
        console.error('[evo-webhook] erro no bloco de mÃ­dia (nÃ£o fatal):', e)
        if (messageId) {
          const instParam = instanceName ? `&instance=${encodeURIComponent(instanceName)}` : ''
          mediaUrl = `/api/whatsapp/media?id=${encodeURIComponent(messageId)}${instParam}`
        }
      }
    }

    const dbMediaType = mediaType === 'sticker' ? 'image' : mediaType
    let fallbackText = '[Formato nÃ£o suportado]'
    if (msg && typeof msg === 'object') {
      const keys = Object.keys(msg as object).filter(k => k !== 'messageContextInfo')
      if (keys.length > 0) fallbackText = `[Formato: ${keys[0]}]`
    } else if (msgData?.messageStubType) {
      fallbackText = `[Sistema: ${msgData.messageStubType}]`
    }
    if ((msg as any)?.secretEncryptedMessage) fallbackText = '[Status / Mensagem Protegida]'
    const finalText = text ?? (mediaType ? (FRIENDLY[mediaType] ?? `[${mediaType}]`) : fallbackText)

    // DeduplicaÃ§Ã£o genÃ©rica
    if (messageId) {
      const { data: dup } = await supabase
        .from('contract_whatsapp_messages')
        .select('id')
        .eq('zapi_message_id', messageId)
        .maybeSingle()
      if (dup) return NextResponse.json({ ok: true, skipped: 'duplicata' })
    }

    if (!isFromMe && text && isOptOutMessage(text)) {
      await recordWhatsAppOptOut(phone)
      return NextResponse.json({ ok: true, recorded: 'opt-out' })
    }

    // Busca de vÃ­nculo infalÃ­vel â Ãºltimos 8 dÃ­gitos ignoram DDI, DDD e 9Âº dÃ­gito
    let contractId: string | null = null
    let leadId: string | null = null
    const cleanPhone = phone.replace(/\D/g, '')
    const last8 = cleanPhone.length >= 8 ? cleanPhone.slice(-8) : cleanPhone

    // 1. Busca em mensagens anteriores com vÃ­nculo jÃ¡ estabelecido
    const { data: linkData } = await supabase
      .from('contract_whatsapp_messages')
      .select('contract_id, lead_id')
      .ilike('phone', `%${last8}`)
      .or('contract_id.not.is.null,lead_id.not.is.null')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (linkData?.contract_id || linkData?.lead_id) {
      contractId = linkData.contract_id ?? null
      leadId = linkData.lead_id ?? null
      console.log('[evo-webhook] vÃ­nculo via histÃ³rico:', contractId ?? leadId)
    }

    // 2. Fallback: busca na tabela de contatos por phone
    if (!contractId && !leadId) {
      const { data: contact } = await supabase
        .from('contacts')
        .select('id, contract_contacts(contract_id)')
        .ilike('phone', `%${last8}%`)
        .limit(1)
        .maybeSingle()

      if (contact?.contract_contacts?.length) {
        contractId = (contact.contract_contacts[0] as any)?.contract_id ?? null
        console.log('[evo-webhook] vÃ­nculo via contacts:', contractId)
      }
    }

    // InserÃ§Ã£o da mensagem
    const { data: inserted, error: insertError } = await supabase
      .from('contract_whatsapp_messages')
      .insert({
        contract_id: contractId,
        lead_id: leadId,
        phone,
        message: finalText,
        direction: isFromMe ? 'enviado' : 'recebido',
        status: isFromMe ? 'enviado' : 'recebido',
        triggered_automatically: false,
        zapi_message_id: messageId ?? null,
        unlinked_sender_name: isFromMe ? null : pushName,
        instance_name: instanceName,
        media_url: mediaUrl,
        media_type: dbMediaType,
        media_filename: mediaFilename,
        created_at: messageTimestamp ? new Date(Number(messageTimestamp) * 1000).toISOString() : new Date().toISOString(),
      })
      .select('id')
      .single()

    if (insertError) return NextResponse.json({ ok: false, error: insertError.message })

    return NextResponse.json({ ok: true, id: inserted?.id })

  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? 'erro desconhecido' })
  }
}
