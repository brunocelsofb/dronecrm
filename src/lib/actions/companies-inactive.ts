'use server'

// Empresas inativas → lista no Marketing (botão da tela Empresas inativas).
// A rodada semanal do Hunter fica em src/lib/companies/inactive-hunter.ts (só cron).

import { revalidatePath } from 'next/cache'
import { getUserAccess } from '@/lib/auth/access'
import { resolveTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

// Cria (ou reaproveita) a lista dinâmica "Inativos — segmento" no Marketing
export async function createInactiveMarketingList(segment: string | null): Promise<{ ok: true; id: string; existed: boolean } | { ok: false; error: string }> {
  const me = await getUserAccess()
  if (!me || !(me.isAdmin || me.features.includes('marketing'))) return { ok: false, error: 'Sem acesso à aba Marketing.' }
  const db = await createScopedAdmin(await resolveTenantId())
  const seg = segment?.trim() || null
  const name = `Inativos — ${seg ?? 'todos os segmentos'}`.slice(0, 120)
  const { data: found } = await db.from('marketing_lists').select('id').eq('audience', 'inativos').eq('name', name).maybeSingle()
  if (found) return { ok: true, id: found.id as string, existed: true }
  const { data, error } = await db.from('marketing_lists').insert({
    name, audience: 'inativos', filters: { segments: seg ? [seg] : [] }, created_by: me.userId, updated_at: new Date().toISOString(),
  }).select('id').single()
  if (error || !data) return { ok: false, error: error?.message ?? 'Não foi possível criar a lista.' }
  revalidatePath('/marketing')
  return { ok: true, id: data.id as string, existed: false }
}
