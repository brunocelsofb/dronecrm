import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isOptOutMessage, recordWhatsAppOptOut } from '@/lib/whatsapp/guardrails'

// Normalização canônica para telefones do Brasil (trata DDI 55 e 9º dígito)
function toCanonicalPhone(rawPhone: string): string {
  let cleaned = rawPhone.replace(/\D/g, '')
  if (cleaned.startsWith('55') && (cleaned.length === 12 || cleaned.length === 13)) {
    cleaned = cleaned.slice(2)
  }
  // Se for celular (DDD + 8 dígitos iniciando entre 6 e 9), insere o 9º dígito
  if (cleaned.length === 10) {
    const ddd = cleaned.slice(0, 2)
    const number = cleaned.slice(2)
    if (/^[6-9]/.test(number)) {
      cleaned = `${ddd}9${number}`
    }
  }
  return cleaned
}

export async function POST(request: Request) {
  const supabase = createAdminClient()

  let body: any
  try {
    body = await request.json()
  } catch (e) {
    console.error('[evo-webhook] JSON parse error:', e)
    return NextResponse.json({ ok: false, error: 'invalid json' })
  }

  console.log('[evo-webhook] WEBHOOK RECEBIDO | event:', body?.event ?? body?.type, '| instance:', body?.instance ?? body?.instanceName)

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

    const rawPhone = key.remoteJid.replace(/@.*/, '').replace(/\D/g, '')
    if (!rawPhone) return NextResponse.json({ ok: true, skipped: 'no phone' })

    const phone = toCanonicalPhone(rawPhone)
    const isFromMe = key.fromMe === true
    const messageId = key.id

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
          } else if (messageId) {
            const instParam = instanceName ? `&instance=${encodeURIComponent(instanceName)}` : ''
            mediaUrl = `/api/whatsapp/media?id=${encodeURIComponent(messageId)}${instParam}`
          }
        } else if (messageId) {
          const instParam = instanceName ? `&instance=${encodeURIComponent(instanceName)}` : ''
          mediaUrl = `/api/whatsapp/media?id=${encodeURIComponent(messageId)}${instParam}`
        }
      } catch (e) {
        console.error('[evo-webhook] erro no bloco de mídia:', e)
        if (messageId) {
          const instParam = instanceName ? `&instance=${encodeURIComponent(instanceName)}` : ''
          mediaUrl = `/api/whatsapp/media?id=${encodeURIComponent(messageId)}${instParam}`
        }
      }
    }

    const dbMediaType = mediaType === 'sticker' ? 'image' : mediaType
    let fallbackText = '[Formato não suportado]'
    if (msg && typeof msg === 'object') {
      const keys = Object.keys(msg as object).filter(k => k !== 'messageContextInfo')
      if (keys.length > 0) fallbackText = `[Formato: ${keys[0]}]`
    } else if (msgData?.messageStubType) {
      fallbackText = `[Sistema: ${msgData.messageStubType}]`
    }
    if ((msg as any)?.secretEncryptedMessage) fallbackText = '[Status / Mensagem Protegida]'
    const finalText = text ?? (mediaType ? (FRIENDLY[mediaType] ?? `[${mediaType}]`) : fallbackText)

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

    let contractId: string | null = null
    let leadId: string | null = null
    const last8 = phone.length >= 8 ? phone.slice(-8) : phone

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
    }

    if (!contractId && !leadId) {
      const { data: contact } = await supabase
        .from('contacts')
        .select('id, contract_contacts(contract_id)')
        .ilike('phone', `%${last8}%`)
        .limit(1)
        .maybeSingle()

      if (contact?.contract_contacts?.length) {
        contractId = (contact.contract_contacts[0] as any)?.contract_id ?? null
      }
    }

    const { data: orgData } = await supabase
      .from('organization_settings')
      .select('tenant_id')
      .eq('id', 'default')
      .maybeSingle()
    const tenantId = orgData?.tenant_id ?? null
    if (!tenantId) {
      return NextResponse.json({ ok: false, error: 'tenant_id missing' })
    }

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
        tenant_id: tenantId,
        media_url: mediaUrl,
        media_type: dbMediaType,
        media_filename: mediaFilename,
        created_at: messageTimestamp ? new Date(Number(messageTimestamp) * 1000).toISOString() : new Date().toISOString(),
      })
      .select('id')
      .single()

    if (insertError) {
      return NextResponse.json({ ok: false, error: insertError.message })
    }

    // Reabertura de conversa arquivada
    if (!isFromMe) {
      try {
        await supabase
          .from('whatsapp_conversation_status')
          .update({ is_archived: false, archived_at: null, updated_at: new Date().toISOString(), tenant_id: tenantId })
          .ilike('phone', `%${last8}`)
          .eq('is_archived', true)
      } catch (e) {
        console.warn('[evo-webhook] erro ao desarquivar:', e)
      }
    }

    // ================================================================
    // BLOCO ENTERPRISE — TRIAGEM E PROTOCOLO COM NORMALIZAÇÃO CANÔNICA
    // ================================================================
    if (!isFromMe) {
      try {
        const { data: orgSettings } = await supabase
          .from('organization_settings')
          .select('evo_server_url, evo_api_key, evo_instance_name, evo_instance_aliases, triage_menu_options, triage_enabled, tenant_id')
          .eq('id', 'default')
          .maybeSingle()

        if (orgSettings?.triage_enabled === false) {
          console.log('[evo-webhook] triage_enabled=false → automação ignorada')
        } else {
          const instKey = instanceName ?? ''
          const instanceAliases = (orgSettings?.evo_instance_aliases ?? {}) as Record<string, { label?: string; department?: string }>
          const instanceDept: string | null = instanceName ? (instanceAliases[instanceName]?.department ?? null) : null

          // Busca usando o número canônico normalizado
          const { data: existingStatusRows } = await supabase
            .from('whatsapp_conversation_status')
            .select('phone, instance_name, protocol_number, triage_state, department')
            .ilike('phone', `%${last8}`)

          const existingStatus = (existingStatusRows ?? []).find(r => {
            const ri = r.instance_name ?? ''
            return ri === instKey || (!ri && !instKey)
          })

          let protocolNumber: string | null = existingStatus?.protocol_number ?? null

          if (!protocolNumber) {
            const { data: protoData } = await supabase.rpc('next_whatsapp_protocol', { p_tenant_id: tenantId })
            if (protoData) protocolNumber = protoData as string
          }

          const currentTriageState: string = existingStatus?.triage_state ?? 'none'
          const currentDept: string | null = existingStatus?.department ?? null
          const menuOptions = (orgSettings?.triage_menu_options ?? []) as Array<{
            key: string; label: string; department: string
          }>

          const upsertPayload = {
            phone, // grava a chave canônica normalizada
            instance_name: instKey,
            tenant_id: tenantId,
            protocol_number: protocolNumber,
            updated_at: new Date().toISOString(),
          }

          if (instanceDept) {
            await supabase.from('whatsapp_conversation_status').upsert({
              ...upsertPayload,
              department: instanceDept,
              triage_state: 'active',
            }, { onConflict: 'phone,instance_name,tenant_id' })

          } else if (currentTriageState === 'active' || currentDept) {
            // Conversa já triada e ativa — Garante persistência sem reenviar o menu
            if (protocolNumber && !existingStatus?.protocol_number) {
              await supabase.from('whatsapp_conversation_status').upsert(upsertPayload, { onConflict: 'phone,instance_name,tenant_id' })
            }

          } else if (currentTriageState === 'awaiting_selection') {
            const trimmedText = (text ?? '').trim().toLowerCase()
            const chosen = menuOptions.find(opt =>
              trimmedText === opt.key.toLowerCase() ||
              trimmedText === opt.label.toLowerCase() ||
              trimmedText === opt.department.toLowerCase()
            )

            if (chosen) {
              await supabase.from('whatsapp_conversation_status').upsert({
                ...upsertPayload,
                department: chosen.department,
                triage_state: 'active',
              }, { onConflict: 'phone,instance_name,tenant_id' })

              await sendTriageConfirmation(orgSettings, instanceName, rawPhone, chosen.key, chosen.label, protocolNumber)
            } else {
              await sendTriageMenu(orgSettings, instanceName, rawPhone, protocolNumber, menuOptions)
            }

          } else {
            // Primeira mensagem: define o estado como aguardando seleção e envia o menu
            await supabase.from('whatsapp_conversation_status').upsert({
              ...upsertPayload,
              triage_state: menuOptions.length > 0 ? 'awaiting_selection' : 'active',
            }, { onConflict: 'phone,instance_name,tenant_id' })

            if (menuOptions.length > 0) {
              await sendTriageMenu(orgSettings, instanceName, rawPhone, protocolNumber, menuOptions)
            }
          }
        }
      } catch (err) {
        console.error('[evo-webhook] erro no bloco enterprise:', err)
      }
    }

    return NextResponse.json({ ok: true, id: inserted?.id })

  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? 'erro desconhecido' })
  }
}

