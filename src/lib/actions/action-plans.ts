'use server'

// Plano de ação em tratativas PDCA (aba Plano de Ação da oportunidade)

import { revalidatePath } from 'next/cache'
import { getUserAccess } from '@/lib/auth/access'
import { resolveTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import {
  resolveActionPlanSettings, cleanWhys, cleanIshikawa, nextPhaseCheck, availableMethods, ORIGIN_LABEL, PHASE_LABEL,
  type ActionPlanSettings, type CauseMethod, type PlanOrigin, type PlanPhase,
} from '@/lib/quality/action-plan'

type Result = { ok: true; id?: string } | { ok: false; error: string }
type Db = Awaited<ReturnType<typeof createScopedAdmin>>

const ORIGINS = Object.keys(ORIGIN_LABEL) as PlanOrigin[]
const txt = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const gut = (v: unknown) => { const n = Math.round(Number(v)); return n >= 1 && n <= 5 ? n : null }

async function ctx(contractId: string): Promise<{ db: Db; tenantId: string; userId: string; settings: ActionPlanSettings } | { error: string }> {
  const me = await getUserAccess()
  if (!me) return { error: 'Usuário não autenticado.' }
  const tenantId = await resolveTenantId()
  const db = await createScopedAdmin(tenantId)
  const [{ data: c }, { data: org }] = await Promise.all([
    db.from('contracts').select('id').eq('id', contractId).maybeSingle(),
    db.from('organization_settings').select('action_plan_settings').eq('tenant_id', tenantId).maybeSingle(),
  ])
  if (!c) return { error: 'Oportunidade não encontrada.' }
  return { db, tenantId, userId: me.userId, settings: resolveActionPlanSettings(org?.action_plan_settings) }
}

async function loadPlan(db: Db, planId: string, contractId: string) {
  const { data } = await db.from('action_plans').select('*').eq('id', planId).eq('contract_id', contractId).maybeSingle()
  return data as (Record<string, unknown> & { id: string; phase: PlanPhase; title: string; cycle: number; cause_method: CauseMethod | null }) | null
}

async function log(db: Db, contractId: string, userId: string, content: string) {
  await db.from('activities').insert({ contract_id: contractId, user_id: userId, type: 'system', content })
}

const done = (contractId: string) => revalidatePath(`/contracts/${contractId}`)

export async function createActionPlan(contractId: string, input: {
  title: string; origin: string; description?: string; gut_g?: number | null; gut_u?: number | null; gut_t?: number | null
}): Promise<Result> {
  const c = await ctx(contractId)
  if ('error' in c) return { ok: false, error: c.error }
  const title = txt(input.title, 200)
  if (!title) return { ok: false, error: 'Descreva o problema.' }
  const origin = ORIGINS.includes(input.origin as PlanOrigin) ? input.origin : 'interno'
  const { data, error } = await c.db.from('action_plans').insert({
    contract_id: contractId, title, origin, description: txt(input.description, 2000) || null,
    gut_g: c.settings.tools.gut ? gut(input.gut_g) : null,
    gut_u: c.settings.tools.gut ? gut(input.gut_u) : null,
    gut_t: c.settings.tools.gut ? gut(input.gut_t) : null,
    created_by: c.userId,
  }).select('id').single()
  if (error || !data) return { ok: false, error: error?.message ?? 'Não foi possível criar.' }
  await log(c.db, contractId, c.userId, `🧭 Tratativa aberta no plano de ação: "${title}" (${ORIGIN_LABEL[origin as PlanOrigin]}).`)
  done(contractId)
  return { ok: true, id: data.id as string }
}

// Planejar: problema, prioridade e análise de causa
export async function updateActionPlan(contractId: string, planId: string, patch: {
  title?: string; description?: string; origin?: string
  gut_g?: number | null; gut_u?: number | null; gut_t?: number | null
  five_whys?: string[]; ishikawa?: Record<string, string[]>; root_cause?: string; standardization?: string; cause_method?: CauseMethod
}): Promise<Result> {
  const c = await ctx(contractId)
  if ('error' in c) return { ok: false, error: c.error }
  const plan = await loadPlan(c.db, planId, contractId)
  if (!plan) return { ok: false, error: 'Tratativa não encontrada.' }
  if (plan.phase === 'closed' || plan.phase === 'cancelled') return { ok: false, error: 'Tratativa encerrada.' }
  const up: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.title !== undefined) { const t = txt(patch.title, 200); if (!t) return { ok: false, error: 'Descreva o problema.' }; up.title = t }
  if (patch.description !== undefined) up.description = txt(patch.description, 2000) || null
  if (patch.origin !== undefined && ORIGINS.includes(patch.origin as PlanOrigin)) up.origin = patch.origin
  if (c.settings.tools.gut) {
    if (patch.gut_g !== undefined) up.gut_g = gut(patch.gut_g)
    if (patch.gut_u !== undefined) up.gut_u = gut(patch.gut_u)
    if (patch.gut_t !== undefined) up.gut_t = gut(patch.gut_t)
  }
  if (patch.cause_method !== undefined) {
    if (!availableMethods(c.settings).includes(patch.cause_method) && patch.cause_method !== plan.cause_method) {
      return { ok: false, error: 'Esse método de análise está desligado nas configurações.' }
    }
    up.cause_method = patch.cause_method
  }
  if (patch.five_whys !== undefined) up.five_whys = cleanWhys(patch.five_whys)
  if (patch.ishikawa !== undefined) up.ishikawa = cleanIshikawa(patch.ishikawa, c.settings.ishikawa_categories)
  if (patch.root_cause !== undefined) up.root_cause = txt(patch.root_cause, 1000) || null
  if (patch.standardization !== undefined) up.standardization = txt(patch.standardization, 2000) || null
  const { error } = await c.db.from('action_plans').update(up).eq('id', planId)
  if (error) return { ok: false, error: error.message }
  done(contractId)
  return { ok: true }
}

