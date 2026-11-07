'use server'

// Mensagem que chegou pelo tempo real (Supabase Realtime) vem cifrada: o navegador
// pede aqui o texto aberto. Só devolve mensagem da empresa de quem pede.

import { getUserAccess } from '@/lib/auth/access'
import { resolveTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

export async function openWhatsAppMessage(id: string): Promise<{ message: string | null; hidden?: boolean } | null> {
  const me = await getUserAccess()
  if (!me || !/^[0-9a-f-]{36}$/i.test(id)) return null
  const db = await createScopedAdmin(await resolveTenantId())
  const { data } = await db.from('contract_whatsapp_messages').select('message, phone, instance_name, created_at').eq('id', id).maybeSingle()
  if (!data) return null
  // Central de atendimento: fora do trecho que esta pessoa pode ver, nem abre
  const { filterVisibleForMe } = await import('@/lib/whatsapp/central')
  if (!(await filterVisibleForMe([data as { phone: string; instance_name: string | null; created_at: string }])).length) return { message: null, hidden: true }
  return { message: (data.message as string | null) ?? null }
}
