// ─── Módulo de notificações multi-canal ──────────────────────────────────────
// Centraliza envio via WhatsApp (Evolution API) e e-mail (Gmail OAuth)
// para os alertas do agente: vencimento de contrato, lead, NPS.
//
// Instâncias Evolution API configuradas via env vars:
//   EVOLUTION_API_URL           — ex.: https://evo.orbisengenharia.com.br
//   EVOLUTION_API_KEY           — chave global da API
//   EVOLUTION_INSTANCE_NOVOS    — instância "novos negócios" (leads, prospecção)
//   EVOLUTION_INSTANCE_RETENCAO — instância "retenção" (contratos, NPS)
//
// E-mail via Gmail OAuth (já integrado em src/lib/email/gmail.ts)
//   AGENT_FROM_EMAIL            — ex.: comercial@orbisengenharia.com.br
//   AGENT_ALERT_EMAIL           — ex.: bruno.barbosa@orbisengenharia.com.br

import { getValidAccessToken, sendGmailMessage } from '@/lib/email/gmail'
import { sendSmtpMessage } from '@/lib/email/smtp'
import { createClient } from '@supabase/supabase-js'

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type WhatsAppSendResult = {
  sent: boolean
  statusCode?: number
  error?: string
}

export type EmailSendResult = {
  sent: boolean
  messageId?: string
  error?: string
}

export type NotificationResult = {
  whatsapp: WhatsAppSendResult
  email: EmailSendResult
}

// ─── Cliente Supabase (schema contract_crm) ───────────────────────────────────

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

// ─── WhatsApp via Evolution API ───────────────────────────────────────────────

type WaInstance = 'novos' | 'retencao'

