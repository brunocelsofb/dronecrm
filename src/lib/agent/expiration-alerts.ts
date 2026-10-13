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
import { formatBRL, formatDateBR } from './notifications'
import { resolveRenewalTemplates, renderRenewalTemplate, type RenewalLevelKey } from './renewal-templates'

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
  owner_id: string | null
  owner_name: string | null
}

type AlertResult = {
  contractId: string
  processNumber: string | null
  clientName: string
  daysUntilExpiry: number
  alertLevel: AlertLevel
  activity: 'created' | 'skipped' | 'error'
  detail?: string
}

export type ExpirationAlertsReport = {
  ran_at:   string
  total:    number             // atividades novas criadas
  results:  AlertResult[]
  by_level: Record<string, number>
  internal_whatsapp: { sent: boolean; error?: string } | null
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

function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso}T12:00:00Z`).getTime()
  const b = new Date(`${toIso}T12:00:00Z`).getTime()
  return Math.round((b - a) / 86_400_000)
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
): Promise<RenewalCandidate[]> {
  const today = todayBR()

  const { data: contracts, error } = await supabase
    .from('contracts')
    .select('id, process_number, client_name, valid_until, monthly_value, contact_id, owner_id, current_assignee_id')
    .not('valid_until', 'is', null)
    .gte('valid_until', addDays(today, -90))
    .lte('valid_until', addDays(today, 90))

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
    ? await supabase.from('contacts').select('id, name, phone').in('id', contactIds)
    : { data: [] as { id: string; name: string | null; phone: string | null }[] }
  const contactById = new Map((contacts ?? []).map(c => [c.id, c]))

  // Responsável: owner_id, senão current_assignee_id
  const ownerIds = [...new Set(contracts.map(c => c.owner_id ?? c.current_assignee_id).filter(Boolean))] as string[]
  const { data: owners } = ownerIds.length
    ? await supabase.from('profiles').select('id, full_name').in('id', ownerIds)
    : { data: [] as { id: string; full_name: string | null }[] }
  const ownerById = new Map((owners ?? []).map(o => [o.id, o.full_name]))

  return contracts.map(c => {
    const contact = contactById.get(contactIdFor.get(c.id) ?? '')
    const ownerId = c.owner_id ?? c.current_assignee_id ?? null
    const phone = contact?.phone?.replace(/\D/g, '') || null
    return {
      id:                c.id,
      process_number:    c.process_number,
      client_name:       c.client_name,
      valid_until:       String(c.valid_until).slice(0, 10),
      days_until_expiry: daysBetween(today, String(c.valid_until).slice(0, 10)),
      monthly_value:     c.monthly_value ?? null,
      contact_name:      contact?.name ?? null,
      contact_phone:     phone && phone.length >= 10 ? phone : null,
      owner_id:          ownerId,
      owner_name:        ownerId ? ownerById.get(ownerId) ?? null : null,
    }
  })
}

type OrgConfig = { companyName: string; templates: Record<RenewalLevelKey, string> }

async function fetchOrgConfig(supabase: ReturnType<typeof getAdminClient>): Promise<OrgConfig> {
  const { data } = await supabase
    .from('organization_settings')
    .select('company_name, copilot_settings')
    .eq('id', 'default')
    .maybeSingle()
  const copilot = (data?.copilot_settings ?? {}) as { renewal_templates?: unknown }
  return {
    companyName: data?.company_name?.trim() || 'Equipe Comercial',
    templates:   resolveRenewalTemplates(copilot.renewal_templates),
  }
}

// ─── Mensagens ────────────────────────────────────────────────────────────────

// Monta o rascunho a partir do modelo de Configurações → Copiloto IA.
// {{consultor}} fica no texto e é preenchido no envio com o WhatsApp escolhido.
function buildClientMessage(c: RenewalCandidate, level: AlertLevel, org: OrgConfig): string {
  const key = String(level) as RenewalLevelKey
  return renderRenewalTemplate(org.templates[key], {
    contato:    c.contact_name?.split(' ')[0] ?? c.client_name,
    cliente:    c.client_name,
    contrato:   c.process_number ?? '',
    vencimento: formatDateBR(c.valid_until),
    dias:       String(Math.abs(c.days_until_expiry)),
    empresa:    org.companyName,
  })
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
  }
  const dedupeKey = `renewal:${c.valid_until}:${level}`
  const dueInDays = level === 0 ? 0 : level === 15 ? 1 : level === 30 ? 3 : level === 60 ? 5 : 7
  const when      = levelLabel(level, c.days_until_expiry)
  const header    = `[Copiloto IA] Contrato ${c.process_number ?? ''} — ${c.client_name} — ${when} (${formatDateBR(c.valid_until)}). Valor: ${formatBRL(c.monthly_value)}.`

  // 90 dias: só tarefa interna de preparação
  if (level === 90) {
    const r = await createAgentActivity(supabase, {
      contractId: c.id, dedupeKey, dueInDays, assignedTo: c.owner_id,
      activityType: 'task',
      title: `Preparar renovação — ${c.client_name}`,
      content:
        `${header}\n\nPreparar a renovação: conferir cláusula de reajuste (índice e data-base), ` +
        `histórico de atendimento e satisfação do cliente, e definir a proposta de renovação.`,
      metadata: { kind: 'renewal_alert', alert_level: level, valid_until: c.valid_until },
    })
    return { ...base, activity: r.status, detail: r.status === 'error' ? r.error : r.status === 'skipped' ? r.reason : undefined }
  }

  // 60 / 30 / 15 / vencido: aviso ao cliente, aguardando aprovação do consultor
  if (!c.contact_phone) {
    const r = await createAgentActivity(supabase, {
      contractId: c.id, dedupeKey, dueInDays, assignedTo: c.owner_id,
      activityType: 'task',
      title: `Aviso de renovação sem telefone — ${c.client_name}`,
      content:
        `${header}\n\nO aviso de renovação ao cliente não pôde ser preparado porque o contrato ` +
        `não tem contato com WhatsApp cadastrado. Cadastre o contato e fale com o cliente.`,
      metadata: { kind: 'renewal_alert', alert_level: level, valid_until: c.valid_until, missing: 'contact_phone' },
    })
    return { ...base, activity: r.status, detail: r.status === 'error' ? r.error : r.status === 'skipped' ? r.reason : 'sem telefone' }
  }

  const draft = buildClientMessage(c, level, org)
  const r = await createAgentActivity(supabase, {
    contractId: c.id, dedupeKey, dueInDays, assignedTo: c.owner_id,
    activityType: 'whatsapp',
    title: level === 0
      ? `Enviar aviso de contrato vencido — ${c.client_name}`
      : `Enviar aviso de renovação (${level} dias) — ${c.client_name}`,
    content:
      `${header}\n\n` +
      `Aviso ao cliente pronto para revisão — para ${c.contact_name ?? 'o contato'} (${c.contact_phone}). ` +
      `Clique em "Revisar e enviar".`,
    metadata: {
      kind:          'renewal_alert',
      alert_level:   level,
      valid_until:   c.valid_until,
      draft_message: draft,
      target_phone:  c.contact_phone,
      contact_name:  c.contact_name,
      approval:      'pending',
    },
  })
  return { ...base, activity: r.status, detail: r.status === 'error' ? r.error : r.status === 'skipped' ? r.reason : undefined }
}

// ─── Exportação principal ─────────────────────────────────────────────────────

export async function runExpirationAlerts(): Promise<ExpirationAlertsReport> {
  console.log('[expiration] iniciando varredura de renovações...')
  const supabase = getAdminClient()

  const [candidates, org] = await Promise.all([fetchCandidates(supabase), fetchOrgConfig(supabase)])
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
      `Os avisos aos clientes aguardam revisão do consultor no CRM.`
    )
  }

  console.log(`[expiration] concluído — ${created.length} atividade(s) nova(s) | ${errors.length} erro(s)`)

  return {
    ran_at:   new Date().toISOString(),
    total:    created.length,
    results,
    by_level: byLevel,
    internal_whatsapp: internal,
    errors,
  }
}
