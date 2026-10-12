// ─── Alertas de vencimento de contratos ──────────────────────────────────────
// Executado diariamente pelo CRON /api/agent/expiration-alerts
//
// Lógica:
//   90 dias → aviso antecipado interno (time)
//   60 dias → primeira notificação ao cliente
//   30 dias → segunda notificação ao cliente (urgência moderada)
//   15 dias → alerta crítico ao cliente + escalada interna
//    0 dias ou já vencido → alerta de inadimplência/renovação urgente
//
// Canais:
//   - Interno: WhatsApp (instância "retenção") para o número do responsável
//              + atividade no CRM
//   - Cliente: WhatsApp (instância "retenção") para o contato do contrato
//              + e-mail para bruno.barbosa@orbisengenharia.com.br
//              + atividade no CRM registrando o envio

import { createClient } from '@supabase/supabase-js'
import {
  sendEvolutionWhatsApp,
  sendAgentEmail,
  createCrmActivity,
  formatBRL,
  formatDateBR,
} from './notifications'

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

// ─── Tipos ────────────────────────────────────────────────────────────────────

type ExpiringContract = {
  id: string
  process_number: string
  client_name: string
  valid_until: string
  days_until_expiry: number
  monthly_value: number | null
  contact_phone: string | null
  contact_email: string | null
  owner_phone: string | null
  owner_name: string | null
  stage_name: string | null
}

type AlertLevel = 90 | 60 | 30 | 15 | 0

type AlertResult = {
  contractId: string
  processNumber: string
  clientName: string
  daysUntilExpiry: number
  alertLevel: AlertLevel
  whatsappClient: { sent: boolean; error?: string }
  emailInternal: { sent: boolean; error?: string }
  crmActivity: { ok: boolean; error?: string }
}

// ─── Busca contratos por janela de vencimento ─────────────────────────────────

async function fetchContractsExpiringInDays(targetDays: number): Promise<ExpiringContract[]> {
  const supabase = getAdminClient()

  // Calcula o range do dia alvo: [targetDate 00:00, targetDate 23:59]
  const targetDate = new Date()
  targetDate.setDate(targetDate.getDate() + targetDays)
  const dateStr = targetDate.toISOString().split('T')[0]

  const { data, error } = await supabase
    .from('contracts')
    .select(`
      id,
      process_number,
      client_name,
      valid_until,
      monthly_value,
      contacts!left (
        phone,
        email
      ),
      pipeline_runs!left (
        stages!left ( name ),
        companies!left (
          users!left ( phone, full_name )
        )
      )
    `)
    .gte('valid_until', `${dateStr}T00:00:00.000Z`)
    .lte('valid_until', `${dateStr}T23:59:59.999Z`)

  if (error) {
    console.error(`[expiration] erro ao buscar contratos vencendo em ${targetDays}d: ${error.message}`)
    return []
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((c: any) => {
    const contact = Array.isArray(c.contacts) ? c.contacts[0] : c.contacts
    const run     = Array.isArray(c.pipeline_runs) ? c.pipeline_runs[0] : c.pipeline_runs
    const stage   = run ? (Array.isArray(run.stages) ? run.stages[0] : run.stages) : null
    const company = run ? (Array.isArray(run.companies) ? run.companies[0] : run.companies) : null
    const owner   = company ? (Array.isArray(company.users) ? company.users[0] : company.users) : null

    const expiry   = new Date(c.valid_until)
    const today    = new Date()
    today.setHours(0, 0, 0, 0)
    const diffMs   = expiry.getTime() - today.getTime()
    const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24))

    return {
      id:               c.id,
      process_number:   c.process_number,
      client_name:      c.client_name,
      valid_until:      c.valid_until,
      days_until_expiry: daysLeft,
      monthly_value:    c.monthly_value ?? null,
      contact_phone:    (contact as { phone?: string } | null)?.phone ?? null,
      contact_email:    (contact as { email?: string } | null)?.email ?? null,
      owner_phone:      (owner as { phone?: string } | null)?.phone ?? null,
      owner_name:       (owner as { full_name?: string } | null)?.full_name ?? null,
      stage_name:       (stage as { name?: string } | null)?.name ?? null,
    } as ExpiringContract
  })
}

