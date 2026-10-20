'use server'

import { revalidatePath } from 'next/cache'
import { getUserAccess } from '@/lib/auth/access'
import { resolveTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { resolveCompanySettings, type CompanySettings } from '@/lib/companies/settings'

export async function saveCompanySettings(input: CompanySettings): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await getUserAccess()
  if (!me?.isAdmin) return { ok: false, error: 'Só administradores alteram estas configurações.' }
  const segs = (input.segments ?? []).map(s => s.trim()).filter(Boolean)
  if (!segs.length) return { ok: false, error: 'Cadastre ao menos um segmento.' }
  if (new Set(segs.map(s => s.toLowerCase())).size !== segs.length) return { ok: false, error: 'Há segmentos repetidos.' }
  if (segs.some(s => s.length > 80)) return { ok: false, error: 'Cada segmento pode ter até 80 caracteres.' }
  if (!Number.isInteger(input.inactive_months) || input.inactive_months < 1 || input.inactive_months > 60) {
    return { ok: false, error: 'O prazo de inatividade deve ser de 1 a 60 meses.' }
  }
  const clean = resolveCompanySettings({ ...input, segments: segs })
  const tenantId = await resolveTenantId()
  const db = await createScopedAdmin(tenantId)
  const { error } = await db.from('organization_settings').update({ company_settings: clean }).eq('tenant_id', tenantId)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/settings/segmentos')
  revalidatePath('/companies')
  return { ok: true }
}

export async function getCompanySettings(): Promise<CompanySettings> {
  const tenantId = await resolveTenantId()
  const db = await createScopedAdmin(tenantId)
  const { data } = await db.from('organization_settings').select('company_settings').eq('tenant_id', tenantId).maybeSingle()
  return resolveCompanySettings((data as { company_settings?: unknown } | null)?.company_settings)
}