// Ação (5W2H): o quê, por quê, onde, quando, quem, como, quanto
export async function addPlanAction(contractId: string, planId: string, input: {
  what: string; why?: string; where?: string; due_date?: string; assigned_to?: string; department?: string; how?: string; how_much?: string | number
}): Promise<Result> {
  const c = await ctx(contractId)
  if ('error' in c) return { ok: false, error: c.error }
  const plan = await loadPlan(c.db, planId, contractId)
  if (!plan) return { ok: false, error: 'Tratativa não encontrada.' }
  if (plan.phase === 'closed' || plan.phase === 'cancelled') return { ok: false, error: 'Tratativa encerrada.' }
  const what = txt(input.what, 500)
  if (!what) return { ok: false, error: 'Diga o que será feito.' }
  const due = txt(input.due_date, 10)
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) return { ok: false, error: 'Data inválida.' }
  let assigned: string | null = null
  if (input.assigned_to) {
    const { data: p } = await c.db.from('profiles').select('id').eq('id', input.assigned_to).maybeSingle()
    if (!p) return { ok: false, error: 'Responsável não encontrado nesta empresa.' }
    assigned = p.id as string
  }
  const w = c.settings.tools.w5h2
  if (w && !assigned && !input.department) return { ok: false, error: 'Diga quem faz (pessoa ou área).' }
  if (w && !due) return { ok: false, error: 'Diga quando (prazo).' }
  let howMuch: number | null = null
  if (w && input.how_much !== undefined && String(input.how_much).trim() !== '') {
    const raw = String(input.how_much).replace(/[R$\s]/g, '')
    const n = Number(raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw)
    if (!Number.isFinite(n) || n < 0) return { ok: false, error: 'Valor de "quanto custa" inválido.' }
    howMuch = Math.round(n * 100) / 100
  }
  const { error } = await c.db.from('action_plan_items').insert({
    contract_id: contractId, plan_id: planId, description: what,
    responsible_department: input.department || null, assigned_to: assigned, due_date: due || null,
    why: w ? txt(input.why, 500) || null : null, where_text: w ? txt(input.where, 200) || null : null,
    how: w ? txt(input.how, 1000) || null : null, how_much: howMuch,
    created_by: c.userId, status: 'pending',
  })
  if (error) return { ok: false, error: error.message }
  await c.db.from('action_plans').update({ updated_at: new Date().toISOString() }).eq('id', planId)
  done(contractId)
  return { ok: true }
}

