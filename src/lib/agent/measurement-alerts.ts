// ─── Farmer: medições pendentes ──────────────────────────────────────────────
// Roda junto da varredura diária (/api/agent/expiration-alerts), uma vez por empresa.
// Passado o dia limite (Configurações → Metas de receita → Prazo da medição),
// cada contrato POR MEDIÇÃO ativo na carteira sem a medição do mês anterior
// validada ganha uma atividade para o responsável. Uma por contrato e mês (dedupe).
// A medição só vale com relatório anexado ou aprovação do administrador.

import { createAdminClient } from '@/lib/supabase/admin'
import { createAgentActivity } from './agent-activity'
import { pendingReference, todayBrasilia, MONTHS_LONG, brl } from '@/lib/revenue/measurement'

export type MeasurementAlertsReport = { reference: string; overdue: boolean; created: number; skipped: number; errors: string[] }

export async function runMeasurementAlerts(tenantId: string): Promise<MeasurementAlertsReport> {
  const admin = createAdminClient()
  const { data: org } = await admin.from('organization_settings').select('measurement_due_day').eq('tenant_id', tenantId).maybeSingle()
  const dueDay = Number(org?.measurement_due_day ?? 5)
  const ref = pendingReference(todayBrasilia(), dueDay)
  const refLabel = `${MONTHS_LONG[ref.month - 1]}/${ref.year}`
  const report: MeasurementAlertsReport = { reference: refLabel, overdue: ref.overdue, created: 0, skipped: 0, errors: [] }
  if (!ref.overdue) return report

  // Contratos por medição com passagem aberta no funil de Gestão de Contratos
  const { data: pipes } = await admin.from('pipelines').select('id').eq('tenant_id', tenantId).eq('type', 'gestao_contratos')
  const pipeIds = (pipes ?? []).map(p => p.id)
  if (!pipeIds.length) return report
  const { data: runs } = await admin.from('pipeline_runs').select('contract_id').eq('tenant_id', tenantId).eq('status', 'open').in('pipeline_id', pipeIds)
  const contractIds = [...new Set((runs ?? []).map(r => r.contract_id as string))]
  if (!contractIds.length) return report

  const { data: contracts } = await admin.from('contracts')
    .select('id, process_number, client_name, monthly_value, owner_id, current_assignee_id, billing_type, valid_from')
    .eq('tenant_id', tenantId).eq('billing_type', 'metered').in('id', contractIds)
  if (!contracts?.length) return report

  // Contrato que começou depois do mês de referência ainda não deve medição
  const refEnd = new Date(Date.UTC(ref.month === 12 ? ref.year + 1 : ref.year, ref.month === 12 ? 0 : ref.month, 1)).toISOString().slice(0, 10)
  const due = contracts.filter(c => !c.valid_from || String(c.valid_from) < refEnd)

  const { data: recs } = await admin.from('billing_records').select('contract_id, status')
    .eq('tenant_id', tenantId).eq('year', ref.year).eq('month', ref.month).in('contract_id', due.map(c => c.id))
  const statusBy = new Map((recs ?? []).map(r => [r.contract_id as string, r.status as string]))

  for (const c of due) {
    const st = statusBy.get(c.id)
    if (st === 'validado') continue
    const waiting = st === 'aguardando_aprovacao'
    const r = await createAgentActivity(admin, {
      contractId: c.id,
      agent: 'farmer',
      dedupeKey: `measurement:${ref.year}-${String(ref.month).padStart(2, '0')}`,
      title: waiting ? `Aprovar ou anexar relatório da medição de ${refLabel}` : `Lançar medição de ${refLabel}`,
      content:
        `[Farmer] Contrato ${c.process_number ?? ''} — ${c.client_name}: ` +
        (waiting
          ? `a medição de ${refLabel} foi lançada sem relatório e ainda não conta na receita. Anexe o relatório ou peça a aprovação do administrador.`
          : `a medição de ${refLabel} ainda não foi lançada (prazo: dia ${dueDay}). Potencial do contrato: ${brl(Number(c.monthly_value) || 0)}/mês. ` +
            `Lance em Faturamento → "Lançar medição" com o relatório; sem relatório, só vale com aprovação do administrador.`),
      activityType: 'task',
      dueInDays: 0,
      assignedTo: (c.current_assignee_id as string | null) ?? (c.owner_id as string | null) ?? null,
      metadata: { kind: 'measurement_pending', year: ref.year, month: ref.month },
    })
    if (r.status === 'created') report.created++
    else if (r.status === 'skipped') report.skipped++
    else report.errors.push(`${c.process_number}: ${r.error}`)
  }
  return report
}