// Busca contratos já vencidos (valid_until < hoje) que ainda estão ativos
async function fetchExpiredContracts(): Promise<ExpiringContract[]> {
  const supabase = getAdminClient()
  const today    = new Date().toISOString().split('T')[0]

  const { data, error } = await supabase
    .from('contracts')
    .select(`
      id,
      process_number,
      client_name,
      valid_until,
      monthly_value,
      contacts!left ( phone, email ),
      pipeline_runs!left (
        stages!left ( name ),
        companies!left (
          users!left ( phone, full_name )
        )
      )
    `)
    .lt('valid_until', `${today}T00:00:00.000Z`)

  if (error) {
    console.error(`[expiration] erro ao buscar contratos vencidos: ${error.message}`)
    return []
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((c: any) => {
    const contact = Array.isArray(c.contacts) ? c.contacts[0] : c.contacts
    const run     = Array.isArray(c.pipeline_runs) ? c.pipeline_runs[0] : c.pipeline_runs
    const stage   = run ? (Array.isArray(run.stages) ? run.stages[0] : run.stages) : null
    const company = run ? (Array.isArray(run.companies) ? run.companies[0] : run.companies) : null
    const owner   = company ? (Array.isArray(company.users) ? company.users[0] : company.users) : null

    const expiry   = new Date(c.valid_until)
    const today2   = new Date()
    today2.setHours(0, 0, 0, 0)
    const diffMs   = expiry.getTime() - today2.getTime()
    const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24)) // negativo = já venceu

    return {
      id:               c.id,
      process_number:   c.process_number,
      client_name:      c.client_name,
      valid_until:      c.valid_until,
      days_until_expiry: daysLeft,
      monthly_value:    c.monthly_value ?? null,
      contact_phone:    (contact as { phone?: string } | null)?.phone ?? null,
      contact_email:    (contact as { email?: string } | null)?.email ?? null,
      owner_phone:      (owner as { phone?: string } | null)?.phone ?? null,
      owner_name:       (owner as { full_name?: string } | null)?.full_name ?? null,
      stage_name:       (stage as { name?: string } | null)?.name ?? null,
    } as ExpiringContract
  })
}

// ─── Geração de mensagens ─────────────────────────────────────────────────────

function buildClientWhatsAppMessage(contract: ExpiringContract, alertLevel: AlertLevel): string {
  const dataVenc  = formatDateBR(contract.valid_until)
  const valor     = formatBRL(contract.monthly_value)
  const num       = contract.process_number

  if (alertLevel === 0 || alertLevel < 0) {
    return (
      `⚠️ *CONTRATO VENCIDO — AÇÃO URGENTE* ⚠️\n\n` +
      `Prezado(a) *${contract.client_name}*,\n\n` +
      `Identificamos que o contrato *${num}*, com vigência até *${dataVenc}*, encontra-se expirado.\n\n` +
      `O valor de referência do contrato é de *${valor}*.\n\n` +
      `Para evitar interrupção dos serviços e regularização da situação contratual, ` +
      `solicitamos que entre em contato com nossa equipe *com urgência*.\n\n` +
      `📞 Equipe Comercial — Orbis Engenharia`
    )
  }

  const urgencia =
    alertLevel === 15
      ? '⚠️ *AVISO URGENTE*'
      : alertLevel === 30
      ? '📋 *Aviso de Vencimento*'
      : '📌 *Lembrete Contratual*'

  const diasTexto =
    alertLevel === 15
      ? `apenas *${contract.days_until_expiry} dias*`
      : `*${contract.days_until_expiry} dias*`

  return (
    `${urgencia}\n\n` +
    `Prezado(a) *${contract.client_name}*,\n\n` +
    `Informamos que o contrato *${num}* vencerá em ${diasTexto}, em *${dataVenc}*.\n\n` +
    `📄 Valor de referência: *${valor}*\n\n` +
    (alertLevel <= 30
      ? `Para garantir a continuidade dos serviços, recomendamos iniciar o processo de renovação com antecedência.\n\n`
      : `Nossa equipe estará à disposição para tratar da renovação no momento oportuno.\n\n`) +
    `Em caso de dúvidas, entre em contato com nossa equipe comercial.\n\n` +
    `📞 Orbis Engenharia — Equipe Comercial`
  )
}

function buildInternalWhatsAppMessage(contract: ExpiringContract, alertLevel: AlertLevel): string {
  const emoji     = alertLevel <= 15 ? '🚨' : alertLevel <= 30 ? '⚠️' : '📋'
  const dataVenc  = formatDateBR(contract.valid_until)
  const valor     = formatBRL(contract.monthly_value)
  const dias      = alertLevel === 0 ? 'VENCIDO' : `${contract.days_until_expiry}d`

  return (
    `${emoji} *[COPILOTO] Contrato vencendo em ${dias}*\n\n` +
    `Cliente: *${contract.client_name}*\n` +
    `Processo: ${contract.process_number}\n` +
    `Vencimento: ${dataVenc}\n` +
    `Valor: ${valor}\n` +
    (contract.stage_name ? `Etapa: ${contract.stage_name}\n` : '') +
    `\n` +
    (alertLevel <= 15
      ? `⚠️ *Ação urgente necessária!* Entre em contato com o cliente hoje.`
      : alertLevel <= 30
      ? `Iniciar processo de renovação — verificar intenção do cliente.`
      : `Monitorar — agendar contato nos próximos dias.`)
  )
}