async function sendTriageMenu(
  orgSettings: any,
  instanceName: string | null,
  phone: string,
  protocolNumber: string | null,
  menuOptions: Array<{ key: string; label: string; department: string }>
) {
  if (!orgSettings?.evo_server_url || !orgSettings?.evo_api_key) return
  const inst = instanceName ?? orgSettings.evo_instance_name
  if (!inst) return

  const optionsText = menuOptions.map(opt => `${opt.key}. ${opt.label}`).join('\n')
  const protoLine = protocolNumber ? `*Protocolo: ${protocolNumber}*\n\n` : ''

  const menuText = `${protoLine}Olá! Seja bem-vindo(a) à Orbis Engenharia Clínica e Hospitalar! 🚀

Enquanto direciono o seu atendimento, aproveite para conhecer as nossas soluções:
🌐 Site: https://orbisengenhariaclinica.com.br/
📸 Instagram: https://instagram.com/orbisengenhariaclinica
💼 LinkedIn: https://www.linkedin.com/company/orbis-engenharia-cl-nica/

Para agilizar, digite a opção desejada:
${optionsText}`

  try {
    await fetch(`${orgSettings.evo_server_url}/message/sendText/${inst}`, {
      method: 'POST',
      headers: { 'apikey': orgSettings.evo_api_key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: phone, text: menuText }),
    })
  } catch (e) {
    console.error('[evo-webhook] erro ao enviar menu:', e)
  }
}

async function sendTriageConfirmation(
  orgSettings: any,
  instanceName: string | null,
  phone: string,
  optionKey: string,
  optionLabel: string,
  protocolNumber: string | null
) {
  if (!orgSettings?.evo_server_url || !orgSettings?.evo_api_key) return
  const inst = instanceName ?? orgSettings.evo_instance_name
  if (!inst) return

  const protoLine = protocolNumber ? ` (Protocolo: ${protocolNumber})` : ''
  const confirmationText = `Opção ${optionKey} selecionada. Seu atendimento foi direcionado para o setor *${optionLabel}*. Um atendente responderá em breve!${protoLine}`

  try {
    await fetch(`${orgSettings.evo_server_url}/message/sendText/${inst}`, {
      method: 'POST',
      headers: { 'apikey': orgSettings.evo_api_key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: phone, text: confirmationText }),
    })
  } catch (e) {
    console.error('[evo-webhook] erro ao enviar confirmação:', e)
  }
}
