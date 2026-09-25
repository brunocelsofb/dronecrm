import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isOptOutMessage, recordWhatsAppOptOut } from '@/lib/whatsapp/guardrails'

function toCanonicalPhone(rawPhone: string): string {
  let cleaned = rawPhone.replace(/\D/g, '')
  if (cleaned.startsWith('55') && (cleaned.length === 12 || cleaned.length === 13)) {
    cleaned = cleaned.slice(2)
  }
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
    return NextResponse.json({ ok: false, error: 'invalid json' })
  }

  try {
    const eventRaw = body?.event ?? body?.type ?? ''
    const event = eventRaw.toLowerCase().replace(/[.\-]/g, '_')
    const instanceName = body?.instance ?? body?.instanceName ?? null

    if (!['messages_upsert', 'messages_delete', 'messages.delete'].includes(event)) {
      return NextResponse.json({ ok: true, skipped: `event=${eventRaw}` })
    }

    if (event === 'messages_delete' || event === 'messages.delete') {
      try {
        const admin = createAdminClient()
        let keys: any[] = []
        if (body?.data?.keys) keys = body.data.keys
        else if (body?.keys) keys = body.keys
        else if (body?.data?.messageId) keys = [{ id: body.data.messageId }]
        else if (body?.data?.id) keys = [{ id: body.data.id }]

        for (const k of keys) {
          const msgId = k?.id ?? k?.messageId ?? k?.key?.id
          if (!msgId) continue
          await admin.from('contract_whatsapp_messages').delete().eq('zapi_message_id', msgId)
        }
      } catch (e) {
        console.error('[evo-webhook] erro delete:', e)
      }
      return NextResponse.json({ ok: true })
    }

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
      if (existing) return NextResponse.json({ ok: true, skipped: 'fromMe-duplicate' })
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

    if (msg?.imageMessage) mediaType = 'image'
    if (msg?.audioMessage) mediaType = 'audio'
    if (msg?.videoMessage) mediaType = 'video'
    if (msg?.documentMessage) { mediaType = 'document'; mediaFilename = msg.documentMessage.fileName ?? null }
    if (msg?.stickerMessage) mediaType = 'sticker'

    const dbMediaType = mediaType === 'sticker' ? 'image' : mediaType
    const finalText = text ?? (mediaType ? (FRIENDLY[mediaType] ?? `[${mediaType}]`) : '[Formato não suportado]')

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

    const { data: orgData } = await supabase
      .from('organization_settings')
      .select('tenant_id')
      .eq('id', 'default')
      .maybeSingle()
    const tenantId = orgData?.tenant_id ?? null
    if (!tenantId) return NextResponse.json({ ok: false, error: 'tenant_id missing' })

    const { data: inserted, error: insertError } = await supabase
      .from('contract_whatsapp_messages')
      .insert({
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

    if (insertError) return NextResponse.json({ ok: false, error: insertError.message })

        // ================================================================
    // MÁQUINA DE TRIAGEM — FIX: sem .eq('id'), usa rawPhone completo
    // ================================================================
    if (!isFromMe) {
      try {
        const adminE = createAdminClient()

        const { data: orgSettings } = await adminE
          .from('organization_settings')
          .select('evo_server_url, evo_api_key, evo_instance_name, evo_instance_aliases, triage_menu_options, triage_enabled')
          .eq('id', 'default')
          .maybeSingle()

        if (orgSettings?.triage_enabled !== false) {
          // Chave canônica: rawPhone completo (ex: "5562999884637")
          const phoneKey = rawPhone
          const last8 = phoneKey.slice(-8)

          console.log('[enterprise] phoneKey:', phoneKey, '| last8:', last8, '| instance:', instanceName)

          const { data: statusRows, error: statusErr } = await adminE
            .from('whatsapp_conversation_status')
            .select('phone, instance_name, tenant_id, triage_state, department, protocol_number')
            .ilike('phone', `%${last8}`)

          console.log('[enterprise] statusRows:', JSON.stringify(statusRows), '| err:', statusErr?.message ?? 'none')

          const currentStatus = statusRows?.[0] ?? null
          const state: string = currentStatus?.triage_state ?? 'none'

          console.log('[enterprise] state:', state, '| department:', currentStatus?.department ?? 'none')

          // GUARDRAIL: se já ativo, não faz nada
          if (state === 'active' || currentStatus?.department) {
            console.log('[enterprise] já ativo — skip')
            return NextResponse.json({ ok: true, id: inserted?.id, status: 'already_active' })
          }

          let protocolNumber: string | null = currentStatus?.protocol_number ?? null
          if (!protocolNumber) {
            const { data: protoData } = await adminE.rpc('next_whatsapp_protocol', { p_tenant_id: tenantId })
            protocolNumber = (protoData as string) ?? null
            console.log('[enterprise] novo protocolo:', protocolNumber)
          } else {
            console.log('[enterprise] protocolo reusado:', protocolNumber)
          }

          const menuOptions = (orgSettings?.triage_menu_options ?? []) as Array<{ key: string; label: string; department: string }>

          const upsertPayload = {
            phone: phoneKey,
            instance_name: instanceName ?? '',
            tenant_id: tenantId,
            protocol_number: protocolNumber,
            updated_at: new Date().toISOString(),
          }

          if (state === 'awaiting_selection') {
            const trimmedText = (text ?? '').trim().toLowerCase()
            const chosen = menuOptions.find(opt =>
              trimmedText === opt.key.toLowerCase() ||
              trimmedText === opt.label.toLowerCase() ||
              trimmedText === opt.department.toLowerCase()
            )

            console.log('[enterprise] awaiting_selection | input:', trimmedText, '| chosen:', JSON.stringify(chosen ?? null))

            if (chosen) {
              await adminE.from('whatsapp_conversation_status').upsert(
                { ...upsertPayload, department: chosen.department, triage_state: 'active' },
                { onConflict: 'phone,instance_name,tenant_id' }
              )
              await sendTriageConfirmation(orgSettings, instanceName, rawPhone, chosen.key, chosen.label, protocolNumber)
            } else {
              await sendTriageMenu(orgSettings, instanceName, rawPhone, protocolNumber, menuOptions)
            }
          } else {
            // Estado 'none': upsert ANTES de enviar menu
            await adminE.from('whatsapp_conversation_status').upsert(
              { ...upsertPayload, triage_state: menuOptions.length > 0 ? 'awaiting_selection' : 'active' },
              { onConflict: 'phone,instance_name,tenant_id' }
            )
            console.log('[enterprise] upsert none→awaiting feito')

            if (menuOptions.length > 0) {
              await sendTriageMenu(orgSettings, instanceName, rawPhone, protocolNumber, menuOptions)
            }
          }
        }
      } catch (err) {
        console.error('[enterprise] erro (não fatal):', err)
      }
    }
    return NextResponse.json({ ok: true, id: inserted?.id })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? 'erro' })
  }
}

