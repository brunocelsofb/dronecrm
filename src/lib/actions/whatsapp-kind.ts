'use server'

// Selo do contato na Central: a pessoa corrige (ou volta para o automático)

import { revalidatePath } from 'next/cache'
import { getUserAccess } from '@/lib/auth/access'
import { resolveTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { phoneKey, kindOf, type ContactKind, type KindInfo } from '@/lib/whatsapp/contact-kind'

const KINDS: ContactKind[] = ['cliente', 'lead', 'visitante']

export async function setContactKind(phone: string, kind: ContactKind | null): Promise<{ ok: true; info: KindInfo } | { ok: false; error: string }> {
  const me = await getUserAccess()
  if (!me || !(me.isAdmin || me.features.includes('whatsapp'))) return { ok: false, error: 'Sem acesso à Central de WhatsApp.' }
  const key = phoneKey(phone)
  if (key.length !== 8) return { ok: false, error: 'Telefone inválido.' }
  if (kind !== null && !KINDS.includes(kind)) return { ok: false, error: 'Tipo inválido.' }
  const tenantId = await resolveTenantId()
  const db = await createScopedAdmin(tenantId)
  if (kind === null) {
    await db.from('whatsapp_contact_kind').delete().eq('phone', key)
  } else {
    const { error } = await db.from('whatsapp_contact_kind')
      .upsert({ tenant_id: tenantId, phone: key, kind, set_by: me.userId, set_at: new Date().toISOString() }, { onConflict: 'tenant_id,phone' })
    if (error) return { ok: false, error: error.message }
  }
  revalidatePath('/whatsapp')
  return { ok: true, info: await kindOf(tenantId, phone) }
}
