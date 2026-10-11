// /api/agent/nps-answered
// Chamado pelo Supabase Database Webhook quando um NPS é respondido:
//   Tabela: contract_crm.nps_surveys
//   Evento: UPDATE (quando status muda para 'answered')
//
// Configuração no Supabase Dashboard:
//   Table: contract_crm.nps_surveys
//   Events: UPDATE
//   URL: https://<seu-dominio>/api/agent/nps-answered
//   HTTP Headers: { "x-webhook-secret": "<WEBHOOK_SECRET>" }
//
// Lógica de score NPS:
//   0–6  → Detrator  → escalada urgente (alerta interno + atividade prioritária)
//   7–8  → Neutro    → follow-up de melhoria
//   9–10 → Promotor  → agradecimento + pergunta de upsell
//
// Canais:
//   - Atividade no CRM vinculada ao contrato
//   - WhatsApp interno (instância "retenção") para o responsável (se detrator)

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendEvolutionWhatsApp, createCrmActivity } from '@/lib/agent/notifications'

export const maxDuration = 30

// ─── Cliente Supabase ─────────────────────────────────────────────────────────

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

type NpsRecord = {
  id:               string
  contract_id:      string
  token:            string
  score:            number | null
  comment:          string | null
  respondent_name:  string | null
  respondent_email: string | null
  respondent_phone: string | null
  status:           string
  sent_at:          string | null
  answered_at:      string | null
  created_by:       string | null
}

type SupabaseWebhookPayload = {
  type:       'INSERT' | 'UPDATE' | 'DELETE'
  table:      string
  schema:     string
  record:     NpsRecord
  old_record: NpsRecord | null
}

// ─── Handler principal ────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Valida secret
  const secret         = process.env.WEBHOOK_SECRET
  const incomingSecret = req.headers.get('x-webhook-secret') ?? ''

  if (secret && incomingSecret !== secret) {
    console.warn('[nps-answered] secret inválido')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Parse payload
  let payload: SupabaseWebhookPayload
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  // Só processa UPDATEs em nps_surveys onde status passou para 'answered'
  const survey    = payload.record
  const oldSurvey = payload.old_record

  if (
    payload.type !== 'UPDATE' ||
    payload.table !== 'nps_surveys' ||
    survey.status !== 'answered' ||
    oldSurvey?.status === 'answered'  // já era answered — ignora
  ) {
    return NextResponse.json({ ok: true, skipped: true })
  }

  const score = survey.score
  if (score === null || score === undefined) {
    console.warn(`[nps-answered] survey ${survey.id} sem score — ignorando`)
    return NextResponse.json({ ok: true, skipped: true, reason: 'sem score' })
  }

  console.log(
    `[nps-answered] survey ${survey.id} | contrato ${survey.contract_id} ` +
    `| score=${score} | respondente="${survey.respondent_name ?? 'anônimo'}"`
  )

  // 3. Classifica e processa
  const category = score <= 6 ? 'detrator' : score <= 8 ? 'neutro' : 'promotor'
  console.log(`[nps-answered] categoria: ${category}`)

  // 4. Busca dados do contrato para contexto
  const supabase    = getAdminClient()
  const contractCtx = await fetchContractContext(supabase, survey.contract_id)

  // 5. Cria atividade no CRM
  const activityContent = buildCrmActivityContent(survey, score, category, contractCtx)
  const dueInDays       = category === 'detrator' ? 1 : category === 'neutro' ? 3 : 7

  const crmResult = await createCrmActivity({
    contractId: survey.contract_id,
    type:       'task',
    content:    activityContent,
    dueInDays,
    metadata:   {
      nps_survey_id: survey.id,
      nps_score:     score,
      nps_category:  category,
      respondent:    survey.respondent_name ?? null,
    },
  })

  // 6. Se DETRATOR — alerta interno via WhatsApp (instância retenção)
  let waResult: { sent: boolean; error?: string } = { sent: false, error: 'WhatsApp só para detratores' }

  if (category === 'detrator') {
    const internalNumber = process.env.AGENT_INTERNAL_WHATSAPP ?? process.env.WHATSAPP_NUMBER
    if (internalNumber) {
      const waMsg = buildDetractorWhatsAppAlert(survey, score, contractCtx)
      waResult    = await sendEvolutionWhatsApp('retencao', internalNumber, waMsg)

      if (waResult.sent) {
        console.log(`[nps-answered] ✓ alerta detrator enviado via WhatsApp`)
      } else {
        console.error(`[nps-answered] WhatsApp falhou: ${waResult.error}`)
      }
    } else {
      console.warn('[nps-answered] AGENT_INTERNAL_WHATSAPP não configurado')
    }
  }

  return NextResponse.json({
    ok:           true,
    survey_id:    survey.id,
    contract_id:  survey.contract_id,
    score,
    category,
    crm_activity: crmResult.ok,
    whatsapp_ok:  waResult.sent,
  })
}