export async function sendEvolutionWhatsApp(
  instance: WaInstance,
  number: string,
  text: string,
): Promise<WhatsAppSendResult> {
  const baseUrl = process.env.EVOLUTION_API_URL
  const apiKey  = process.env.EVOLUTION_API_KEY

  const instanceName =
    instance === 'novos'
      ? process.env.EVOLUTION_INSTANCE_NOVOS
      : process.env.EVOLUTION_INSTANCE_RETENCAO

  if (!baseUrl || !apiKey || !instanceName) {
    const missing = [
      !baseUrl       && 'EVOLUTION_API_URL',
      !apiKey        && 'EVOLUTION_API_KEY',
      !instanceName  && (instance === 'novos' ? 'EVOLUTION_INSTANCE_NOVOS' : 'EVOLUTION_INSTANCE_RETENCAO'),
    ].filter(Boolean).join(', ')
    console.error(`[notifications/wa] variáveis em falta: ${missing}`)
    return { sent: false, error: `Variáveis em falta: ${missing}` }
  }

  const cleanNumber = number.replace(/\D/g, '')
  const url = `${baseUrl.replace(/\/$/, '')}/message/sendText/${instanceName}`

  console.log(`[notifications/wa] instância="${instanceName}" → ${cleanNumber.slice(0, 4)}****`)

  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': apiKey },
      body: JSON.stringify({
        number:  cleanNumber,
        text,
        options: { delay: 1200, presence: 'composing' },
      }),
    })

    const body = await res.json().catch(() => ({}))

    if (!res.ok) {
      const detail = body?.message ?? body?.error ?? body?.response?.message ?? res.statusText
      console.error(`[notifications/wa] Evolution API ${res.status}: ${detail}`)
      return { sent: false, error: `Evolution API ${res.status}: ${detail}` }
    }

    console.log(`[notifications/wa] ✓ messageId=${body?.key?.id ?? body?.id ?? '(sem id)'}`)
    return { sent: true, statusCode: res.status }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[notifications/wa] erro de rede: ${msg}`)
    return { sent: false, error: `Erro de rede: ${msg}` }
  }
}

// Envia para um grupo — requer o ID/JID do grupo (formato: 1234567890-1234567890@g.us)
// O número do grupo pode ser obtido via Evolution API GET /group/fetchAllGroups/{instance}
export async function sendEvolutionWhatsAppGroup(
  instance: WaInstance,
  groupJid: string,
  text: string,
): Promise<WhatsAppSendResult> {
  const baseUrl = process.env.EVOLUTION_API_URL
  const apiKey  = process.env.EVOLUTION_API_KEY

  const instanceName =
    instance === 'novos'
      ? process.env.EVOLUTION_INSTANCE_NOVOS
      : process.env.EVOLUTION_INSTANCE_RETENCAO

  if (!baseUrl || !apiKey || !instanceName) {
    return { sent: false, error: 'Variáveis de ambiente Evolution API em falta' }
  }

  const url = `${baseUrl.replace(/\/$/, '')}/message/sendText/${instanceName}`

  console.log(`[notifications/wa-group] instância="${instanceName}" → grupo ${groupJid.slice(0, 8)}****`)

  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': apiKey },
      body: JSON.stringify({
        number:  groupJid,
        text,
        options: { delay: 1200, presence: 'composing' },
      }),
    })

    const body = await res.json().catch(() => ({}))

    if (!res.ok) {
      const detail = body?.message ?? body?.error ?? body?.response?.message ?? res.statusText
      console.error(`[notifications/wa-group] Evolution API ${res.status}: ${detail}`)
      return { sent: false, error: `Evolution API ${res.status}: ${detail}` }
    }

    console.log(`[notifications/wa-group] ✓ messageId=${body?.key?.id ?? body?.id ?? '(sem id)'}`)
    return { sent: true, statusCode: res.status }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { sent: false, error: `Erro de rede: ${msg}` }
  }
}

// ─── E-mail via Gmail OAuth ou SMTP ──────────────────────────────────────────
//
// Estratégia (em ordem de prioridade):
//   1. Gmail OAuth: usa AGENT_USER_ID para buscar o token OAuth armazenado no Supabase
//   2. SMTP: usa as variáveis SMTP_HOST / SMTP_USER / SMTP_PASS (fallback)
//
// Variáveis de ambiente necessárias:
//   AGENT_USER_ID    — UUID do usuário Supabase dono da conta Gmail conectada
//                      (ex.: UUID do Bruno em contract_crm.profiles)
//   -- OU --
//   SMTP_HOST        — servidor SMTP (ex.: smtp.gmail.com)
//   SMTP_PORT        — porta SMTP (ex.: 587)
//   SMTP_USER        — e-mail remetente
//   SMTP_PASS        — senha de app do Gmail ou senha SMTP
//   SMTP_SECURE      — 'true' para SSL/TLS direto (porta 465)

export async function sendAgentEmail(opts: {
  to: string
  subject: string
  htmlBody: string
  fromEmail?: string
}): Promise<EmailSendResult> {
  // Tenta Gmail OAuth primeiro
  const agentUserId = process.env.AGENT_USER_ID
  if (agentUserId) {
    try {
      const oauthAccount = await getValidAccessToken(agentUserId)
      if (oauthAccount) {
        const result = await sendGmailMessage({
          accessToken: oauthAccount.accessToken,
          to:          opts.to,
          subject:     opts.subject,
          htmlBody:    opts.htmlBody,
        })
        console.log(`[notifications/email] ✓ Gmail OAuth messageId=${result.messageId}`)
        return { sent: true, messageId: result.messageId }
      }
      console.warn('[notifications/email] Gmail OAuth: conta não encontrada para AGENT_USER_ID')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[notifications/email] Gmail OAuth falhou, tentando SMTP: ${msg}`)
    }
  }

  // Fallback: SMTP
  const smtpHost   = process.env.SMTP_HOST
  const smtpUser   = process.env.SMTP_USER
  const smtpPass   = process.env.SMTP_PASS
  const smtpPort   = parseInt(process.env.SMTP_PORT ?? '587', 10)
  const smtpSecure = process.env.SMTP_SECURE === 'true'
  const fromEmail  = opts.fromEmail ?? smtpUser ?? process.env.AGENT_FROM_EMAIL ?? 'copiloto@orbisengenharia.com.br'

  if (!smtpHost || !smtpUser || !smtpPass) {
    const missing = [!smtpHost && 'SMTP_HOST', !smtpUser && 'SMTP_USER', !smtpPass && 'SMTP_PASS'].filter(Boolean).join(', ')
    console.error(`[notifications/email] sem Gmail OAuth nem SMTP configurado. Faltam: ${missing}`)
    return { sent: false, error: `E-mail não configurado (faltam: ${missing})` }
  }

  try {
    const result = await sendSmtpMessage({
      config:    { host: smtpHost, port: smtpPort, username: smtpUser, password: smtpPass, secure: smtpSecure },
      fromEmail,
      to:        opts.to,
      subject:   opts.subject,
      htmlBody:  opts.htmlBody,
    })
    console.log(`[notifications/email] ✓ SMTP messageId=${result.messageId}`)
    return { sent: true, messageId: result.messageId }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[notifications/email] SMTP erro: ${msg}`)
    return { sent: false, error: msg }
  }
}

// ─── Atividade no CRM ─────────────────────────────────────────────────────────

export async function createCrmActivity(opts: {
  contractId?: string
  leadId?: string
  type?: string          // 'task' | 'note' | 'system'
  content: string
  dueInDays?: number
  metadata?: Record<string, unknown>
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = getAdminClient()
  const dueDate  = new Date()
  dueDate.setDate(dueDate.getDate() + (opts.dueInDays ?? 2))

  const row: Record<string, unknown> = {
    type:     opts.type ?? 'task',
    content:  opts.content,
    due_date: opts.dueInDays !== undefined ? dueDate.toISOString() : null,
    completed: false,
    metadata: {
      source:       'copiloto_ia',
      auto_created: true,
      ...(opts.metadata ?? {}),
    },
  }

  if (opts.contractId) row.contract_id = opts.contractId
  if (opts.leadId)     row.lead_id     = opts.leadId

  const { error } = await supabase.from('activities').insert(row)
  if (error) {
    console.error(`[notifications/crm] erro ao criar atividade: ${error.message}`)
    return { ok: false, error: error.message }
  }

  console.log(`[notifications/crm] ✓ atividade criada (contract=${opts.contractId ?? '-'} lead=${opts.leadId ?? '-'})`)
  return { ok: true }
}

// ─── Utilitário: formata moeda BRL ────────────────────────────────────────────

export function formatBRL(value: number | null | undefined): string {
  if (value == null) return 'valor não informado'
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

// ─── Utilitário: formata data BR ──────────────────────────────────────────────

export function formatDateBR(isoDate: string | null | undefined): string {
  if (!isoDate) return 'data não informada'
  const d = new Date(isoDate)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
