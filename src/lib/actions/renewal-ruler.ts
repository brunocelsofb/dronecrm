'use server'

// Régua de renovação: salvar a régua (Admin), iniciar e marcar passos (oportunidade)

import { revalidatePath } from 'next/cache'
import { getUserAccess } from '@/lib/auth/access'
import { isCurrentUserAdmin } from '@/lib/auth/role'
import { resolveTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { resolveRulerSettings, type RulerSettings } from '@/lib/agent/renewal-ruler'
import { startRenewalRuler, completeRulerStep, finishRenewalRuler, openRun } from '@/lib/agent/renewal-ruler-engine'

type Result = { ok: true } | { ok: false; error: string }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function saveRulerSettings(input: RulerSettings): Promise<Result> {
  if (!(await isCurrentUserAdmin())) return { ok: false, error: 'Só administradores alteram a régua de renovação.' }

  // Avisa em vez de descartar sem aviso
  for (const a of input.areas ?? []) {
    if (!a.label?.trim()) return { ok: false, error: 'Toda área precisa de um nome.' }
    const bad = (a.emails ?? []).map(e => e.trim()).filter(e => e && !EMAIL_RE.test(e))
    if (bad.length) return { ok: false, error: `E-mail inválido em "${a.label}": ${bad.join(', ')}` }
  }
  if (!Number.isInteger(input.overdue_repeat_days) || input.overdue_repeat_days < 0 || input.overdue_repeat_days > 30) {
    return { ok: false, error: 'A repetição do aviso de atraso deve ser de 0 a 30 dias (0 = avisa só uma vez).' }
  }
  if (!input.steps?.length) return { ok: false, error: 'Cadastre ao menos um passo.' }
  for (const s of input.steps) {
    if (!s.label?.trim()) return { ok: false, error: 'Todo passo precisa de um nome.' }
    if (!Number.isInteger(s.days_before) || s.days_before < -60 || s.days_before > 365) {
      return { ok: false, error: `"${s.label}": os dias antes do vencimento devem ser de -60 a 365.` }
    }
  }
  for (const [k, v] of Object.entries(input.templates ?? {})) {
    const max = k.endsWith('_subject') ? 200 : 3000
    if (!String(v ?? '').trim()) return { ok: false, error: 'Nenhum texto de e-mail pode ficar vazio.' }
    if (String(v).length > max) return { ok: false, error: `Um dos textos passou de ${max} caracteres.` }
  }

  const clean = resolveRulerSettings({ renewal_ruler: input })
  const tenantId = await resolveTenantId()
  const db = await createScopedAdmin(tenantId)
  const { data, error: readErr } = await db.from('organization_settings').select('copilot_settings').eq('tenant_id', tenantId).maybeSingle()
  if (readErr) return { ok: false, error: readErr.message }
  const current = (data?.copilot_settings ?? {}) as Record<string, unknown>
  const { error } = await db.from('organization_settings')
    .update({ copilot_settings: { ...current, renewal_ruler: clean } }).eq('tenant_id', tenantId)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/settings/regua-renovacao')
  return { ok: true }
}

// Confere que o contrato é desta empresa e que a pessoa pode mexer em contratos
async function guard(contractId: string): Promise<{ tenantId: string; userId: string } | { error: string }> {
  const me = await getUserAccess()
  if (!me) return { error: 'Usuário não autenticado.' }
  const tenantId = await resolveTenantId()
  const db = await createScopedAdmin(tenantId)
  const { data } = await db.from('contracts').select('id').eq('id', contractId).maybeSingle()
  if (!data) return { error: 'Contrato não encontrado.' }
  return { tenantId, userId: me.userId }
}

export async function startRulerManually(contractId: string): Promise<Result> {
  const g = await guard(contractId)
  if ('error' in g) return { ok: false, error: g.error }
  const r = await startRenewalRuler(contractId, { userId: g.userId, firstDone: false })
  if (!r.ok) return r
  if (!r.created) return { ok: false, error: 'A régua deste contrato já está em andamento.' }
  revalidatePath(`/contracts/${contractId}`)
  return { ok: true }
}

export async function markRulerStepDone(contractId: string, runId: string, stepId: string, note?: string): Promise<Result> {
  const g = await guard(contractId)
  if ('error' in g) return { ok: false, error: g.error }
  const r = await completeRulerStep(g.tenantId, runId, stepId, g.userId, note?.trim() || null)
  if (!r.ok) return r
  revalidatePath(`/contracts/${contractId}`)
  return { ok: true }
}

// Admin: cancelar a régua aberta (ex.: iniciada por engano)
export async function cancelRuler(contractId: string): Promise<Result> {
  if (!(await isCurrentUserAdmin())) return { ok: false, error: 'Só administradores cancelam a régua.' }
  const g = await guard(contractId)
  if ('error' in g) return { ok: false, error: g.error }
  if (!(await openRun(g.tenantId, contractId))) return { ok: false, error: 'Não há régua aberta.' }
  await finishRenewalRuler(contractId, 'cancelled')
  revalidatePath(`/contracts/${contractId}`)
  return { ok: true }
}