export async function setPlanActionStatus(contractId: string, itemId: string, status: 'pending' | 'in_progress' | 'done'): Promise<Result> {
  const c = await ctx(contractId)
  if ('error' in c) return { ok: false, error: c.error }
  if (!['pending', 'in_progress', 'done'].includes(status)) return { ok: false, error: 'Status inválido.' }
  const { error } = await c.db.from('action_plan_items')
    .update({ status, resolved_at: status === 'done' ? new Date().toISOString() : null })
    .eq('id', itemId).eq('contract_id', contractId)
  if (error) return { ok: false, error: error.message }
  done(contractId)
  return { ok: true }
}

export async function deletePlanAction(contractId: string, itemId: string): Promise<Result> {
  const c = await ctx(contractId)
  if ('error' in c) return { ok: false, error: c.error }
  const { error } = await c.db.from('action_plan_items').delete().eq('id', itemId).eq('contract_id', contractId)
  if (error) return { ok: false, error: error.message }
  done(contractId)
  return { ok: true }
}

// Avança no PDCA (Planejar → Executar → Checar → Agir → Encerrada)
export async function advancePlan(contractId: string, planId: string, to: PlanPhase): Promise<Result> {
  const c = await ctx(contractId)
  if ('error' in c) return { ok: false, error: c.error }
  const plan = await loadPlan(c.db, planId, contractId)
  if (!plan) return { ok: false, error: 'Tratativa não encontrada.' }
  const { data: items } = await c.db.from('action_plan_items').select('status').eq('plan_id', planId)
  const option = nextPhaseCheck(plan.phase, (items ?? []) as { status: string }[], c.settings.require_efficacy).find(o => o.to === to)
  if (!option) return { ok: false, error: 'Passo não permitido agora.' }
  if (option.blocked) return { ok: false, error: option.blocked }
  const now = new Date().toISOString()
  const { error } = await c.db.from('action_plans').update({ phase: to, updated_at: now, ...(to === 'closed' ? { closed_at: now } : {}) }).eq('id', planId).eq('phase', plan.phase)
  if (error) return { ok: false, error: error.message }
  await log(c.db, contractId, c.userId, `🧭 Tratativa "${plan.title}": ${PHASE_LABEL[plan.phase]} → ${PHASE_LABEL[to]}.`)
  done(contractId)
  return { ok: true }
}

// Checar: resolveu? Eficaz → Agir (padronizar). Não eficaz → volta a Planejar (novo ciclo).
export async function checkPlanEfficacy(contractId: string, planId: string, result: 'eficaz' | 'nao_eficaz', note: string): Promise<Result> {
  const c = await ctx(contractId)
  if ('error' in c) return { ok: false, error: c.error }
  const plan = await loadPlan(c.db, planId, contractId)
  if (!plan) return { ok: false, error: 'Tratativa não encontrada.' }
  if (plan.phase !== 'check') return { ok: false, error: 'A tratativa não está em Checar.' }
  if (result !== 'eficaz' && result !== 'nao_eficaz') return { ok: false, error: 'Escolha se foi eficaz.' }
  const n = txt(note, 1000)
  if (!n) return { ok: false, error: 'Diga como verificou (ex.: nova pesquisa, indicador, conversa com o cliente).' }
  const now = new Date().toISOString()
  const { error } = await c.db.from('action_plans').update({
    efficacy_result: result, efficacy_note: n, efficacy_checked_at: now, efficacy_checked_by: c.userId, updated_at: now,
    ...(result === 'eficaz' ? { phase: 'act' } : { phase: 'plan', cycle: (plan.cycle ?? 1) + 1 }),
  }).eq('id', planId).eq('phase', 'check')
  if (error) return { ok: false, error: error.message }
  await log(c.db, contractId, c.userId, result === 'eficaz'
    ? `✅ Tratativa "${plan.title}": verificada como eficaz. ${n}`
    : `🔁 Tratativa "${plan.title}": não foi eficaz, volta para Planejar (ciclo ${(plan.cycle ?? 1) + 1}). ${n}`)
  done(contractId)
  return { ok: true }
}