async function sendTriageMenu(orgSettings: any, instanceName: string | null, phone: string, protocolNumber: string | null, menuOptions: Array<{ key: string; label: string; department: string }>) {
  if (!orgSettings?.evo_server_url || !orgSettings?.evo_api_key) return
  const inst = instanceName ?? orgSettings.evo_instance_name
  if (!inst) return

  const optionsText = menuOptions.map(opt => `${opt.key}. ${opt.label}`).join('\n')
  const protoLine = protocolNumber ? `*Protocolo: ${protocolNumber}*\n\n` : ''

  const menuText = `${protoLine}Olá! Seja bem-vindo(a) à Orbis Engenharia Clínica e Hospitalar! 🚀\n\nEnquanto direciono o seu atendimento, aproveite para conhecer as nossas soluções:\n🌐 Site: https://orbisengenhariaclinica.com.br/\n📸 Instagram: https://instagram.com/orbisengenhariaclinica\n💼 LinkedIn: https://www.linkedin.com/company/orbis-engenharia-cl-nica/\n\nPara agilizar, digite a opção desejada:\n${optionsText}`

  try {
    await fetch(`${orgSettings.evo_server_url}/message/sendText/${inst}`, {
      method: 'POST',
      headers: { 'apikey': orgSettings.evo_api_key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: phone, text: menuText }),
    })
  } catch (e) {
    console.error('[evo-webhook] erro envio menu:', e)
  }
}

async function sendTriageConfirmation(orgSettings: any, instanceName: string | null, phone: string, optionKey: string, optionLabel: string, protocolNumber: string | null) {
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
    console.error('[evo-webhook] erro envio confirmacao:', e)
  }
}