function buildClientEmailHtml(contract: ExpiringContract, alertLevel: AlertLevel): string {
  const dataVenc = formatDateBR(contract.valid_until)
  const valor    = formatBRL(contract.monthly_value)
  const dias     = contract.days_until_expiry
  const isExpired = alertLevel === 0 || dias < 0

  const headerColor = isExpired ? '#dc2626' : alertLevel <= 15 ? '#ea580c' : alertLevel <= 30 ? '#d97706' : '#2563eb'
  const headerText  = isExpired ? 'Contrato Expirado — Regularização Urgente'
                    : alertLevel <= 15 ? `Aviso Urgente: ${dias} dias para o vencimento`
                    : alertLevel <= 30 ? `Aviso de Vencimento: ${dias} dias`
                    : `Lembrete Contratual: ${dias} dias para o vencimento`

  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
        <tr><td style="background:${headerColor};padding:24px 32px;">
          <p style="margin:0;color:#fff;font-size:18px;font-weight:bold;">${headerText}</p>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 16px;color:#111;font-size:15px;">Prezado(a) <strong>${contract.client_name}</strong>,</p>
          ${isExpired
            ? `<p style="color:#dc2626;font-weight:bold;margin:0 0 16px;">O seu contrato <strong>${contract.process_number}</strong> com vigência até <strong>${dataVenc}</strong> está <u>expirado</u>.</p>
               <p style="color:#444;margin:0 0 16px;">Para evitar interrupção dos serviços e regularizar a situação contratual, entre em contato com nossa equipe com <strong>urgência</strong>.</p>`
            : `<p style="color:#333;margin:0 0 16px;">O contrato <strong>${contract.process_number}</strong> vencerá em <strong>${dataVenc}</strong> (${dias} dias).</p>
               <p style="color:#444;margin:0 0 16px;">${alertLevel <= 30 ? 'Para garantir a continuidade dos serviços, recomendamos iniciar o processo de renovação com antecedência.' : 'Nossa equipe estará à disposição para tratar da renovação no momento oportuno.'}</p>`
          }
          <table cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;width:100%;margin:0 0 24px;">
            <tr><td style="padding:16px;">
              <p style="margin:0 0 8px;color:#555;font-size:13px;"><strong>📄 Detalhes do contrato</strong></p>
              <p style="margin:0 0 4px;color:#333;font-size:14px;">Número: <strong>${contract.process_number}</strong></p>
              <p style="margin:0 0 4px;color:#333;font-size:14px;">Vencimento: <strong>${dataVenc}</strong></p>
              <p style="margin:0;color:#333;font-size:14px;">Valor de referência: <strong>${valor}</strong></p>
            </td></tr>
          </table>
          <p style="color:#444;margin:0 0 8px;font-size:14px;">Em caso de dúvidas, entre em contato:</p>
          <p style="color:#444;margin:0;font-size:14px;">📧 comercial@orbisengenharia.com.br<br>📞 Equipe Comercial — Orbis Engenharia</p>
        </td></tr>
        <tr><td style="background:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;">
          <p style="margin:0;color:#888;font-size:12px;">Esta mensagem foi gerada automaticamente pelo sistema de gestão de contratos da Orbis Engenharia.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

function buildClientEmailSubject(contract: ExpiringContract, alertLevel: AlertLevel): string {
  const dias = contract.days_until_expiry
  if (alertLevel === 0 || dias < 0) return `[URGENTE] Contrato ${contract.process_number} expirado — regularização necessária`
  if (alertLevel === 15) return `[URGENTE] Contrato ${contract.process_number} vence em ${dias} dias`
  if (alertLevel === 30) return `Aviso: Contrato ${contract.process_number} vence em ${dias} dias`
  return `Lembrete: Contrato ${contract.process_number} vence em ${dias} dias`
}

// ─── Processa um único contrato ───────────────────────────────────────────────

async function processContract(
  contract: ExpiringContract,
  alertLevel: AlertLevel,
): Promise<AlertResult> {
  const alertEmail = process.env.AGENT_ALERT_EMAIL ?? 'bruno.barbosa@orbisengenharia.com.br'

  console.log(
    `[expiration] processando ${contract.process_number} (${contract.client_name}) ` +
    `— alerta ${alertLevel}d | vence em ${contract.days_until_expiry}d`
  )

  // 1. WhatsApp para o RESPONSÁVEL interno (instância retenção)
  const internalNumber = process.env.AGENT_INTERNAL_WHATSAPP ?? process.env.WHATSAPP_NUMBER
  let waInternal: { sent: boolean; error?: string } = { sent: false, error: 'número interno não configurado' }
  if (internalNumber) {
    const internalMsg = buildInternalWhatsAppMessage(contract, alertLevel)
    waInternal = await sendEvolutionWhatsApp('retencao', internalNumber, internalMsg)
  }

  // 2. WhatsApp para o CLIENTE (só a partir de 60 dias)
  let waClient: { sent: boolean; error?: string } = { sent: false, error: 'cliente sem telefone ou nível > 60d' }
  if (alertLevel <= 60 && contract.contact_phone) {
    const clientMsg = buildClientWhatsAppMessage(contract, alertLevel)
    waClient = await sendEvolutionWhatsApp('retencao', contract.contact_phone, clientMsg)
  }

  // 3. E-mail interno + cópia para cliente se disponível (a partir de 60 dias)
  const emailResult = await sendAgentEmail({
    to:       alertEmail,
    subject:  buildClientEmailSubject(contract, alertLevel),
    htmlBody: buildClientEmailHtml(contract, alertLevel),
    fromEmail: process.env.AGENT_FROM_EMAIL,
  })

  // 4. Atividade no CRM
  const diasDesc = alertLevel === 0 || contract.days_until_expiry < 0
    ? 'VENCIDO'
    : `${contract.days_until_expiry} dias`

  const activityContent =
    `[COPILOTO] Alerta de vencimento disparado (${diasDesc}). ` +
    `Contrato ${contract.process_number} — ${contract.client_name}. ` +
    `Canais: WhatsApp interno=${waInternal.sent ? '✓' : '✗'} | ` +
    `WhatsApp cliente=${waClient.sent ? '✓' : '✗'} | ` +
    `E-mail=${emailResult.sent ? '✓' : '✗'}`

  const crmResult = await createCrmActivity({
    contractId: contract.id,
    type:       'system',
    content:    activityContent,
    dueInDays:  alertLevel <= 15 ? 1 : alertLevel <= 30 ? 3 : 7,
    metadata:   { alert_level: alertLevel, days_until_expiry: contract.days_until_expiry },
  })

  return {
    contractId:      contract.id,
    processNumber:   contract.process_number,
    clientName:      contract.client_name,
    daysUntilExpiry: contract.days_until_expiry,
    alertLevel,
    whatsappClient:  waClient,
    emailInternal:   emailResult,
    crmActivity:     crmResult,
  }
}

// ─── Exportação principal ─────────────────────────────────────────────────────

export type ExpirationAlertsReport = {
  ran_at:     string
  total:      number
  results:    AlertResult[]
  by_level:   Record<string, number>
  errors:     string[]
}

export async function runExpirationAlerts(): Promise<ExpirationAlertsReport> {
  console.log('[expiration] iniciando varredura de vencimentos...')

  const levels: AlertLevel[] = [90, 60, 30, 15]

  const [
    contracts90,
    contracts60,
    contracts30,
    contracts15,
    contractsExpired,
  ] = await Promise.all([
    fetchContractsExpiringInDays(90),
    fetchContractsExpiringInDays(60),
    fetchContractsExpiringInDays(30),
    fetchContractsExpiringInDays(15),
    fetchExpiredContracts(),
  ])

  console.log(
    `[expiration] contratos encontrados — 90d:${contracts90.length} 60d:${contracts60.length} ` +
    `30d:${contracts30.length} 15d:${contracts15.length} vencidos:${contractsExpired.length}`
  )

  const allJobs: Array<{ contract: ExpiringContract; level: AlertLevel }> = [
    ...contracts90.map(c => ({ contract: c, level: 90 as AlertLevel })),
    ...contracts60.map(c => ({ contract: c, level: 60 as AlertLevel })),
    ...contracts30.map(c => ({ contract: c, level: 30 as AlertLevel })),
    ...contracts15.map(c => ({ contract: c, level: 15 as AlertLevel })),
    ...contractsExpired.map(c => ({ contract: c, level: 0 as AlertLevel })),
  ]

  const results: AlertResult[] = []
  const errors:  string[]      = []

  // Processa sequencialmente para não sobrecarregar a Evolution API
  for (const { contract, level } of allJobs) {
    try {
      const result = await processContract(contract, level)
      results.push(result)
    } catch (err) {
      const msg = `${contract.process_number}: ${err instanceof Error ? err.message : String(err)}`
      console.error(`[expiration] erro ao processar ${msg}`)
      errors.push(msg)
    }
  }

  const byLevel: Record<string, number> = {}
  for (const r of results) {
    const key = r.daysUntilExpiry < 0 ? 'vencido' : `${r.alertLevel}d`
    byLevel[key] = (byLevel[key] ?? 0) + 1
  }

  console.log(`[expiration] concluído — ${results.length} alertas | ${errors.length} erros`)

  return {
    ran_at:   new Date().toISOString(),
    total:    results.length,
    results,
    by_level: byLevel,
    errors,
  }
}
