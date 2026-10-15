'use server'

// Metas de receita da empresa (licença): cadastradas mês a mês; a meta anual
// é a soma dos 12 meses. Prazo da medição também fica aqui.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { resolveTenantId } from '@/lib/tenant/context'

export type GoalsResult = { ok: true } | { ok: false; error: string }

async function requireAdmin(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Usuário não autenticado.' }
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') return { error: 'Só administradores alteram as metas.' }
  return { userId: user.id }
}

export async function saveYearGoals(year: number, values: (number | null)[]): Promise<GoalsResult> {
  const auth = await requireAdmin()
  if ('error' in auth) return { ok: false, error: auth.error }
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return { ok: false, error: 'Ano inválido.' }
  if (!Array.isArray(values) || values.length !== 12) return { ok: false, error: 'Informe os 12 meses.' }
  for (const v of values) {
    if (v !== null && (!Number.isFinite(v) || v < 0)) return { ok: false, error: 'Valores precisam ser números positivos.' }
  }

  const tenantId = await resolveTenantId()
  const admin = await createScopedAdmin(tenantId)
  const now = new Date().toISOString()
  const rows = values.map((v, i) => ({
    tenant_id: tenantId,
    year,
    month: i + 1,
    target_value: v ?? 0,
    updated_by: auth.userId,
    updated_at: now,
  }))
  const { error } = await admin.from('monthly_goals').upsert(rows, { onConflict: 'tenant_id,year,month' })
  if (error) return { ok: false, error: error.message }

  revalidatePath('/settings/metas')
  revalidatePath('/painel')
  revalidatePath('/')
  return { ok: true }
}

export async function saveMeasurementDueDay(day: number): Promise<GoalsResult> {
  const auth = await requireAdmin()
  if ('error' in auth) return { ok: false, error: auth.error }
  if (!Number.isInteger(day) || day < 1 || day > 28) return { ok: false, error: 'Escolha um dia entre 1 e 28.' }
  const tenantId = await resolveTenantId()
  const admin = await createScopedAdmin(tenantId)
  const { error } = await admin.from('organization_settings').update({ measurement_due_day: day }).eq('tenant_id', tenantId)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/settings/metas')
  return { ok: true }
}
