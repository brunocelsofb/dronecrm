// ─── Alertas de renovação de contratos ───────────────────────────────────────
// Executado diariamente pelo CRON /api/agent/expiration-alerts
//
// Marcos (pelo nº de dias até valid_until):
//   ≤ 90 dias → preparar renovação (tarefa interna)
//   ≤ 60 dias → 1º aviso ao cliente
//   ≤ 30 dias → 2º aviso ao cliente
//   ≤ 15 dias → aviso urgente ao cliente
//   vencido   → regularização (até 90 dias após o vencimento)
//
// Regras:
//   - NADA é enviado ao cliente automaticamente. O agente abre uma atividade
//     planejada para o responsável do contrato com a mensagem pronta; o
//     consultor revisa e envia (fase 2: botão "Enviar ao cliente").
//   - Uma atividade por marco e por vigência (dedupe_key inclui valid_until):
//     não repete todo dia; se o contrato for renovado (nova valid_until), os
//     marcos voltam a valer.
//   - Usa janelas (≤ N dias), não dia exato: se o cron falhar um dia, o
//     alerta sai no dia seguinte.
//   - Resumo interno vai para o gestor pelo WhatsApp do briefing
//     (EVOLUTION_INSTANCE_NAME → WHATSAPP_NUMBER), só quando há alerta novo.

import { createClient } from '@supabase/supabase-js'
import { createAgentActivity } from './agent-activity'
import { sendWhatsApp } from './briefing-core'
import { formatBRL, formatDateBR, sendAgentEmail } from './notifications'
import { daysUntilBR, resolveRenewalTemplates, resolveRenewalEmailSubject, renderRenewalTemplate, type RenewalLevelKey } from './renewal-templates'
import { getTenantNamesById } from './tenant-name'

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

type AlertLevel = 90 | 60 | 30 | 15 | 0

type RenewalCandidate = {
  id: string
  process_number: string | null
  client_name: string
  valid_until: string            // YYYY-MM-DD
  days_until_expiry: number
  monthly_value: number | null
  contact_name: string | null
  contact_phone: string | null
  contact_email: string | null
  owner_id: string | null
  owner_name: string | null
  tenant_name: string | null     // razão social da conta dona do contrato
}

type AlertResult = {
  contractId: string
  processNumber: string | null
  clientName: string
  daysUntilExpiry: number
  alertLevel: AlertLevel
  activity: 'created' | 'skipped' | 'error'
  detail?: string
  validUntil: string
  ownerName: string | null
  monthlyValue: number | null
  pending: 'preparar' | 'enviar' | 'sem_contato'
}

export type ExpirationAlertsReport = {
  ran_at:   string
  total:    number             // atividades novas criadas
  results:  AlertResult[]
  by_level: Record<string, number>
  internal_whatsapp: { sent: boolean; error?: string } | null
  internal_email: { sent: boolean; error?: string } | null
  errors:   string[]
}

// ─── Datas (Brasília, UTC-3) ──────────────────────────────────────────────────

function todayBR(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}


function levelFor(daysLeft: number): AlertLevel | null {
  if (daysLeft < 0)   return 0
  if (daysLeft <= 15) return 15
  if (daysLeft <= 30) return 30
  if (daysLeft <= 60) return 60
  if (daysLeft <= 90) return 90
  return null
}

// ─── Busca de contratos ───────────────────────────────────────────────────────

