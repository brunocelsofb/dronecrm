'use server'

import { revalidatePath } from 'next/cache'
import { getUserAccess } from '@/lib/auth/access'
import { resolveTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { getSupportSession } from '@/lib/tenant/support'
import { RETENTION_OPTIONS } from '@/lib/privacy/settings'

// Retenção das mensagens de WhatsApp (null = guardar enquanto durar o contrato)
export async function savePrivacySettings(input: { whatsapp_retention_days: number | null }): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await getUserAccess()
  if (!me?.isAdmin || await getSupportSession()) return { ok: false, error: 'Só o administrador da empresa altera a retenção.' }
  const d = input.whatsapp_retention_days
  if (d !== null && !(RETENTION_OPTIONS as readonly number[]).includes(d)) return { ok: false, error: 'Prazo inválido.' }
  const tenantId = await resolveTenantId()
  const db = await createScopedAdmin(tenantId)
  const { error } = await db.from('organization_settings').update({ privacy_settings: { whatsapp_retention_days: d } }).eq('tenant_id', tenantId)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/settings/privacidade')
  return { ok: true }
}
