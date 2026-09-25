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
    // MÁQUINA DE TRIAGEM + PROCESSAMENTO DE NPS + CRIAÇÃO DE HISTÓRICO
    // ================================================================
    if (!isFromMe) {
      try {
        const last8 = phone.length >= 8 ? phone.slice(-8) : phone

        const { data: statusRows } = await supabase
          .from('whatsapp_conversation_status')
          .select('*')
          .ilike('phone', `%${last8}%`)
          .order('created_at', { ascending: false })

        const currentStatus = statusRows && statusRows.length > 0 ? statusRows[0] : null

        // --- TRATAMENTO DE NPS PENDENTE ---
        if (currentStatus?.nps_pending) {
          const scoreNum = parseInt((text ?? '').trim(), 10)
          if (!isNaN(scoreNum) && scoreNum >= 1 && scoreNum <= 5) {
            await supabase
              .from('whatsapp_conversation_status')
              .update({
                nps_score: scoreNum,
                nps_pending: false,
                is_archived: true,
                archived_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })
              .eq('id', currentStatus.id)

            const npsAgradecimento = `Obrigado pela sua avaliação! Sua nota ${scoreNum} foi registrada com sucesso. Tenha um ótimo dia!`
            await sendAndRecordBotMessage(supabase, tenantId, orgSettingsForSend(body), instanceName, rawPhone, phone, npsAgradecimento)
            return NextResponse.json({ ok: true, status: 'nps_recorded' })
          }
        }

        const { data: orgSettings } = await supabase
          .from('organization_settings')
          .select('evo_server_url, evo_api_key, evo_instance_name, evo_instance_aliases, triage_menu_options, triage_enabled')
          .eq('id', 'default')
          .maybeSingle()

        if (orgSettings?.triage_enabled !== false) {
          let protocolNumber = currentStatus?.protocol_number ?? null

          if (!protocolNumber) {
            const { data: protoData } = await supabase.rpc('next_whatsapp_protocol', { p_tenant_id: tenantId })
            protocolNumber = (protoData as string) ?? null
          }

          const state = currentStatus?.triage_state ?? 'none'
          const menuOptions = (orgSettings?.triage_menu_options ?? []) as Array<{ key: string; label: string; department: string }>

          if (state === 'active') {
            return NextResponse.json({ ok: true, status: 'already_active' })
          }

          if (state === 'awaiting_selection') {
            const trimmedText = (text ?? '').trim().toLowerCase()
            const chosen = menuOptions.find(opt =>
              trimmedText === opt.key.toLowerCase() ||
              trimmedText === opt.label.toLowerCase() ||
              trimmedText === opt.department.toLowerCase()
            )

            if (chosen) {
              await supabase
                .from('whatsapp_conversation_status')
                .update({
                  department: chosen.department,
                  triage_state: 'active',
                  updated_at: new Date().toISOString()
                })
                .eq('id', currentStatus.id)

              const confirmMsg = `Opção ${chosen.key} selecionada. Seu atendimento foi direcionado para o setor *${chosen.label}*. Um atendente responderá em breve!${protocolNumber ? ` (Protocolo: ${protocolNumber})` : ''}`
              await sendAndRecordBotMessage(supabase, tenantId, orgSettings, instanceName, rawPhone, phone, confirmMsg)
            } else {
              await sendAndRecordTriageMenu(supabase, tenantId, orgSettings, instanceName, rawPhone, phone, protocolNumber, menuOptions)
            }
          } else {
            // Estado 'none'
            if (!currentStatus) {
              await supabase
                .from('whatsapp_conversation_status')
                .insert({
                  phone,
                  instance_name: instanceName ?? '',
                  tenant_id: tenantId,
                  protocol_number: protocolNumber,
                  triage_state: menuOptions.length > 0 ? 'awaiting_selection' : 'active',
                  updated_at: new Date().toISOString()
                })
            } else {
              await supabase
                .from('whatsapp_conversation_status')
                .update({
                  triage_state: menuOptions.length > 0 ? 'awaiting_selection' : 'active',
                  protocol_number: protocolNumber,
                  updated_at: new Date().toISOString()
                })
                .eq('id', currentStatus.id)
            }

            if (menuOptions.length > 0) {
              await sendAndRecordTriageMenu(supabase, tenantId, orgSettings, instanceName, rawPhone, phone, protocolNumber, menuOptions)
            }
          }
        }
      } catch (err) {
        console.error('[evo-webhook] erro enterprise:', err)
      }
    }

    return NextResponse.json({ ok: true, id: inserted?.id })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? 'erro' })
  }
}

function orgSettingsForSend(body: any) {
  return null // Helper para fallbacks se necessário
}

async function sendAndRecordBotMessage(
  supabase: any,
  tenantId: string,
  orgSettings: any,
  instanceName: string | null,
  rawPhone: string,
  phone: string,
  text: string
) {
  if (!orgSettings?.evo_server_url || !orgSettings?.evo_api_key) return
  const inst = instanceName ?? orgSettings.evo_instance_name
  if (!inst) return

  try {
    const res = await fetch(`${orgSettings.evo_server_url}/message/sendText/${inst}`, {
      method: 'POST',
      headers: { 'apikey': orgSettings.evo_api_key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: rawPhone, text }),
    })

    if (res.ok) {
      await supabase.from('contract_whatsapp_messages').insert({
        phone,
        message: text,
        direction: 'enviado',
        status: 'enviado',
        triggered_automatically: true,
        instance_name: instanceName,
        tenant_id: tenantId,
        created_at: new Date().toISOString(),
      })
    }
  } catch (e) {
    console.error('[evo-webhook] erro sendAndRecordBotMessage:', e)
  }
}

async function sendAndRecordTriageMenu(
  supabase: any,
  tenantId: string,
  orgSettings: any,
  instanceName: string | null,
  rawPhone: string,
  phone: string,
  protocolNumber: string | null,
  menuOptions: Array<{ key: string; label: string; department: string }>
) {
  const optionsText = menuOptions.map(opt => `${opt.key}. ${opt.label}`).join('\n')
  const protoLine = protocolNumber ? `*Protocolo: ${protocolNumber}*\n\n` : ''
  const menuText = `${protoLine}Olá! Seja bem-vindo(a) à Orbis Engenharia Clínica e Hospitalar! 🚀\n\nEnquanto direciono o seu atendimento, aproveite para conhecer as nossas soluções:\n🌐 Site: https://orbisengenhariaclinica.com.br/\n📸 Instagram: https://instagram.com/orbisengenhariaclinica\n💼 LinkedIn: https://www.linkedin.com/company/orbis-engenharia-cl-nica/\n\nPara agilizar, digite a opção desejada:\n${optionsText}`

  await sendAndRecordBotMessage(supabase, tenantId, orgSettings, instanceName, rawPhone, phone, menuText)
}