async function fetchCandidates(
  supabase: ReturnType<typeof getAdminClient>,
  tenantId: string,
): Promise<RenewalCandidate[]> {
  const today = todayBR()

  const { data: contracts, error } = await supabase
    .from('contracts')
    .select('id, tenant_id, process_number, client_name, valid_until, monthly_value, contact_id, owner_id, current_assignee_id')
    .not('valid_until', 'is', null)
    .gte('valid_until', addDays(today, -90))
    .lte('valid_until', addDays(today, 90))
    .eq('tenant_id', tenantId)

  if (error) throw new Error(`erro ao buscar contratos: ${error.message}`)
  if (!contracts?.length) return []

  // Contato: contracts.contact_id, senão o principal em contract_contacts
  const ids = contracts.map(c => c.id)
  const { data: links } = await supabase
    .from('contract_contacts')
    .select('contract_id, contact_id, is_primary')
    .in('contract_id', ids)

  const contactIdFor = new Map<string, string>()
  for (const c of contracts) if (c.contact_id) contactIdFor.set(c.id, c.contact_id)
  for (const l of (links ?? []).sort((a, b) => Number(b.is_primary) - Number(a.is_primary))) {
    if (!contactIdFor.has(l.contract_id)) contactIdFor.set(l.contract_id, l.contact_id)
  }

  const contactIds = [...new Set(contactIdFor.values())]
  const { data: contacts } = contactIds.length
    ? await supabase.from('contacts').select('id, name, phone, email').in('id', contactIds)
    : { data: [] as { id: string; name: string | null; phone: string | null; email: string | null }[] }
  const contactById = new Map((contacts ?? []).map(c => [c.id, c]))

  // Responsável: owner_id, senão current_assignee_id
  const ownerIds = [...new Set(contracts.map(c => c.owner_id ?? c.current_assignee_id).filter(Boolean))] as string[]
  const { data: owners } = ownerIds.length
    ? await supabase.from('profiles').select('id, full_name').in('id', ownerIds)
    : { data: [] as { id: string; full_name: string | null }[] }
  const ownerById = new Map((owners ?? []).map(o => [o.id, o.full_name]))
  const tenantNameById = await getTenantNamesById(supabase, contracts.map(c => c.tenant_id as string))

  return contracts.map(c => {
    const contact = contactById.get(contactIdFor.get(c.id) ?? '')
    const ownerId = c.owner_id ?? c.current_assignee_id ?? null
    const phone = contact?.phone?.replace(/\D/g, '') || null
    return {
      id:                c.id,
      process_number:    c.process_number,
      client_name:       c.client_name,
      valid_until:       String(c.valid_until).slice(0, 10),
      days_until_expiry: daysUntilBR(String(c.valid_until).slice(0, 10)),
      monthly_value:     c.monthly_value ?? null,
      contact_name:      contact?.name ?? null,
      contact_phone:     phone && phone.length >= 10 ? phone : null,
      contact_email:     contact?.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email.trim()) ? contact.email.trim() : null,
      owner_id:          ownerId,
      owner_name:        ownerId ? ownerById.get(ownerId) ?? null : null,
      tenant_name:       c.tenant_id ? tenantNameById.get(c.tenant_id) ?? null : null,
    }
  })
}

type OrgConfig = { companyName: string; templates: Record<RenewalLevelKey, string>; emailSubject: string }

async function fetchOrgConfig(supabase: ReturnType<typeof getAdminClient>, tenantId: string): Promise<OrgConfig> {
  const { data } = await supabase
    .from('organization_settings')
    .select('company_name, copilot_settings')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  const copilot = (data?.copilot_settings ?? {}) as { renewal_templates?: unknown; renewal_email_subject?: unknown }
  return {
    companyName: data?.company_name?.trim() || 'Equipe Comercial',
    templates:   resolveRenewalTemplates(copilot.renewal_templates),
    emailSubject: resolveRenewalEmailSubject(copilot.renewal_email_subject),
  }
}

// ─── Mensagens ────────────────────────────────────────────────────────────────

// Monta o rascunho a partir do modelo de Configurações → Copiloto IA.
// {{consultor}} fica no texto e é preenchido no envio com o WhatsApp escolhido.
function templateVars(c: RenewalCandidate, org: OrgConfig): Record<string, string | null> {
  return {
    contato:    c.contact_name?.split(' ')[0] ?? c.client_name,
    cliente:    c.client_name,
    contrato:   c.process_number ?? '',
    vencimento: formatDateBR(c.valid_until),
    // {{dias}} fica no rascunho e é calculado NO ENVIO (o aviso pode ser enviado dias depois)
    dias:       null,
    empresa:    c.tenant_name ?? org.companyName,
  }
}

function buildClientMessage(c: RenewalCandidate, level: AlertLevel, org: OrgConfig): string {
  const key = String(level) as RenewalLevelKey
  return renderRenewalTemplate(org.templates[key], templateVars(c, org))
}

