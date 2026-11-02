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
    // Os dias seguem o "preparar a renovação" do agente (marcos da Central → Renovação)
    const { data: org } = await g.db.from('organization_settings').select('copilot_settings').maybeSingle()
    const { resolveRenewalLevels } = await import('@/lib/agent/renewal-templates')
    const days = resolveRenewalLevels((org as { copilot_settings?: { renewal_levels?: unknown } } | null)?.copilot_settings?.renewal_levels).prep
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
  if (days !== null && (!Number.isInteger(days) || days < 0 || days > 365)) return { ok: false, error: 'Prazo: de 0 a 365 dias (0 = sem prazo; vazio = padrão de 7 dias só para a cor do cartão).' }
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

// Ações de evento (ganho, renovação, perda, implantação): liga/desliga por empresa
export async function saveEventToggle(key: string, enabled: boolean): Promise<Result> {
  const g = await rulesAdminGuard()
  if ('error' in g) return { ok: false, error: g.error }
  const { EVENT_ACTIONS, eventTaskKey, isEventKey } = await import('@/lib/rules/events')
  if (!isEventKey(key)) return { ok: false, error: 'Ação desconhecida.' }
  const def = EVENT_ACTIONS.find(e => e.key === key)!
  if (!g.features.includes(def.feature)) return { ok: false, error: 'A licença não inclui esta ação.' }
  const tk = eventTaskKey(key)
  const { data: row } = await g.db.from('agent_tasks').select('id').eq('task_key', tk).maybeSingle()
  const { error } = row
    ? await g.db.from('agent_tasks').update({ enabled, updated_at: new Date().toISOString() }).eq('id', row.id as string)
    : await g.db.from('agent_tasks').insert({ task_key: tk, enabled, created_by: g.userId })
  return error ? { ok: false, error: error.message } : { ok: true }
}

// ─── Áreas da empresa (Time técnico, Faturamento, Financeiro…) ────────────────
export type AreaInput = { id?: string | null; name: string; leadId: string | null; memberIds: string[]; emails: string[] }
export async function saveArea(input: AreaInput): Promise<Result & { id?: string }> {
  const g = await rulesAdminGuard()
  if ('error' in g) return { ok: false, error: g.error }
  const name = String(input.name ?? '').trim()
  if (!name || name.length > 60) return { ok: false, error: 'Nome da área: de 1 a 60 caracteres.' }
  const members = [...new Set((input.memberIds ?? []).filter(x => UUID.test(x)))]
  const lead = input.leadId && UUID.test(input.leadId) ? input.leadId : null
  if (lead && !members.includes(lead)) members.unshift(lead)
  if (members.length) {
    const { data } = await g.db.from('profiles').select('id').eq('tenant_id', g.tenantId).in('id', members)
    if ((data ?? []).length !== members.length) return { ok: false, error: 'Alguma pessoa não é desta empresa.' }
  }
  const emails = [...new Set((input.emails ?? []).map(e => String(e).trim().toLowerCase()).filter(Boolean))]
  if (emails.some(e => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))) return { ok: false, error: 'Há e-mail inválido na área.' }
  if (emails.length > 20) return { ok: false, error: 'Até 20 e-mails de fora por área.' }
  if (!members.length && !emails.length) return { ok: false, error: 'Coloque pelo menos uma pessoa ou um e-mail.' }
  const fields = { name, lead_id: lead, member_ids: members, emails, updated_at: new Date().toISOString() }
  if (input.id) {
    const { error } = await g.db.from('org_areas').update(fields).eq('id', input.id)
    if (error) return { ok: false, error: error.message }
    revalidatePath('/regras')
    return { ok: true, id: input.id }
  }
  const { data, error } = await g.db.from('org_areas').insert(fields).select('id').single()
  if (error) return { ok: false, error: error.message }
  revalidatePath('/regras')
  return { ok: true, id: data.id as string }
}

export async function deleteArea(id: string): Promise<Result> {
  const g = await rulesAdminGuard()
  if ('error' in g) return { ok: false, error: g.error }
  const { data: used } = await g.db.from('agent_rules').select('name, actions')
  const inUse = ((used ?? []) as { name: string; actions: unknown }[]).filter(r => JSON.stringify(r.actions ?? {}).includes(`area:${id}`)).map(r => r.name)
  if (inUse.length) return { ok: false, error: `A área está em uso nas regras: ${inUse.slice(0, 3).join(', ')}. Troque o destino delas antes.` }
  const { error } = await g.db.from('org_areas').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/regras')
  return { ok: true }
}

// Modo sem IA: ações do agente viram tarefas manuais com as mesmas instruções
export async function setAiPaused(paused: boolean): Promise<Result> {
  const g = await rulesAdminGuard()
  if ('error' in g) return { ok: false, error: g.error }
  const { error } = await g.db.from('organization_settings').update({ ai_paused: !!paused }).eq('tenant_id', g.tenantId)
  return error ? { ok: false, error: error.message } : { ok: true }
}

// Quem envia as mensagens automáticas internas: cadastro completo e e-mail conectado
export async function setAutoSender(userId: string | null): Promise<Result> {
  const g = await rulesAdminGuard()
  if ('error' in g) return { ok: false, error: g.error }
  if (userId) {
    if (!UUID.test(userId)) return { ok: false, error: 'Pessoa inválida.' }
    const { data: p } = await g.db.from('profiles').select('id, full_name, phone, department, email').eq('id', userId).eq('tenant_id', g.tenantId).maybeSingle()
    if (!p) return { ok: false, error: 'Pessoa não encontrada nesta empresa.' }
    const { profileProblems } = await import('@/lib/people/profile-complete')
    const missing = profileProblems(p)
    if (missing.length) return { ok: false, error: `Cadastro incompleto dessa pessoa: falta ${missing.join(', ')} (Configurações → Usuários).` }
    const { getEmailAccountInfo } = await import('@/lib/email/send')
    if (!(await getEmailAccountInfo(userId))) return { ok: false, error: 'Essa pessoa ainda não conectou o e-mail em Minha Conta.' }
  }
  const { error } = await g.db.from('organization_settings').update({ auto_sender_id: userId }).eq('tenant_id', g.tenantId)
  return error ? { ok: false, error: error.message } : { ok: true }
}