export async function cancelActionPlan(contractId: string, planId: string, reason: string): Promise<Result> {
  const c = await ctx(contractId)
  if ('error' in c) return { ok: false, error: c.error }
  const plan = await loadPlan(c.db, planId, contractId)
  if (!plan) return { ok: false, error: 'Tratativa não encontrada.' }
  if (plan.phase === 'closed' || plan.phase === 'cancelled') return { ok: false, error: 'Tratativa já encerrada.' }
  const r = txt(reason, 500)
  if (!r) return { ok: false, error: 'Diga o motivo do cancelamento.' }
  const now = new Date().toISOString()
  await c.db.from('action_plans').update({ phase: 'cancelled', cancel_reason: r, closed_at: now, updated_at: now }).eq('id', planId)
  // Ações abertas saem das pendências (e voltam se a tratativa for reaberta)
  await c.db.from('action_plan_items').update({ status: 'cancelled' }).eq('plan_id', planId).in('status', ['pending', 'in_progress'])
  await log(c.db, contractId, c.userId, `⛔ Tratativa "${plan.title}" cancelada: ${r}`)
  done(contractId)
  return { ok: true }
}

// Reabre uma tratativa cancelada: volta a Planejar e as ações canceladas voltam a pendentes
export async function reopenActionPlan(contractId: string, planId: string): Promise<Result> {
  const c = await ctx(contractId)
  if ('error' in c) return { ok: false, error: c.error }
  const plan = await loadPlan(c.db, planId, contractId)
  if (!plan) return { ok: false, error: 'Tratativa não encontrada.' }
  if (plan.phase !== 'cancelled') return { ok: false, error: 'Só tratativas canceladas podem ser reabertas.' }
  const now = new Date().toISOString()
  await c.db.from('action_plans').update({ phase: 'plan', cancel_reason: null, closed_at: null, updated_at: now }).eq('id', planId).eq('phase', 'cancelled')
  await c.db.from('action_plan_items').update({ status: 'pending' }).eq('plan_id', planId).eq('status', 'cancelled')
  await log(c.db, contractId, c.userId, `↩️ Tratativa "${plan.title}" reaberta.`)
  done(contractId)
  return { ok: true }
}

// Admin: exclui a tratativa e as ações dela
export async function deleteActionPlan(contractId: string, planId: string): Promise<Result> {
  const me = await getUserAccess()
  if (!me?.isAdmin) return { ok: false, error: 'Só administradores excluem tratativas.' }
  const c = await ctx(contractId)
  if ('error' in c) return { ok: false, error: c.error }
  const plan = await loadPlan(c.db, planId, contractId)
  if (!plan) return { ok: false, error: 'Tratativa não encontrada.' }
  const { error } = await c.db.from('action_plans').delete().eq('id', planId).eq('contract_id', contractId)
  if (error) return { ok: false, error: error.message }
  await log(c.db, contractId, c.userId, `🗑️ Tratativa "${plan.title}" excluída por um administrador.`)
  done(contractId)
  return { ok: true }
}

export async function saveActionPlanSettings(input: ActionPlanSettings): Promise<Result> {
  const me = await getUserAccess()
  if (!me?.isAdmin) return { ok: false, error: 'Só administradores alteram o plano de ação.' }
  const cats = (input.ishikawa_categories ?? []).map(c => ({ key: c.key, label: (c.label ?? '').trim() }))
  if (cats.some(c => !c.label)) return { ok: false, error: 'Toda categoria do Ishikawa precisa de nome.' }
  if (input.tools.ishikawa && cats.length < 2) return { ok: false, error: 'O Ishikawa precisa de ao menos 2 categorias.' }
  for (const k of ['g', 'u', 't'] as const) {
    if ((input.gut_scale?.[k] ?? []).length !== 5 || input.gut_scale[k].some(x => !x?.trim())) {
      return { ok: false, error: 'Preencha a descrição das 5 notas de Gravidade, Urgência e Tendência.' }
    }
  }
  const { high, medium } = input.gut_bands ?? {}
  if (!Number.isInteger(high) || !Number.isInteger(medium) || medium < 1 || high > 125 || medium >= high) {
    return { ok: false, error: 'Faixas da GUT: a prioridade média deve começar abaixo da alta, entre 1 e 125.' }
  }
  if (!availableMethods(input).includes(input.default_method)) return { ok: false, error: 'O método padrão precisa estar ligado.' }
  const clean = resolveActionPlanSettings({ ...input, ishikawa_categories: cats })
  const tenantId = await resolveTenantId()
  const db = await createScopedAdmin(tenantId)
  const { error } = await db.from('organization_settings').update({ action_plan_settings: clean }).eq('tenant_id', tenantId)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/settings/plano-de-acao')
  return { ok: true }
}
