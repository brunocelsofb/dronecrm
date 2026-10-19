// ─── SDR de IA no WhatsApp: quando entra, conversa e passa para o time ────────
// Chamado pelo webhook da Evolution depois de gravar a mensagem recebida.
// Rotina da plataforma (webhook): usa o admin e filtra tenant_id em tudo.
//
// Regras:
//   - só atende números (instâncias) escolhidos pela empresa, ou o setor da triagem;
//   - não entra em conversa já em andamento com pessoas, nem com cliente cadastrado;
//   - pessoa do time escreveu na conversa → a IA sai na hora;
//   - sem chave de IA da empresa → não entra (segue o fluxo normal).

import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAnthropicKeyForTenant } from '@/lib/ai/tenant-key'
import { ingestLead } from '@/lib/leads/ingest'
import { readSdrSettings, bookingLinkFor, type SdrSettings } from './settings'
import { buildTranscript, needsReply, mergeAnswers, answersText, type MsgRow } from './prompt'
import { runSdrTurn, type ToolCall } from './turn'
import { sendSdrText } from './channel'
import { kindOf } from '@/lib/whatsapp/contact-kind'

const DEBOUNCE_MS = 5000          // espera mensagens em sequência ("oi" + "tudo bem?" + ...)
const LOCK_MS = 90_000
const QUIET_DAYS = 30             // não volta a abordar quem já passou pela IA ou falou com o time
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const nowIso = () => new Date().toISOString()

type Conv = {
  id: string; tenant_id: string; phone: string; instance_name: string; status: string
  contact_name: string | null; lead_id: string | null; assigned_to: string | null
  answers: Record<string, unknown>; ai_replies: number; input_tokens: number; output_tokens: number
  started_at: string; last_processed_at: string | null
}

async function loadConfig(tenantId: string) {
  const { data } = await createAdminClient().from('organization_settings')
    .select('sdr_settings, company_name, name').eq('tenant_id', tenantId).maybeSingle()
  return {
    settings: readSdrSettings(data?.sdr_settings),
    companyName: (data?.company_name as string | null) || (data?.name as string | null) || 'nossa empresa',
  }
}

const last8 = (p: string) => p.replace(/\D/g, '').slice(-8)

async function activeConversation(tenantId: string, phone: string, instance: string): Promise<Conv | null> {
  const { data } = await createAdminClient().from('sdr_conversations').select('*')
    .eq('tenant_id', tenantId).eq('phone', phone).eq('instance_name', instance).eq('status', 'active').maybeSingle()
  return (data as Conv | null) ?? null
}

// Pode a IA começar a atender este contato? 'client' = cliente cadastrado (vai para o consultor de clientes)
async function canStart(tenantId: string, s: SdrSettings, phone: string, instance: string): Promise<'ok' | 'client' | 'no'> {
  const db = createAdminClient()
  const since = new Date(Date.now() - QUIET_DAYS * 86400_000).toISOString()
  const tail = last8(phone)
  if (tail.length < 8) return 'no'

  const [{ data: recentSdr }, { data: humanMsg }, { data: status }, { data: openLead }] = await Promise.all([
    db.from('sdr_conversations').select('id').eq('tenant_id', tenantId).eq('phone', phone).gte('started_at', since).limit(1),
    db.from('contract_whatsapp_messages').select('id').eq('tenant_id', tenantId).ilike('phone', `%${tail}`)
      .eq('direction', 'enviado').eq('triggered_automatically', false).gte('created_at', since).limit(1),
    db.from('whatsapp_conversation_status').select('triage_state, is_archived').eq('tenant_id', tenantId).eq('phone', phone).eq('instance_name', instance).maybeSingle(),
    db.from('leads').select('id').eq('tenant_id', tenantId).ilike('phone', `%${tail}`).not('handed_off_at', 'is', null)
      .not('status', 'in', '(convertido,descartado)').limit(1),
  ])
  if (recentSdr?.length || humanMsg?.length || openLead?.length) return 'no'
  // Conversa já em andamento com o time (não arquivada)
  if (status && status.is_archived !== true && ['active', 'awaiting_selection'].includes(String(status.triage_state))) return 'no'
  // Mesmo selo da Central (contrato ativo na carteira, ou marcado como cliente)
  if (s.skip_known_contacts && (await kindOf(tenantId, phone)).kind === 'cliente') return 'client'
  return 'ok'
}

