'use server'
// ─── Central de regras: critérios simples (sem IA) editáveis ali mesmo ───────
//   • Funil → renovação: X dias antes do vencimento, a oportunidade volta para a etapa escolhida
//   • Funil → prazo (SLA) de cada etapa
//   • Atendimento → prazo do chamado por prioridade
// Gravam nas mesmas colunas que as rotinas já leem (pipelines, stages, organization_settings).

import { revalidatePath } from 'next/cache'
import { rulesAdminGuard } from '@/lib/rules/guard'
import { validateSlaDays } from '@/lib/utils/gut-matrix'

type Result = { ok: true } | { ok: false; error: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function saveFunnelRenewal(pipelineId: string, input: { enabled: boolean; days: number; stageId: string | null }): Promise<Result> {
  const g = await rulesAdminGuard()
  if ('error' in g) return { ok: false, error: g.error }
  if (!g.features.includes('pipeline')) return { ok: false, error: 'A licença não inclui o funil.' }
  if (!UUID.test(pipelineId)) return { ok: false, error: 'Funil inválido.' }
  let fields: { renewal_trigger_days: number | null; renewal_target_stage_id: string | null }
  if (!input.enabled) fields = { renewal_trigger_days: null, renewal_target_stage_id: null }
  else {
    const days = Number(input.days)
    if (!Number.isInteger(days) || days < 1 || days > 365) return { ok: false, error: 'Dias: de 1 a 365.' }
    if (!input.stageId || !UUID.test(input.stageId)) return { ok: false, error: 'Escolha a etapa de renovação.' }
    const { data: st } = await g.db.from('stages').select('id').eq('id', input.stageId).eq('pipeline_id', pipelineId).maybeSingle()
    if (!st) return { ok: false, error: 'A etapa precisa ser deste funil.' }
    fields = { renewal_trigger_days: days, renewal_target_stage_id: input.stageId }
  }
  const { error } = await g.db.from('pipelines').update(fields).eq('id', pipelineId)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/pipelines')
  return { ok: true }
}

export async function saveStageSla(stageId: string, days: number | null): Promise<Result> {
  const g = await rulesAdminGuard()
  if ('error' in g) return { ok: false, error: g.error }
  if (!UUID.test(stageId)) return { ok: false, error: 'Etapa inválida.' }
  if (days !== null && (!Number.isInteger(days) || days < 1 || days > 365)) return { ok: false, error: 'Prazo: de 1 a 365 dias (vazio = sem prazo).' }
  const { error } = await g.db.from('stages').update({ sla_days: days }).eq('id', stageId)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/pipeline')
  return { ok: true }
}

export async function saveTicketSla(raw: Record<string, unknown>): Promise<Result> {
  const g = await rulesAdminGuard()
  if ('error' in g) return { ok: false, error: g.error }
  if (!g.features.includes('tickets')) return { ok: false, error: 'A licença não inclui atendimento.' }
  const v = validateSlaDays(raw)
  if ('error' in v) return { ok: false, error: v.error }
  const { error } = await g.db.from('organization_settings').update({ ticket_sla_days: v.days }).eq('tenant_id', g.tenantId)
  return error ? { ok: false, error: error.message } : { ok: true }
}

// Testar a renovação do funil: quais oportunidades voltariam para a etapa hoje (nada é movido)
export async function previewFunnelRenewal(pipelineId: string, input: { days: number; stageId: string | null }): Promise<{ ok: boolean; error?: string; items: { name: string; detail: string }[]; total: number }> {
  const g = await rulesAdminGuard()
  if ('error' in g) return { ok: false, error: g.error, items: [], total: 0 }
  const days = Number(input.days)
  if (!Number.isInteger(days) || days < 1 || days > 365 || !input.stageId) return { ok: false, error: 'Informe os dias e a etapa.', items: [], total: 0 }
  const { data: runs } = await g.db.from('pipeline_runs').select('contract_id, stage_id').eq('pipeline_id', pipelineId).eq('status', 'open').neq('stage_id', input.stageId).limit(3000)
  const ids = [...new Set((runs ?? []).map(r => r.contract_id as string))]
  const today = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10)
  const out: { name: string; detail: string; d: number }[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await g.db.from('contracts').select('id, client_name, valid_until').in('id', ids.slice(i, i + 200)).not('valid_until', 'is', null)
    for (const c of data ?? []) {
      const vu = String(c.valid_until).slice(0, 10)
      const d = Math.round((Date.parse(`${vu}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000)
      if (d <= days) out.push({ name: c.client_name as string, d, detail: d < 0 ? `vencido há ${-d} dia(s)` : `vence em ${d} dia(s) (${vu.split('-').reverse().join('/')})` })
    }
  }
  out.sort((a, b) => a.d - b.d)
  return { ok: true, total: out.length, items: out.slice(0, 40).map(({ name, detail }) => ({ name, detail })) }
}
