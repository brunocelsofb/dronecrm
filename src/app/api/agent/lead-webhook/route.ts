// /api/agent/lead-webhook
// Chamado pelo Supabase Database Webhook quando um novo lead é inserido
// na tabela contract_crm.leads (evento: INSERT).
//
// Configuração no Supabase Dashboard:
//   Table: contract_crm.leads
//   Events: INSERT
//   URL: https://<seu-dominio>/api/agent/lead-webhook
//   HTTP Headers: { "x-webhook-secret": "<WEBHOOK_SECRET>" }
//
// O que este handler faz:
//   1. Valida o secret do webhook
//   2. Extrai dados do novo lead
//   3. Cria lead_activity no CRM ("Sistema: novo lead recebido via formulário")
//   4. Envia mensagem no WhatsApp (instância "novos negócios")
//      para o grupo Dream Team Comercial
//
// Variáveis de ambiente necessárias:
//   WEBHOOK_SECRET                   — segredo para validar chamadas do Supabase
//   EVOLUTION_API_URL                — URL base da Evolution API
//   EVOLUTION_API_KEY                — chave da Evolution API
//   EVOLUTION_INSTANCE_NOVOS         — instância "novos negócios"
//   DREAM_TEAM_GROUP_JID             — JID do grupo Dream Team Comercial
//                                       ex.: 5511999999999-1234567890@g.us
//                                       Obtenha via GET /group/fetchAllGroups/{instance}

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendEvolutionWhatsAppGroup } from '@/lib/agent/notifications'
import { sendWhatsApp } from '@/lib/agent/briefing-core'
import { getDefaultTenantId } from '@/lib/tenant/context'

export const maxDuration = 30

// ─── Cliente Supabase com service role ───────────────────────────────────────

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      db:   { schema: 'contract_crm' },
    }
  )
}

// ─── Tipo do payload Supabase Webhook ─────────────────────────────────────────

type SupabaseWebhookPayload = {
  type:   'INSERT' | 'UPDATE' | 'DELETE'
  table:  string
  schema: string
  record: {
    id:           string
    name:         string
    email:        string | null
    phone:        string | null
    company_name: string | null
    cnpj:         string | null
    message:      string | null
    source:       string | null
    status:       string
    score:        number
    created_at:   string
  }
  old_record: unknown
}

// ─── Handler principal ────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Valida secret do webhook
  const secret        = process.env.WEBHOOK_SECRET
  const incomingSecret = req.headers.get('x-webhook-secret') ?? ''

  if (secret && incomingSecret !== secret) {
    console.warn('[lead-webhook] secret inválido')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Parse do payload
  let payload: SupabaseWebhookPayload
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  // Só processa INSERTs na tabela leads
  if (payload.type !== 'INSERT' || payload.table !== 'leads') {
    return NextResponse.json({ ok: true, skipped: true })
  }

  const lead = payload.record
  console.log(`[lead-webhook] novo lead: "${lead.name}" (${lead.id}) via ${lead.source ?? 'desconhecido'}`)

  const supabase = getAdminClient()

  // 3. Cria lead_activity no CRM (usa service role para bypassar RLS)
  const activityContent =
    `[Hunter] Novo lead recebido via formulário.\n` +
    `Nome: ${lead.name}\n` +
    (lead.email        ? `E-mail: ${lead.email}\n`           : '') +
    (lead.phone        ? `Telefone: ${lead.phone}\n`         : '') +
    (lead.company_name ? `Empresa: ${lead.company_name}\n`   : '') +
    (lead.message      ? `Mensagem: "${lead.message}"\n`     : '') +
    `Fonte: ${lead.source ?? 'formulário'} | Score: ${lead.score}`

  const { error: activityError } = await supabase
    .from('lead_activities')
    .insert({
      lead_id: lead.id,
      type:    'system',
      content: activityContent,
    })

  if (activityError) {
    console.error(`[lead-webhook] erro ao criar lead_activity: ${activityError.message}`)
  } else {
    console.log(`[lead-webhook] ✓ lead_activity criada`)
  }

  // 4. Monta e envia mensagem no WhatsApp do grupo comercial.
  // O grupo e a instância das variáveis do servidor são da empresa padrão: lead de
  // outra empresa NUNCA vai para esse grupo — vai para o gestor da própria empresa.
  const leadTenant = (payload.record as { tenant_id?: string | null }).tenant_id ?? null
  const defaultTenant = await getDefaultTenantId()
  if (leadTenant && leadTenant !== defaultTenant) {
    const r = await sendWhatsApp(buildLeadNotificationMessage(lead), leadTenant)
    return NextResponse.json({ ok: true, activity: !activityError, whatsapp: r.sent, whatsappError: r.sent ? undefined : r.error })
  }
  const groupJid = process.env.DREAM_TEAM_GROUP_JID

  let waResult: { sent: boolean; error?: string } = { sent: false, error: 'DREAM_TEAM_GROUP_JID não configurado' }

  if (groupJid) {
    const waMessage = buildLeadNotificationMessage(lead)
    waResult = await sendEvolutionWhatsAppGroup('novos', groupJid, waMessage)

    if (waResult.sent) {
      console.log(`[lead-webhook] ✓ WhatsApp enviado ao Dream Team`)
    } else {
      console.error(`[lead-webhook] WhatsApp falhou: ${waResult.error}`)
    }
  } else {
    console.warn('[lead-webhook] DREAM_TEAM_GROUP_JID não configurado — WhatsApp ignorado')
  }

  return NextResponse.json({
    ok:           true,
    lead_id:      lead.id,
    activity_ok:  !activityError,
    whatsapp_ok:  waResult.sent,
    whatsapp_err: waResult.sent ? undefined : waResult.error,
  })
}

// ─── Monta a mensagem do WhatsApp ─────────────────────────────────────────────

function buildLeadNotificationMessage(lead: SupabaseWebhookPayload['record']): string {
  const hora = new Date(lead.created_at).toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour:     '2-digit',
    minute:   '2-digit',
  })
  const data = new Date(lead.created_at).toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day:      '2-digit',
    month:    '2-digit',
  })

  let msg = `🔔 *NOVO LEAD RECEBIDO*\n`
  msg    += `📅 ${data} às ${hora}\n\n`

  msg += `👤 *Nome:* ${lead.name}\n`
  if (lead.company_name) msg += `🏢 *Empresa:* ${lead.company_name}\n`
  if (lead.phone)        msg += `📱 *Telefone:* ${lead.phone}\n`
  if (lead.email)        msg += `📧 *E-mail:* ${lead.email}\n`
  if (lead.message) {
    const snippet = lead.message.length > 200 ? lead.message.slice(0, 200) + '…' : lead.message
    msg += `\n💬 *Mensagem:*\n_${snippet}_\n`
  }

  msg += `\n📊 Score inicial: *${lead.score}* | Fonte: ${lead.source ?? 'formulário'}`
  msg += `\n\n⚡ _Atividade aberta no CRM — entre em contato hoje!_`

  return msg
}