function levelLabel(level: AlertLevel, days: number): string {
  return level === 0 ? `vencido há ${Math.abs(days)} dia(s)` : `vence em ${days} dia(s)`
}

// ─── Processa um contrato ─────────────────────────────────────────────────────

async function processContract(
  supabase: ReturnType<typeof getAdminClient>,
  c: RenewalCandidate,
  level: AlertLevel,
  org: OrgConfig,
): Promise<AlertResult> {
  const base = {
    contractId: c.id, processNumber: c.process_number, clientName: c.client_name,
    daysUntilExpiry: c.days_until_expiry, alertLevel: level,
    validUntil: c.valid_until, ownerName: c.owner_name, monthlyValue: c.monthly_value,
    pending: (level === 90 ? 'preparar' : c.contact_phone && c.contact_email ? 'enviar' : 'sem_contato') as AlertResult['pending'],
  }
  const dedupeKey = `renewal:${c.valid_until}:${level}`
  const dueInDays = level === 0 ? 0 : level === 15 ? 1 : level === 30 ? 3 : level === 60 ? 5 : 7
  const when      = levelLabel(level, c.days_until_expiry)
  const header    = `[Farmer] Contrato ${c.process_number ?? ''} — ${c.client_name} — ${when} (${formatDateBR(c.valid_until)}). Valor: ${formatBRL(c.monthly_value)}.`

  // 90 dias: só tarefa interna de preparação
  if (level === 90) {
    // Próximos passos da última leitura do contrato (aba Leitura do contrato), se houver
    const { data: lastReading } = await supabase
      .from('contract_ai_readings').select('result, created_at').eq('contract_id', c.id).eq('status', 'ok')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    const steps = ((lastReading?.result as { proximos_passos?: { acao: string; prazo: string | null; clausula: string | null }[] } | null)?.proximos_passos ?? [])
    const readingText = steps.length
      ? `\n\nPróximos passos indicados na leitura do contrato:\n` + steps.map((st, i) =>
          `${i + 1}. ${st.acao}${st.prazo ? ` (até ${formatDateBR(st.prazo)})` : ''}${st.clausula ? ` — ${st.clausula}` : ''}`).join('\n')
      : `\n\nDica: anexe o contrato em PDF e use a aba "Leitura do contrato" — o Farmer indica aviso prévio, reajuste e os próximos passos.`
    const r = await createAgentActivity(supabase, {
      contractId: c.id, dedupeKey, dueInDays, assignedTo: c.owner_id,
      activityType: 'task',
      title: `Preparar renovação — ${c.client_name}`,
      content:
        `${header}\n\nPreparar a renovação: conferir cláusula de reajuste (índice e data-base), ` +
        `histórico de atendimento e satisfação do cliente, e definir a proposta de renovação.` + readingText,
      metadata: { kind: 'renewal_alert', alert_level: level, valid_until: c.valid_until },
    })
    return { ...base, activity: r.status, detail: r.status === 'error' ? r.error : r.status === 'skipped' ? r.reason : undefined }
  }

  // 60 / 30 / 15 / vencido: aviso ao cliente, aguardando aprovação do consultor
  // Aviso vai por WhatsApp E e-mail juntos: exige os dois no contato
  const missing = [!c.contact_phone && 'WhatsApp', !c.contact_email && 'e-mail'].filter(Boolean) as string[]
  if (missing.length > 0) {
    const r = await createAgentActivity(supabase, {
      contractId: c.id, dedupeKey, dueInDays, assignedTo: c.owner_id,
      activityType: 'task',
      title: `Aviso de renovação sem ${missing.join(' e ')} — ${c.client_name}`,
      content:
        `${header}\n\nO aviso de renovação vai por WhatsApp e e-mail juntos, mas o contato do contrato ` +
        `está sem ${missing.join(' e ')}. Cadastre no contato e fale com o cliente.`,
      metadata: { kind: 'renewal_alert', alert_level: level, valid_until: c.valid_until, missing },
    })
    return { ...base, activity: r.status, detail: r.status === 'error' ? r.error : r.status === 'skipped' ? r.reason : `sem ${missing.join(' e ')}` }
  }

  const draft = buildClientMessage(c, level, org)
  const draftSubject = renderRenewalTemplate(org.emailSubject, templateVars(c, org))
  const r = await createAgentActivity(supabase, {
    contractId: c.id, dedupeKey, dueInDays, assignedTo: c.owner_id,
    activityType: 'whatsapp',
    title: level === 0
      ? `Enviar aviso de contrato vencido — ${c.client_name}`
      : `Enviar aviso de renovação (marco de ${level} dias · vence ${formatDateBR(c.valid_until)}) — ${c.client_name}`,
    content:
      `${header}\n\n` +
      `Aviso ao cliente (WhatsApp + e-mail) pronto para revisão — para ${c.contact_name ?? 'o contato'} ` +
      `(${c.contact_phone} · ${c.contact_email}). ` +
      `Clique em "Revisar e enviar".`,
    metadata: {
      kind:          'renewal_alert',
      alert_level:   level,
      valid_until:   c.valid_until,
      draft_message: draft,
      target_phone:  c.contact_phone,
      target_email:  c.contact_email,
      draft_subject: draftSubject,
      contact_name:  c.contact_name,
      approval:      'pending',
    },
  })
  return { ...base, activity: r.status, detail: r.status === 'error' ? r.error : r.status === 'skipped' ? r.reason : undefined }
}