// Conversa fica com uma pessoa do time (WhatsApp do CRM) e ela é avisada
async function assignConversation(tenantId: string, phone: string, instance: string, userId: string, notice: string) {
  const db = createAdminClient()
  await db.from('whatsapp_conversation_assignments').upsert({
    phone, instance_name: instance, tenant_id: tenantId, assigned_to: userId, assigned_at: nowIso(),
  }, { onConflict: 'tenant_id,phone' })
  await db.from('notifications').insert({ user_id: userId, message: notice.slice(0, 300) })
}

async function personName(userId: string): Promise<string | null> {
  const { data } = await createAdminClient().from('profiles').select('full_name').eq('id', userId).maybeSingle()
  return (data?.full_name as string | null)?.split(' ')[0] ?? null
}

const fmtPhone = (d: string) => (d.length === 13 && d.startsWith('55') ? d.slice(2) : d).replace(/^(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3')

// Cliente cadastrado escreveu no número da IA: sem IA, vai direto para o consultor de clientes
async function routeKnownClient(tenantId: string, s: SdrSettings, phone: string, instance: string, pushName: string | null,
  schedule: (fn: () => Promise<void>) => void): Promise<boolean> {
  if (!s.client_owner) return false
  const db = createAdminClient()
  const { data: owner } = await db.from('profiles').select('id').eq('id', s.client_owner).eq('tenant_id', tenantId).maybeSingle()
  if (!owner) return false
  const conv = await createConversation(tenantId, phone, instance, pushName, nowIso())
  if (!conv) return false
  await endConversation(conv, 'routed', { end_reason: 'Cliente cadastrado: encaminhado ao consultor de clientes.', assigned_to: s.client_owner })
  await assignConversation(tenantId, phone, instance, s.client_owner, `Cliente ${pushName ?? fmtPhone(phone)} escreveu no número ${instance} e foi encaminhado a você.`)
  if (s.client_auto_reply) schedule(async () => { await sendAndRecord(conv, s, s.client_auto_reply) })
  return true
}

async function aiReady(tenantId: string, s: SdrSettings): Promise<boolean> {
  return s.enabled && s.channel === 'evolution' && !!(await getAnthropicKeyForTenant(tenantId)).key
}

async function createConversation(tenantId: string, phone: string, instance: string, pushName: string | null, startedAt: string): Promise<Conv | null> {
  const { data, error } = await createAdminClient().from('sdr_conversations')
    .insert({ tenant_id: tenantId, phone, instance_name: instance, contact_name: pushName, started_at: startedAt })
    .select('*').single()
  if (error) {
    // Outra mensagem já abriu a conversa ao mesmo tempo (índice único): usa a que existe
    return activeConversation(tenantId, phone, instance)
  }
  return data as Conv
}

/**
 * Mensagem recebida: a IA continua, começa, ou fica de fora (null → fluxo normal).
 * `schedule` roda o atendimento depois de responder ao webhook (after()).
 */
export async function routeInboundToSdr(opts: {
  tenantId: string; phone: string; instanceName: string | null; messageRowId: string; messageAt: string
  pushName: string | null; schedule: (fn: () => Promise<void>) => void
}): Promise<'continued' | 'started' | 'client' | null> {
  if (!opts.instanceName) return null // a IA só atende números identificados
  const instance = opts.instanceName
  const { settings } = await loadConfig(opts.tenantId)
  if (!settings.enabled) return null

  const existing = await activeConversation(opts.tenantId, opts.phone, instance)
  if (existing) {
    opts.schedule(() => runSdr(existing.id, opts.messageRowId))
    return 'continued'
  }
  if (!settings.instances.includes(instance)) return null
  const can = await canStart(opts.tenantId, settings, opts.phone, instance)
  if (can === 'client') return (await routeKnownClient(opts.tenantId, settings, opts.phone, instance, opts.pushName, opts.schedule)) ? 'client' : null
  if (can !== 'ok') return null
  if (!(await aiReady(opts.tenantId, settings))) return null

  // Começa um pouco antes da mensagem, para ela entrar na conversa
  const startedAt = new Date(new Date(opts.messageAt).getTime() - 1000).toISOString()
  const conv = await createConversation(opts.tenantId, opts.phone, instance, opts.pushName, startedAt)
  if (!conv) return null
  opts.schedule(() => runSdr(conv.id, opts.messageRowId))
  return 'started'
}

/** Triagem: o contato escolheu um setor que a empresa passou para a IA. */
export async function startSdrFromTriage(opts: {
  tenantId: string; phone: string; instanceName: string | null; department: string; pushName: string | null
  schedule: (fn: () => Promise<void>) => void
}): Promise<boolean> {
  if (!opts.instanceName) return false
  const instance = opts.instanceName
  const { settings } = await loadConfig(opts.tenantId)
  if (!settings.departments.includes(opts.department)) return false
  if (!(await aiReady(opts.tenantId, settings))) return false
  if (await activeConversation(opts.tenantId, opts.phone, instance)) return true
  // Pega a conversa desde a última hora (inclui o que a pessoa escreveu antes do menu)
  const conv = await createConversation(opts.tenantId, opts.phone, instance, opts.pushName, new Date(Date.now() - 3600_000).toISOString())
  if (!conv) return false
  opts.schedule(() => runSdr(conv.id, null))
  return true
}

/** Atende: espera a sequência de mensagens, trava a conversa, responde. */
export async function runSdr(conversationId: string, triggerRowId: string | null): Promise<void> {
  await sleep(DEBOUNCE_MS)
  const db = createAdminClient()
  for (let round = 0; round < 3; round++) {
    const { data: c } = await db.from('sdr_conversations').select('*').eq('id', conversationId).maybeSingle()
    const conv = c as Conv | null
    if (!conv || conv.status !== 'active') return

    const { data: lastIn } = await db.from('contract_whatsapp_messages').select('id, created_at')
      .eq('tenant_id', conv.tenant_id).eq('phone', conv.phone).eq('instance_name', conv.instance_name)
      .eq('direction', 'recebido').order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (!lastIn) return
    // Chegou mensagem mais nova: quem responde é o atendimento dela
    if (round === 0 && triggerRowId && lastIn.id !== triggerRowId) return
    if (conv.last_processed_at && lastIn.created_at <= conv.last_processed_at && round > 0) return

    const lockUntil = new Date(Date.now() + LOCK_MS).toISOString()
    const { data: locked } = await db.from('sdr_conversations').update({ processing_until: lockUntil })
      .eq('id', conv.id).or(`processing_until.is.null,processing_until.lt."${nowIso()}"`).select('id')
    if (!locked?.length) return

    try {
      await respond(conv, lastIn.created_at)
    } catch (e) {
      console.error('[sdr] erro ao atender:', e instanceof Error ? e.message : e)
      await endConversation(conv, 'error', { last_error: e instanceof Error ? e.message.slice(0, 500) : 'erro', end_reason: 'Erro da IA: a conversa foi para o time.' })
      return
    } finally {
      await db.from('sdr_conversations').update({ processing_until: null }).eq('id', conv.id)
    }
  }
}

async function respond(conv: Conv, snapshotAt: string): Promise<void> {
  const db = createAdminClient()
  const { settings, companyName } = await loadConfig(conv.tenant_id)
  const { data: rowsRaw } = await db.from('contract_whatsapp_messages')
    .select('direction, message, media_type, triggered_automatically, created_at')
    .eq('tenant_id', conv.tenant_id).eq('phone', conv.phone).eq('instance_name', conv.instance_name)
    .gte('created_at', conv.started_at).order('created_at', { ascending: true }).limit(80)
  const rows = (rowsRaw ?? []) as MsgRow[]

  // Alguém do time escreveu: a IA sai (ignora o eco das mensagens da própria IA)
  const autoTexts = new Set(rows.filter(r => r.direction === 'enviado' && r.triggered_automatically).map(r => (r.message ?? '').trim()))
  const human = rows.find(r => r.direction === 'enviado' && !r.triggered_automatically && !autoTexts.has((r.message ?? '').trim()))
  if (human) {
    await endConversation(conv, 'human', { end_reason: 'Uma pessoa do time assumiu a conversa.' })
    return
  }
  if (!settings.enabled) {
    await endConversation(conv, 'human', { end_reason: 'SDR de IA desligado: conversa com o time.' })
    return
  }

  const turns = buildTranscript(rows)
  await db.from('sdr_conversations').update({ last_processed_at: snapshotAt, updated_at: nowIso() }).eq('id', conv.id)
  if (!needsReply(turns)) return

  const repliesLeft = settings.max_replies - conv.ai_replies
  if (repliesLeft <= 0) {
    const r = await handoff(conv, settings, { resumo: answersText(conv.answers) || 'Limite de respostas da IA atingido.', qualificado: false, temperatura: 'morno', motivo: 'limite de respostas' })
    await sendAndRecord(conv, settings, handoffClosing(r.seller, r.booking))
    return
  }

  const key = (await getAnthropicKeyForTenant(conv.tenant_id)).key
  if (!key) {
    await endConversation(conv, 'error', { end_reason: 'Sem chave de IA: a conversa foi para o time.' })
    return
  }

  let answers = conv.answers ?? {}
  const onTool = async (call: ToolCall): Promise<string | { result: string; closing?: string }> => {
    if (call.name === 'registrar_respostas') {
      answers = mergeAnswers(answers, call.input)
      await db.from('sdr_conversations').update({ answers, updated_at: nowIso() }).eq('id', conv.id)
      return 'Registrado.'
    }
    if (call.name === 'passar_para_comercial') {
      const r = await handoff({ ...conv, answers }, settings, call.input)
      return {
        result: r.booking ? `Passado para ${r.seller ?? 'o time comercial'}. Link de agenda para enviar: ${r.booking}` : `Passado para ${r.seller ?? 'o time comercial'}. Sem link de agenda: diga que o consultor vai entrar em contato.`,
        closing: handoffClosing(r.seller, r.booking),
      }
    }
    if (call.name === 'encaminhar_para_equipe') {
      const setor = typeof call.input.setor === 'string' ? call.input.setor.slice(0, 60) : null
      const motivo = String(call.input.motivo ?? '').slice(0, 300) || 'Assunto para o time'
      // Cliente atual: vai para o consultor de clientes (farmer)
      if (call.input.cliente_atual === true && settings.client_owner) {
        await endConversation({ ...conv, answers }, 'routed', { end_reason: `Cliente atual: ${motivo}`, department: setor, assigned_to: settings.client_owner })
        const who = (typeof answers.nome === 'string' && answers.nome) || conv.contact_name || fmtPhone(conv.phone)
        await assignConversation(conv.tenant_id, conv.phone, conv.instance_name, settings.client_owner, `Cliente ${who} pediu atendimento (${motivo}) pelo número ${conv.instance_name}.`)
        const name = await personName(settings.client_owner)
        return {
          result: `Encaminhado ao consultor de clientes${name ? ` ${name}` : ''}.${settings.client_owner_phone ? ` WhatsApp dele: ${fmtPhone(settings.client_owner_phone)}.` : ''} Avise que ele vai dar sequência.`,
          closing: `Obrigado! Vou encaminhar para ${name ?? 'o consultor responsável pelos clientes'}, que dá sequência ao seu atendimento${settings.client_owner_phone ? ` pelo WhatsApp ${fmtPhone(settings.client_owner_phone)}` : ''}.`,
        }
      }
      await endConversation({ ...conv, answers }, 'routed', { end_reason: motivo, department: setor })
      return { result: 'Encaminhado ao time. Avise que uma pessoa vai responder por aqui.', closing: 'Obrigado! Vou encaminhar sua mensagem para o nosso time, que responde por aqui em breve.' }
    }
    await endConversation({ ...conv, answers }, 'disqualified', { end_reason: String(call.input.motivo ?? '').slice(0, 300) || 'Descartado' })
    return { result: 'Encerrado.', closing: 'Obrigado pelo contato! Esse pedido não é algo que atendemos, mas ficamos à disposição se precisar de outra coisa.' }
  }

  const result = await runSdrTurn({
    client: new Anthropic({ apiKey: key }).messages,
    settings, companyName, turns, repliesLeft, contactName: conv.contact_name, onTool,
  })

  await db.from('sdr_conversations').update({
    input_tokens: conv.input_tokens + result.usage.input,
    output_tokens: conv.output_tokens + result.usage.output,
    updated_at: nowIso(),
  }).eq('id', conv.id)

  if (result.text) {
    await sendAndRecord(conv, settings, result.text)
    await db.from('sdr_conversations').update({ ai_replies: conv.ai_replies + 1 }).eq('id', conv.id)
  }
}

async function sendAndRecord(conv: Conv, settings: SdrSettings, text: string): Promise<boolean> {
  const db = createAdminClient()
  const res = await sendSdrText({ tenantId: conv.tenant_id, settings, instanceName: conv.instance_name, phone: conv.phone, text })
  if (!res.ok) {
    await db.from('sdr_conversations').update({ last_error: res.error }).eq('id', conv.id)
    return false
  }
  // O WhatsApp devolve a própria mensagem pelo webhook (fromMe): se já entrou, só marca como da IA
  if (res.messageId) {
    const { data: echo } = await db.from('contract_whatsapp_messages').select('id')
      .eq('tenant_id', conv.tenant_id).eq('zapi_message_id', res.messageId).maybeSingle()
    if (echo) {
      await db.from('contract_whatsapp_messages').update({ triggered_automatically: true, lead_id: conv.lead_id }).eq('id', echo.id)
      return true
    }
  }
  await db.from('contract_whatsapp_messages').insert({
    tenant_id: conv.tenant_id, phone: conv.phone, message: text, direction: 'enviado', status: 'enviado',
    triggered_automatically: true, zapi_message_id: res.messageId, instance_name: conv.instance_name || null,
    lead_id: conv.lead_id, created_at: nowIso(),
  })
  return true
}

// Conversa sai da IA: abre no WhatsApp do CRM para o time (protocolo e setor)
async function endConversation(conv: Conv, status: 'handed_off' | 'routed' | 'human' | 'disqualified' | 'error',
  extra: { end_reason?: string; last_error?: string; department?: string | null; summary?: string; lead_id?: string | null; assigned_to?: string | null } = {}) {
  const db = createAdminClient()
  const { settings } = await loadConfig(conv.tenant_id)
  await db.from('sdr_conversations').update({
    status, ended_at: nowIso(), updated_at: nowIso(), answers: conv.answers ?? {},
    ...(extra.end_reason !== undefined ? { end_reason: extra.end_reason } : {}),
    ...(extra.last_error !== undefined ? { last_error: extra.last_error } : {}),
    ...(extra.summary !== undefined ? { summary: extra.summary } : {}),
    ...(extra.lead_id !== undefined ? { lead_id: extra.lead_id } : {}),
    ...(extra.assigned_to !== undefined ? { assigned_to: extra.assigned_to } : {}),
  }).eq('id', conv.id).eq('status', 'active')

  if (status === 'human') return // o time já está na conversa
  const { data: st } = await db.from('whatsapp_conversation_status').select('protocol_number')
    .eq('tenant_id', conv.tenant_id).eq('phone', conv.phone).eq('instance_name', conv.instance_name).maybeSingle()
  let protocol = (st?.protocol_number as string | null) ?? null
  if (!protocol) {
    const { data } = await db.rpc('next_whatsapp_protocol', { p_tenant_id: conv.tenant_id })
    protocol = (data as string | null) ?? null
  }
  await db.from('whatsapp_conversation_status').upsert({
    phone: conv.phone, instance_name: conv.instance_name, tenant_id: conv.tenant_id, protocol_number: protocol,
    triage_state: 'active',
    department: status === 'handed_off' ? settings.handoff_department : (extra.department ?? null),
    is_archived: status === 'disqualified', archived_at: status === 'disqualified' ? nowIso() : null,
    updated_at: nowIso(),
  }, { onConflict: 'phone,instance_name' })
}

// Rodízio: o vendedor da lista que recebeu há mais tempo (ou nunca)
async function pickSeller(tenantId: string, s: SdrSettings): Promise<string | null> {
  if (!s.sellers.length) return null
  const db = createAdminClient()
  const { data: valid } = await db.from('profiles').select('id').eq('tenant_id', tenantId).in('id', s.sellers)
  const ids = (valid ?? []).map(p => p.id as string)
  if (!ids.length) return null
  const { data: recent } = await db.from('sdr_conversations').select('assigned_to, ended_at')
    .eq('tenant_id', tenantId).eq('status', 'handed_off').in('assigned_to', ids).order('ended_at', { ascending: false }).limit(200)
  const lastAt = new Map<string, string>()
  for (const r of recent ?? []) if (r.assigned_to && !lastAt.has(r.assigned_to as string)) lastAt.set(r.assigned_to as string, String(r.ended_at))
  return [...ids].sort((a, b) => (lastAt.get(a) ?? '').localeCompare(lastAt.get(b) ?? ''))[0]
}

async function handoff(conv: Conv, s: SdrSettings, input: Record<string, unknown>): Promise<{ seller: string | null; booking: string | null }> {
  const db = createAdminClient()
  const a = conv.answers ?? {}
  const resumo = String(input.resumo ?? '').slice(0, 2000)
  const qualificado = input.qualificado === true
  const temperatura = typeof input.temperatura === 'string' ? input.temperatura : ''
  const sellerId = await pickSeller(conv.tenant_id, s)
  const tail = last8(conv.phone)
  const str = (k: string) => (typeof a[k] === 'string' ? (a[k] as string) : null)
  const name = str('nome') || conv.contact_name || conv.phone
  const now = nowIso()

  // Lead aberto com o mesmo telefone: atualiza; senão cria (inbound, origem WhatsApp)
  const { data: existing } = await db.from('leads').select('id, email, company_name, cnpj')
    .eq('tenant_id', conv.tenant_id).ilike('phone', `%${tail}`).not('status', 'in', '(convertido,descartado)')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  let leadId = existing?.id as string | undefined
  if (!leadId) {
    const r = await ingestLead({
      tenantId: conv.tenant_id, name, email: str('email'), phone: conv.phone, company_name: str('empresa'), cnpj: str('cnpj'),
      message: resumo || null, source: 'whatsapp', tracking: {}, conversion: 'SDR de IA',
      entryType: 'inbound', assignedTo: sellerId,
    })
    if (r.error) throw new Error(`Lead: ${r.error}`)
    leadId = r.leadId
  } else {
    await db.from('leads').update({
      ...(!existing?.email && str('email') ? { email: str('email') } : {}),
      ...(!existing?.company_name && str('empresa') ? { company_name: str('empresa') } : {}),
      ...(!existing?.cnpj && str('cnpj') ? { cnpj: str('cnpj') } : {}),
      ...(sellerId ? { assigned_to: sellerId } : {}),
      updated_at: now,
    }).eq('id', leadId).eq('tenant_id', conv.tenant_id)
    if (sellerId) await db.from('notifications').insert({ user_id: sellerId, message: `Lead passado pelo SDR de IA: ${name}.` })
  }
  if (leadId) {
    await db.from('leads').update({ handed_off_at: now, status: qualificado ? 'qualificado' : 'em_qualificacao' })
      .eq('id', leadId).eq('tenant_id', conv.tenant_id)
    await db.from('lead_activities').insert({
      lead_id: leadId, type: 'system',
      content: `🤖 SDR de IA passou ao comercial${temperatura ? ` (${temperatura})` : ''}${qualificado ? ' · qualificado' : ''}\n${resumo}${answersText(a) ? `\n\n${answersText(a)}` : ''}`.slice(0, 4000),
    })
    await db.from('contract_whatsapp_messages').update({ lead_id: leadId })
      .eq('tenant_id', conv.tenant_id).eq('phone', conv.phone).is('contract_id', null)
  }
  if (sellerId) {
    await db.from('whatsapp_conversation_assignments').upsert({
      phone: conv.phone, instance_name: conv.instance_name, tenant_id: conv.tenant_id, assigned_to: sellerId, assigned_at: now,
    }, { onConflict: 'tenant_id,phone' })
  }
  await endConversation({ ...conv, lead_id: leadId ?? null }, 'handed_off', {
    summary: resumo, lead_id: leadId ?? null, assigned_to: sellerId,
    end_reason: typeof input.motivo === 'string' ? input.motivo.slice(0, 300) : (qualificado ? 'Qualificado' : 'Passado ao comercial'),
  })

  let sellerName: string | null = null
  if (sellerId) {
    const { data: p } = await db.from('profiles').select('full_name').eq('id', sellerId).maybeSingle()
    sellerName = (p?.full_name as string | null)?.split(' ')[0] ?? null
  }
  return { seller: sellerName, booking: bookingLinkFor(s, sellerId) }
}

// Mensagem padrão ao passar para o comercial (usada se a IA não escrever a dela)
export function handoffClosing(seller: string | null, booking: string | null): string {
  return `Perfeito, obrigado pelas informações! Vou passar seu atendimento para ${seller ?? 'um consultor do nosso time comercial'}, que continua com você por aqui.${booking ? `\n\nSe preferir, já escolha um horário para conversarem: ${booking}` : ''}`
}

/** Pessoa do time assume pela tela do SDR. */
export async function takeOverConversation(tenantId: string, conversationId: string): Promise<boolean> {
  const db = createAdminClient()
  const { data } = await db.from('sdr_conversations').select('*').eq('id', conversationId).eq('tenant_id', tenantId).maybeSingle()
  if (!data || data.status !== 'active') return false
  await endConversation(data as Conv, 'routed', { end_reason: 'Assumida pelo time na tela do SDR.' })
  return true
}