// ─── Contexto do contrato ─────────────────────────────────────────────────────

type ContractContext = {
  process_number: string
  client_name:    string
}

async function fetchContractContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  contractId: string,
): Promise<ContractContext> {
  const { data, error } = await supabase
    .from('contracts')
    .select('process_number, client_name')
    .eq('id', contractId)
    .single()

  if (error || !data) {
    console.warn(`[nps-answered] não encontrou contrato ${contractId}: ${error?.message}`)
    return { process_number: contractId.slice(0, 8), client_name: 'cliente' }
  }

  return { process_number: data.process_number, client_name: data.client_name }
}

// ─── Conteúdo da atividade no CRM ────────────────────────────────────────────

function buildCrmActivityContent(
  survey:      NpsRecord,
  score:       number,
  category:    string,
  contract:    ContractContext,
): string {
  const emoji =
    category === 'detrator' ? '🔴' :
    category === 'neutro'   ? '🟡' : '🟢'

  const acao =
    category === 'detrator'
      ? 'Ligar HOJE para entender a insatisfação e elaborar plano de recuperação. Registrar principais reclamações.'
      : category === 'neutro'
      ? 'Agendar call de follow-up para entender pontos de melhoria e aumentar engajamento.'
      : 'Enviar mensagem de agradecimento. Perguntar se tem interesse em indicar a Orbis ou expandir o serviço.'

  let content =
    `${emoji} [COPILOTO] NPS respondido — Score ${score}/10 (${category.toUpperCase()})\n\n` +
    `Cliente: ${contract.client_name} | Processo: ${contract.process_number}\n` +
    `Respondente: ${survey.respondent_name ?? 'não informado'}\n`

  if (survey.respondent_phone) content += `Telefone: ${survey.respondent_phone}\n`
  if (survey.respondent_email) content += `E-mail: ${survey.respondent_email}\n`

  if (survey.comment) {
    content += `\n💬 Comentário do cliente:\n"${survey.comment}"\n`
  }

  content += `\n✅ PRÓXIMA AÇÃO: ${acao}`

  return content
}

// ─── Alerta WhatsApp para detratores ─────────────────────────────────────────

function buildDetractorWhatsAppAlert(
  survey:   NpsRecord,
  score:    number,
  contract: ContractContext,
): string {
  let msg =
    `🚨 *ALERTA NPS — CLIENTE INSATISFEITO*\n\n` +
    `Score: *${score}/10* (Detrator)\n` +
    `Cliente: *${contract.client_name}*\n` +
    `Processo: ${contract.process_number}\n`

  if (survey.respondent_name)  msg += `Contato: ${survey.respondent_name}\n`
  if (survey.respondent_phone) msg += `Telefone: *${survey.respondent_phone}*\n`

  if (survey.comment) {
    const snippet = survey.comment.length > 200 ? survey.comment.slice(0, 200) + '…' : survey.comment
    msg += `\n💬 Comentário:\n_"${snippet}"_\n`
  }

  msg += `\n⚡ *Atividade aberta no CRM — LIGAR HOJE!*`

  return msg
}
