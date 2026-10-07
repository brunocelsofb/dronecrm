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

// ── Constrói a URL proxy interna para o browser buscar a mídia ────────────────
function buildMediaProxyUrl(messageId: string, instanceName: string | null): string {
  const params = new URLSearchParams({ id: messageId })
  if (instanceName) params.set('instance', instanceName)
  return `/api/whatsapp/media?${params.toString()}`
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

    if (!['messages_upsert', 'messages_delete', 'messages.delete', 'call'].includes(event)) {
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

    // ── Evento de chamada (voz/vídeo perdida) ────────────────────────────────
    // Pode chegar com event='call' ou event='messages_upsert' + messageStubType=40/75
    // Tratamos aqui, antes de qualquer extracção de msg/key, pois o payload é diferente.
    if (event === 'call') {
      const callData = Array.isArray(body?.data) ? body.data[0] : (body?.data ?? body)
      const isVideoCall = callData?.isVideo === true || callData?.video === true
      const callText = isVideoCall ? '📹 Chamada de Vídeo Perdida' : '📞 Chamada de Voz Perdida'
      const rawCallPhone = (callData?.from ?? callData?.caller ?? '')
        .replace(/@.*/, '').replace(/\D/g, '')
      const callPhone = rawCallPhone ? toCanonicalPhone(rawCallPhone) : null

      if (callPhone) {
        const { data: callOrgData } = await supabase
          .from('organization_settings')
          .select('tenant_id')
          .eq('id', 'default')
          .maybeSingle()
        const callTenantId = callOrgData?.tenant_id ?? null
        if (callTenantId) {
          await supabase
            .schema('contract_crm')
            .from('contract_whatsapp_messages')
            .insert({
              phone: callPhone,
              message: callText,
              direction: 'recebido',
              media_type: 'call',
              triggered_automatically: false,
              instance_name: instanceName,
              tenant_id: callTenantId,
              created_at: new Date().toISOString(),
            })
        }
      }
      return NextResponse.json({ ok: true, type: 'call-missed' })
    }
    // ─────────────────────────────────────────────────────────────────────────

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

    // Deduplicação prévia de fromMe movida para dentro do bloco isFromMe abaixo
    // (foi necessário para garantir que o schema está correcto e para poder
    //  persistir mensagens onde messageId é null — envios via CRM/web)

    // ── Extracção de texto (todos os formatos conhecidos da Evolution/Baileys) ──

    // Eventos de sistema a ignorar silenciosamente (não geram registo no chat)
    const isReaction   = !!(msg?.reactionMessage)
    const isPollUpdate = !!(msg?.pollUpdateMessage)
    if (isReaction || isPollUpdate) {
      return NextResponse.json({ ok: true, skipped: 'reaction-or-poll-update' })
    }

    // ── Chamadas perdidas via messageStubType (messages_upsert) ──────────────
    // event='call' já foi tratado acima com early-return.
    // Aqui cobrimos chamadas que chegam via messages_upsert com stub 40 (voz) ou 75 (vídeo).
    const stubType: number | undefined = msgData?.messageStubType ?? body?.messageStubType
    const isVideoCall = stubType === 75
    const isCallEvent = stubType === 40 || stubType === 75

    if (isCallEvent) {
      // Registar chamada perdida como mensagem no chat e terminar imediatamente
      // (não há msg/texto adicional a extrair — o stub É a mensagem)
      const callText = isVideoCall
        ? '📹 Chamada de Vídeo Perdida'
        : '📞 Chamada de Voz Perdida'

      // Resolve tenant_id igual ao fluxo normal de mensagens recebidas
      const { data: callOrgData } = await supabase
        .from('organization_settings')
        .select('tenant_id')
        .eq('id', 'default')
        .maybeSingle()
      const callTenantId = callOrgData?.tenant_id ?? null

      if (callTenantId && phone) {
        const { error: callErr } = await supabase
          .schema('contract_crm')
          .from('contract_whatsapp_messages')
          .insert({
            phone,
            message:  callText,
            direction: 'recebido',
            media_type: 'call',
            triggered_automatically: false,
            instance_name: instanceName,
            tenant_id: callTenantId,
            created_at: new Date().toISOString(),
          })
        if (callErr) console.error('[evo-webhook] call insert error', callErr)
      }
      return NextResponse.json({ ok: true, type: 'call-missed' })
    }
    // ─────────────────────────────────────────────────────────────────────

    // Desempacota viewOnce (foto/vídeo que desaparece) — trata como mídia normal
    const viewOnceInner: Record<string, any> | null =
      msg?.viewOnceMessage?.message ??
      msg?.viewOnceMessageV2?.message?.viewOnceMessage?.message ??
      null

    // Mensagens editadas (protocolMessage type 14 — editedMessage)
    const editedMsg = msg?.protocolMessage?.editedMessage?.message
    const editedText: string | null = editedMsg
      ? (editedMsg.conversation ?? editedMsg.extendedTextMessage?.text ?? null)
      : null

    // Texto puro + legendas de mídia (prioridade descendente)
    const text: string | null =
      (editedText ? `✏️ [Editada] ${editedText}` : null) ??
      msg?.conversation ??
      msg?.extendedTextMessage?.text ??
      msg?.imageMessage?.caption ??
      msg?.videoMessage?.caption ??
      viewOnceInner?.imageMessage?.caption ??
      viewOnceInner?.videoMessage?.caption ??
      msg?.documentMessage?.caption ??
      msg?.documentWithCaptionMessage?.message?.documentMessage?.caption ??
      msg?.documentMessage?.title ??
      msgData?.body ?? msgData?.text ?? msgData?.content ?? null

    // ── Detecção de tipo de mídia — declaração antecipada (usado também em contactLabel) ──
    let mediaType: string | null = null

    // Contacto(s) — extrai nome e telefone do vCard para renderização no frontend
    // Formato do message salvo: "[Contato] Nome | +5511999999999"
    // O frontend detecta media_type === 'contact' e renderiza o ContactCard.
    let contactLabel: string | null = null
    if (msg?.contactMessage) {
      const vcard: string = msg.contactMessage.vcard ?? ''
      const fn     = vcard.match(/^FN:(.+)$/m)?.[1]?.trim()
      const rawTel = vcard.match(/^TEL[^:\r\n]*:([^\r\n]+)/m)?.[1]
      const tel    = rawTel ? rawTel.trim().replace(/\D/g, '') : null
      const name   = fn || msg.contactMessage.displayName || 'Contato'
      contactLabel = tel ? `[Contato] ${name} | ${tel}` : `[Contato] ${name}`
      mediaType = 'contact'
    } else if (msg?.contactsArrayMessage) {
      const parts = (msg.contactsArrayMessage.contacts ?? []).map((c: any) => {
        const vcard: string = c.vcard ?? ''
        const fn     = vcard.match(/^FN:(.+)$/m)?.[1]?.trim()
        const rawTel = vcard.match(/^TEL[^:\r\n]*:([^\r\n]+)/m)?.[1]
        const tel    = rawTel ? rawTel.trim().replace(/\D/g, '') : null
        const name   = fn || c.displayName || 'Contato'
        return tel ? `${name} | ${tel}` : name
      }).filter(Boolean)
      contactLabel = `[Contato] ${parts.join('; ')}`
      mediaType = 'contact'
    }

    // Localização
    let locationLabel: string | null = null
    if (msg?.locationMessage) {
      const loc = msg.locationMessage
      locationLabel = loc.name || loc.address
        ? `[Localização] ${loc.name || loc.address}`
        : '[Localização]'
    } else if (msg?.liveLocationMessage) {
      locationLabel = msg.liveLocationMessage.caption
        ? `[Localização ao vivo] ${msg.liveLocationMessage.caption}`
        : '[Localização ao vivo]'
    }

    // Enquetes
    let pollLabel: string | null = null
    const pollMsg = msg?.pollCreationMessage ?? msg?.pollCreationMessageV3 ?? null
    if (pollMsg) {
      const name = pollMsg.name ?? 'Enquete'
      const opts = (pollMsg.options ?? []).map((o: any) => o.optionName).filter(Boolean)
      pollLabel = opts.length > 0 ? `[Enquete] ${name}: ${opts.join(' / ')}` : `[Enquete] ${name}`
    }

    // Respostas a botões e listas
    let buttonLabel: string | null = null
    if (msg?.templateButtonReplyMessage) {
      const sel = msg.templateButtonReplyMessage.selectedDisplayText ?? msg.templateButtonReplyMessage.selectedId ?? 'Botão'
      buttonLabel = `[Resposta] ${sel}`
    } else if (msg?.buttonsResponseMessage) {
      const sel = msg.buttonsResponseMessage.selectedDisplayText ?? msg.buttonsResponseMessage.selectedButtonId ?? 'Botão'
      buttonLabel = `[Resposta] ${sel}`
    } else if (msg?.listResponseMessage) {
      const sel = msg.listResponseMessage.title ?? msg.listResponseMessage.singleSelectReply?.selectedRowId ?? 'Opção'
      buttonLabel = `[Resposta de lista] ${sel}`
    }

    // ── Detecção de tipo de mídia e construção da URL proxy ───────────────────
    let mediaUrl: string | null = null
    let mediaFilename: string | null = null

    const FRIENDLY: Record<string, string> = {
      image: '[Imagem]', audio: '[Áudio]', video: '[Vídeo]',
      document: '[Documento]', sticker: '[Figurinha]', contact: '[Contato]',
      location: '[Localização]', poll: '[Enquete]', protocol: '[Ação do Sistema]',
      system: '[Aviso do Sistema]',
    }

    if (msg?.imageMessage || viewOnceInner?.imageMessage) {
      mediaType = 'image'
      if (messageId) mediaUrl = buildMediaProxyUrl(messageId, instanceName)
    } else if (msg?.audioMessage) {
      mediaType = 'audio'
      if (messageId) mediaUrl = buildMediaProxyUrl(messageId, instanceName)
    } else if (msg?.voiceMessage) {
      mediaType = 'audio'
      if (messageId) mediaUrl = buildMediaProxyUrl(messageId, instanceName)
    } else if (msg?.videoMessage || viewOnceInner?.videoMessage) {
      mediaType = 'video'
      if (messageId) mediaUrl = buildMediaProxyUrl(messageId, instanceName)
    } else if (msg?.documentMessage) {
      mediaType = 'document'
      mediaFilename = msg.documentMessage.fileName ?? null
      if (messageId) mediaUrl = buildMediaProxyUrl(messageId, instanceName)
    } else if (msg?.documentWithCaptionMessage?.message?.documentMessage) {
      const docMsg = msg.documentWithCaptionMessage.message.documentMessage
      mediaType = 'document'
      mediaFilename = docMsg.fileName ?? null
      if (messageId) mediaUrl = buildMediaProxyUrl(messageId, instanceName)
    } else if (msg?.stickerMessage) {
      mediaType = 'sticker'
      if (messageId) mediaUrl = buildMediaProxyUrl(messageId, instanceName)
    }

    const dbMediaType = mediaType === 'sticker' ? 'image' : mediaType

    // Texto final consolidado — nunca cai em '[Formato não suportado]' para tipos conhecidos
    const finalText: string =
      text ??
      contactLabel ??
      locationLabel ??
      pollLabel ??
      buttonLabel ??
      (mediaType ? (FRIENDLY[mediaType] ?? `[${mediaType}]`) : null) ??
      (msg?.stickerMessage ? '🎨' : null) ??
      '[Formato não suportado]'

    // ── Mensagens enviadas pelo próprio número (fromMe) ───────────────────────
    if (isFromMe) {
      // BUG FIX: condição anterior `&& messageId` descartava silenciosamente
      // mensagens onde a Evolution não inclui key.id (envios via CRM/web).
      // BUG FIX: `.schema('contract_crm')` garante a schema correcta.
      // BUG FIX: salva mesmo quando text é null (emoji, sticker sem caption).
      const { data: orgData, error: orgErr } = await supabase
        .schema('contract_crm')
        .from('organization_settings')
        .select('tenant_id')
        .eq('id', 'default')
        .maybeSingle()

      if (orgErr) {
        console.error('[evo-webhook][fromMe] falha ao buscar tenant_id:', orgErr.message)
      }

      const tenantId = orgData?.tenant_id ?? null

      if (tenantId) {
        // Deduplicação apenas quando temos messageId (evita duplicatas no reload)
        if (messageId) {
          const { data: existingFromMe } = await supabase
            .schema('contract_crm')
            .from('contract_whatsapp_messages')
            .select('id')
            .eq('zapi_message_id', messageId)
            .maybeSingle()
          if (existingFromMe) {
            return NextResponse.json({ ok: true, skipped: 'fromMe-duplicate' })
          }
        }

        const { error: insertErr } = await supabase
          .schema('contract_crm')
          .from('contract_whatsapp_messages')
          .insert({
            phone,
            message: finalText,           // finalText nunca é null — tem fallback '[Formato não suportado]'
            direction: 'enviado',
            status: 'enviado',
            triggered_automatically: false,
            zapi_message_id: messageId ?? null,   // null aceite — sem dedup neste caso
            instance_name: instanceName,
            tenant_id: tenantId,
            media_url: mediaUrl,
            media_type: dbMediaType,
            media_filename: mediaFilename,
            created_at: messageTimestamp
              ? new Date(Number(messageTimestamp) * 1000).toISOString()
              : new Date().toISOString(),
          })

        if (insertErr) {
          console.error('[evo-webhook][fromMe] INSERT falhou:', {
            msg: insertErr.message,
            phone,
            instanceName,
            messageId: messageId ?? 'null',
          })
        }
      } else {
        console.warn('[evo-webhook][fromMe] tenant_id não encontrado — mensagem NÃO persistida', {
          phone, instanceName, messageId: messageId ?? 'null',
        })
      }

      return NextResponse.json({ ok: true, skipped: 'fromMe-processed' })
    }

    // ── Deduplicação ─────────────────────────────────────────────────────────
    if (messageId) {
      const { data: dup } = await supabase
        .from('contract_whatsapp_messages')
        .select('id')
        .eq('zapi_message_id', messageId)
        .maybeSingle()
      if (dup) return NextResponse.json({ ok: true, skipped: 'duplicata' })
    }

    // ── Opt-out ───────────────────────────────────────────────────────────────
    if (text && isOptOutMessage(text)) {
      await recordWhatsAppOptOut(phone)
      return NextResponse.json({ ok: true, recorded: 'opt-out' })
    }

    // ── Tenant ────────────────────────────────────────────────────────────────
    const { data: orgData } = await supabase
      .from('organization_settings')
      .select('tenant_id')
      .eq('id', 'default')
      .maybeSingle()
    const tenantId = orgData?.tenant_id ?? null
    if (!tenantId) return NextResponse.json({ ok: false, error: 'tenant_id missing' })

    // ── Inserção da mensagem recebida ─────────────────────────────────────────
    const { data: inserted, error: insertError } = await supabase
      .from('contract_whatsapp_messages')
      .insert({
        phone,
        message: finalText,
        direction: 'recebido',
        status: 'recebido',
        triggered_automatically: false,
        zapi_message_id: messageId ?? null,
        unlinked_sender_name: pushName,
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
    try {
      const last8 = phone.length >= 8 ? phone.slice(-8) : phone
      const instKey = instanceName ?? ''

      // ── Busca status da conversa ─────────────────────────────────────────────
      const { data: exactRows } = await supabase
        .from('whatsapp_conversation_status')
        .select('*')
        .eq('phone', phone)
        .eq('instance_name', instKey)
        .limit(1)

      let currentStatus = exactRows && exactRows.length > 0 ? exactRows[0] : null

      if (!currentStatus) {
        const { data: fuzzyRows } = await supabase
          .from('whatsapp_conversation_status')
          .select('*')
          .ilike('phone', `%${last8}`)
          .eq('instance_name', instKey)
          .order('updated_at', { ascending: false })
          .limit(1)
        currentStatus = fuzzyRows && fuzzyRows.length > 0 ? fuzzyRows[0] : null
      }

      const statusPhone: string = currentStatus?.phone ?? phone
      const statusInstance: string = currentStatus?.instance_name ?? instKey

      // ── Busca configurações globais + verificação de bot por instância ────────
      const { data: orgSettings } = await supabase
        .from('organization_settings')
        .select('evo_server_url, evo_api_key, evo_instance_name, evo_instance_aliases, triage_menu_options, triage_enabled')
        .eq('id', 'default')
        .maybeSingle()

      // VERIFICAÇÃO: bot habilitado para esta instância específica?
      // evo_instance_aliases é um objeto JSON { "instancia_a": { alias: "...", bot_enabled: true }, ... }
      // Se a chave não existir no aliases, assume bot_enabled = true (comportamento padrão).
      // Se existir mas bot_enabled === false, o bot fica mudo para esta instância.
      const instanceAliases = (orgSettings?.evo_instance_aliases ?? {}) as Record<string, any>
      const instanceConfig = instanceName ? instanceAliases[instanceName] : null
      const botEnabledForInstance = instanceConfig
        ? instanceConfig.bot_enabled !== false   // false explícito desliga; undefined/true liga
        : true                                    // instâncias sem config seguem ligadas por padrão

      if (!botEnabledForInstance) {
        // Bot desligado para esta instância — só gravamos a mensagem, sem automação
        return NextResponse.json({ ok: true, id: inserted?.id, bot: 'disabled_for_instance' })
      }

      // triage_enabled é o interruptor global (quando false, para tudo)
      if (orgSettings?.triage_enabled === false) {
        return NextResponse.json({ ok: true, id: inserted?.id })
      }

      const menuOptions = (orgSettings?.triage_menu_options ?? []) as Array<{ key: string; label: string; department: string }>

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
            .eq('phone', statusPhone)
            .eq('instance_name', statusInstance)

          const { data: orgSettingsNps } = await supabase
            .from('organization_settings')
            .select('evo_server_url, evo_api_key, evo_instance_name')
            .eq('id', 'default')
            .maybeSingle()

          const npsAgradecimento = `Obrigado pela sua avaliação! Sua nota ${scoreNum} foi registrada com sucesso. Tenha um ótimo dia!`
          await sendAndRecordBotMessage(supabase, tenantId, orgSettingsNps, instanceName, rawPhone, phone, npsAgradecimento)
          return NextResponse.json({ ok: true, status: 'nps_recorded' })
        }
      }

      // ── REABERTURA AUTOMÁTICA DE CONVERSAS ARQUIVADAS ────────────────────────
      if (currentStatus?.is_archived === true) {
        await supabase
          .from('whatsapp_conversation_assignments')
          .delete()
          .eq('phone', statusPhone)
          .eq('instance_name', statusInstance)

        let newProtocol: string | null = null
        const { data: protoData } = await supabase.rpc('next_whatsapp_protocol', { p_tenant_id: tenantId })
        newProtocol = (protoData as string) ?? null

        const newTriageState = menuOptions.length > 0 ? 'awaiting_selection' : 'active'

        await supabase
          .from('whatsapp_conversation_status')
          .update({
            is_archived: false,
            archived_at: null,
            nps_pending: false,
            nps_score: null,
            department: null,
            triage_state: newTriageState,
            protocol_number: newProtocol,
            updated_at: new Date().toISOString(),
          })
          .eq('phone', statusPhone)
          .eq('instance_name', statusInstance)

        if (menuOptions.length > 0) {
          await sendAndRecordTriageMenu(supabase, tenantId, orgSettings, instanceName, rawPhone, phone, newProtocol, menuOptions)
        }

        return NextResponse.json({ ok: true, status: 'conversation_reopened', id: inserted?.id })
      }

      // ── FLUXO NORMAL DE TRIAGEM ──────────────────────────────────────────────
      const state: string = currentStatus?.triage_state ?? 'none'

      // TRAVA ANTI-DUPLICAÇÃO DE PROTOCOLO:
      // Se a conversa já está activa ou em triagem, não faz nada de automático.
      // Só o estado 'none' (sem registo algum) ou ausência total de currentStatus
      // permite gerar um novo protocolo e enviar o menu de boas-vindas.
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
              updated_at: new Date().toISOString(),
            })
            .eq('phone', statusPhone)
            .eq('instance_name', statusInstance)

          const protocolNumber = currentStatus?.protocol_number ?? null
          const confirmMsg = `Opção ${chosen.key} selecionada. Seu atendimento foi direcionado para o setor *${chosen.label}*. Um atendente responderá em breve!${protocolNumber ? ` (Protocolo: ${protocolNumber})` : ''}`
          await sendAndRecordBotMessage(supabase, tenantId, orgSettings, instanceName, rawPhone, phone, confirmMsg)
          return NextResponse.json({ ok: true, status: 'triage_confirmed' })
        } else {
          const protocolNumber = currentStatus?.protocol_number ?? null
          await sendAndRecordTriageMenu(supabase, tenantId, orgSettings, instanceName, rawPhone, phone, protocolNumber, menuOptions)
          return NextResponse.json({ ok: true, status: 'menu_resent' })
        }
      }

      // Estado: 'none' ou currentStatus === null — PRIMEIRO CONTACTO REAL
      // Só chegamos aqui se não há registo na tabela OU o estado é literalmente 'none'.
      // Qualquer outro valor de triage_state não reconhecido é tratado como 'active'
      // para evitar disparar protocolos em estados desconhecidos.
      if (state !== 'none' && currentStatus !== null) {
        console.warn(`[evo-webhook] triage_state desconhecido '${state}' — tratado como active`)
        return NextResponse.json({ ok: true, status: 'unknown_state_ignored' })
      }

      let protocolNumber: string | null = null
      const { data: protoData } = await supabase.rpc('next_whatsapp_protocol', { p_tenant_id: tenantId })
      protocolNumber = (protoData as string) ?? null

      const newState = menuOptions.length > 0 ? 'awaiting_selection' : 'active'

      await supabase
        .from('whatsapp_conversation_status')
        .upsert(
          {
            phone,
            instance_name: instKey,
            tenant_id: tenantId,
            protocol_number: protocolNumber,
            triage_state: newState,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'phone,instance_name' }
        )

      if (menuOptions.length > 0) {
        await sendAndRecordTriageMenu(supabase, tenantId, orgSettings, instanceName, rawPhone, phone, protocolNumber, menuOptions)
      }

    } catch (err) {
      console.error('[evo-webhook] erro enterprise:', err)
    }

    return NextResponse.json({ ok: true, id: inserted?.id })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? 'erro' })
  }
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