// ─── E-mail de resumo para o gestor ───────────────────────────────────────────

function escapeHtml(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const PENDING_LABEL: Record<AlertResult['pending'], { text: string; color: string }> = {
  enviar:       { text: 'Aviso ao cliente aguardando revisão e envio', color: '#c2410c' },
  sem_contato:  { text: 'Falta WhatsApp e/ou e-mail do contato — cadastrar e falar com o cliente', color: '#8e4550' },
  preparar:     { text: 'Preparar a renovação (90 dias)', color: '#1d4ed8' },
}

function buildSummaryEmail(items: AlertResult[], companyName: string): string {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://crm-gestaocontratos-pi.vercel.app').replace(/\/$/, '')
  const rows = [...items]
    .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry)
    .map(r => {
      const p = PENDING_LABEL[r.pending]
      const when = levelLabel(r.alertLevel, r.daysUntilExpiry)
      return `
        <tr>
          <td style="padding:12px;border-bottom:1px solid #e5e7eb;vertical-align:top;">
            <a href="${appUrl}/contracts/${r.contractId}" style="color:#1B556B;font-weight:bold;text-decoration:none;">${escapeHtml(r.clientName)}</a>
            <div style="color:#6b7280;font-size:12px;margin-top:2px;">${escapeHtml(r.processNumber ?? '')} · ${formatBRL(r.monthlyValue)}</div>
          </td>
          <td style="padding:12px;border-bottom:1px solid #e5e7eb;vertical-align:top;font-size:13px;color:#111;">
            ${formatDateBR(r.validUntil)}<div style="color:#6b7280;font-size:12px;">${when}</div>
          </td>
          <td style="padding:12px;border-bottom:1px solid #e5e7eb;vertical-align:top;font-size:13px;color:#111;">${escapeHtml(r.ownerName ?? '—')}</td>
          <td style="padding:12px;border-bottom:1px solid #e5e7eb;vertical-align:top;font-size:12px;color:${p.color};">${p.text}</td>
        </tr>`
    })
    .join('')

  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:24px 0;"><tr><td align="center">
    <table width="680" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;">
      <tr><td style="background:#1B556B;padding:20px 24px;">
        <p style="margin:0;color:#fff;font-size:17px;font-weight:bold;">Copiloto — Renovações para acompanhar</p>
        <p style="margin:4px 0 0;color:#cfe3ea;font-size:13px;">${items.length} nova(s) atividade(s) aberta(s) para os responsáveis</p>
      </td></tr>
      <tr><td style="padding:8px 12px 16px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <th align="left" style="padding:10px 12px;font-size:11px;color:#6b7280;text-transform:uppercase;border-bottom:2px solid #e5e7eb;">Cliente</th>
            <th align="left" style="padding:10px 12px;font-size:11px;color:#6b7280;text-transform:uppercase;border-bottom:2px solid #e5e7eb;">Vencimento</th>
            <th align="left" style="padding:10px 12px;font-size:11px;color:#6b7280;text-transform:uppercase;border-bottom:2px solid #e5e7eb;">Responsável</th>
            <th align="left" style="padding:10px 12px;font-size:11px;color:#6b7280;text-transform:uppercase;border-bottom:2px solid #e5e7eb;">Pendência</th>
          </tr>
          ${rows}
        </table>
      </td></tr>
      <tr><td style="background:#f9fafb;padding:14px 24px;border-top:1px solid #e5e7eb;">
        <p style="margin:0;color:#888;font-size:12px;">Nenhuma mensagem foi enviada a clientes: os avisos aguardam revisão do consultor no CRM. Gerado automaticamente pelo Copiloto IA — ${escapeHtml(companyName)}.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`
}

// ─── Exportação principal ─────────────────────────────────────────────────────

export async function runExpirationAlerts(tenantId: string): Promise<ExpirationAlertsReport> {
  console.log('[expiration] iniciando varredura de renovações...')
  const supabase = getAdminClient()

  const [candidates, org] = await Promise.all([fetchCandidates(supabase, tenantId), fetchOrgConfig(supabase, tenantId)])
  console.log(`[expiration] ${candidates.length} contrato(s) na janela de -90 a +90 dias`)

  const results: AlertResult[] = []
  const errors:  string[]      = []

  for (const c of candidates) {
    const level = levelFor(c.days_until_expiry)
    if (level === null) continue
    try {
      const r = await processContract(supabase, c, level, org)
      results.push(r)
      if (r.activity === 'error') errors.push(`${c.process_number ?? c.id}: ${r.detail}`)
      console.log(`[expiration] ${c.process_number ?? c.id} (${c.client_name}) ${level}d → ${r.activity}${r.detail ? ` (${r.detail})` : ''}`)
    } catch (err) {
      const msg = `${c.process_number ?? c.id}: ${err instanceof Error ? err.message : String(err)}`
      console.error(`[expiration] erro ao processar ${msg}`)
      errors.push(msg)
    }
  }

  const created = results.filter(r => r.activity === 'created')
  const byLevel: Record<string, number> = {}
  for (const r of created) {
    const key = r.alertLevel === 0 ? 'vencido' : `${r.alertLevel}d`
    byLevel[key] = (byLevel[key] ?? 0) + 1
  }

  // Resumo interno para o gestor — só quando há alerta novo
  let internal: ExpirationAlertsReport['internal_whatsapp'] = null
  if (created.length > 0) {
    const lines = created
      .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry)
      .map(r => `• ${r.clientName}${r.processNumber ? ` (${r.processNumber})` : ''} — ${levelLabel(r.alertLevel, r.daysUntilExpiry)}`)
    internal = await sendWhatsApp(
      `🔔 *Copiloto — Renovações*\n\n` +
      `${created.length} nova(s) atividade(s) aberta(s) para os responsáveis:\n\n` +
      `${lines.join('\n')}\n\n` +
      `Os avisos aos clientes aguardam revisão do consultor no CRM.`,
      tenantId,
    )
  }

  // Resumo por e-mail para o gestor — só quando há alerta novo
  let internalEmail: ExpirationAlertsReport['internal_email'] = null
  if (created.length > 0) {
    const { getManagerChannel } = await import('./briefing-core')
    const to = (await getManagerChannel(tenantId)).email
    internalEmail = to
      ? await sendAgentEmail({
          tenantId,
          to,
          subject: `[Copiloto] ${created.length} renovação(ões) para acompanhar — ${org.companyName}`,
          htmlBody: buildSummaryEmail(created, org.companyName),
        })
      : { sent: false, error: 'e-mail do gestor não configurado (Configurações → Copiloto IA → Gestor)' }
    if (!internalEmail.sent) console.error(`[expiration] e-mail de resumo não enviado: ${internalEmail.error}`)
  }

  console.log(`[expiration] concluído — ${created.length} atividade(s) nova(s) | ${errors.length} erro(s)`)

  return {
    ran_at:   new Date().toISOString(),
    total:    created.length,
    results,
    by_level: byLevel,
    internal_whatsapp: internal,
    internal_email: internalEmail,
    errors,
  }
}
