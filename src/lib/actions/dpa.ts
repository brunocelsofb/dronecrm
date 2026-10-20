'use server'

// Aceite eletrônico do Contrato de Tratamento de Dados pelo admin da empresa.

import { createHash } from 'node:crypto'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { getUserAccess } from '@/lib/auth/access'
import { resolveTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { getSupportSession } from '@/lib/tenant/support'
import { DPA_VERSION, dpaPlainText } from '@/lib/legal/dpa'
import { dpaControllerOf } from '@/lib/legal/dpa-data'

export async function acceptDpa(confirmed: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await getUserAccess()
  if (!me?.isAdmin || await getSupportSession()) return { ok: false, error: 'Só o administrador da empresa aceita o contrato.' }
  if (!confirmed) return { ok: false, error: 'Marque que leu e aceita em nome da empresa.' }
  const tenantId = await resolveTenantId()
  const controller = await dpaControllerOf(tenantId)
  const db = await createScopedAdmin(tenantId)
  const { data: prof } = await db.from('profiles').select('full_name, email').eq('id', me.userId).maybeSingle()
  const h = await headers()
  const { error } = await db.from('dpa_acceptances').upsert({
    version: DPA_VERSION,
    accepted_by: me.userId,
    accepted_by_name: (prof?.full_name as string | null) ?? null,
    accepted_by_email: (prof?.email as string | null) ?? null,
    company_name: controller.name, company_cnpj: controller.cnpj,
    ip: (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || null,
    user_agent: (h.get('user-agent') ?? '').slice(0, 300) || null,
    text_hash: createHash('sha256').update(dpaPlainText(controller)).digest('hex'),
    accepted_at: new Date().toISOString(),
  }, { onConflict: 'tenant_id,version', ignoreDuplicates: true })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/settings/privacidade')
  revalidatePath('/', 'layout')
  return { ok: true }
}
