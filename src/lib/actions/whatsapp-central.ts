'use server'
// Central de atendimento: assumir, transferir e encerrar conversas de números marcados como "Central".
// Regras de quem vê o quê: lib/whatsapp/central.ts
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { resolveTenantId } from '@/lib/tenant/context'
import { channelConfig, getViewer, loadAliases, canReply, userInArea } from '@/lib/whatsapp/central'
import { resolveAreas, accessProfileLabel } from '@/lib/auth/access-profiles'

type Result = { ok: true } | { ok: false; error: string }
export type TransferShare = 'nota' | 'atendimento' | 'tudo'

const last8 = (p: string) => String(p ?? '').replace(/\D/g, '').slice(-8)
const DEFAULT_TRANSFER_MSG = 'Transferimos seu atendimento para {destino}. Em instantes você será atendido(a). 🙏'

async function context(phone: string, instance: string) {
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) return null
  const tenantId = await resolveTenantId()
  const db = await createScopedAdmin(tenantId)
  const aliases = await loadAliases(tenantId)
  const ch = channelConfig(aliases, instance)
  const viewer = await getViewer(tenantId, user.id)
  const { data: st } = await db.from('whatsapp_conversation_status').select('phone, area, atend_started_at, protocol_number')
    .eq('instance_name', instance).ilike('phone', `%${last8(phone)}`).maybeSingle()
  return { user, tenantId, db, aliases, ch, viewer, st: st as null | { phone: string; area: string | null; atend_started_at: string | null; protocol_number: string | null } }
}

type Ctx = NonNullable<Awaited<ReturnType<typeof context>>>

// Fecha as janelas abertas de alguém (ou da fila de uma área) nesta conversa
async function closeWindows(c: Ctx, phone: string, instance: string, who: { userId?: string; queue?: boolean }) {
  let q = c.db.from('whatsapp_access_windows').update({ to_ts: new Date().toISOString() })
    .eq('instance_name', instance).ilike('phone', `%${last8(phone)}`).is('to_ts', null)
  q = who.userId ? q.eq('user_id', who.userId) : q.is('user_id', null)
  await q
}

async function setStatus(c: Ctx, phone: string, instance: string, patch: Record<string, unknown>) {
  const { data } = await c.db.from('whatsapp_conversation_status').update({ ...patch, updated_at: new Date().toISOString() })
    .eq('instance_name', instance).ilike('phone', `%${last8(phone)}`).select('phone')
  if (!data?.length) await c.db.from('whatsapp_conversation_status').insert({ phone, instance_name: instance, ...patch })
}

// Assumir: sai da fila da área e passa a ser o responsável (vê o atendimento atual em diante)
export async function assumeConversation(phone: string, instance: string): Promise<Result> {
  const c = await context(phone, instance)
  if (!c) return { ok: false, error: 'Faça login novamente.' }
  if (c.ch.purpose !== 'central') return { ok: false, error: 'Este número não está marcado como Central.' }
  const area = c.st?.area ?? c.ch.area
  if (!c.viewer.seesAll && !userInArea(c.viewer.area, area)) {
    const r = await canReply(c.tenantId, c.viewer, c.aliases, phone, instance)
    if (!r.ok) return { ok: false, error: 'Esta conversa está na fila de outra área.' }
  }
  const now = new Date().toISOString()
  await closeWindows(c, phone, instance, { queue: true })
  await c.db.from('whatsapp_access_windows').insert({
    phone, instance_name: instance, user_id: c.user.id, area, from_ts: c.st?.atend_started_at ?? now, reason: 'assumiu',
  })
  await c.db.from('whatsapp_conversation_assignments').upsert(
    { phone: c.st?.phone ?? phone, instance_name: instance, assigned_to: c.user.id, assigned_at: now }, { onConflict: 'tenant_id,phone' })
  await setStatus(c, phone, instance, { attend_status: 'em_atendimento' })
  revalidatePath('/whatsapp')
  return { ok: true }
}

// Transferir para uma pessoa ou para a fila de uma área, com nota interna.
// share: 'nota' = quem recebe vê só dali em diante (padrão) · 'atendimento' = o atendimento atual · 'tudo' = todo o histórico
export async function transferConversation(input: {
  phone: string; instance: string; toUser?: string | null; toArea?: string | null; note: string; share?: TransferShare; notifyCustomer?: boolean
}): Promise<Result> {
  const { phone, instance } = input
  const c = await context(phone, instance)
  if (!c) return { ok: false, error: 'Faça login novamente.' }
  if (c.ch.purpose !== 'central') return { ok: false, error: 'Este número não está marcado como Central.' }
  const r = await canReply(c.tenantId, c.viewer, c.aliases, phone, instance)
  if (!r.ok) return { ok: false, error: 'Só quem está atendendo pode transferir.' }
  if (!input.toUser && !input.toArea) return { ok: false, error: 'Escolha para quem transferir.' }
  const note = String(input.note ?? '').trim()
  if (note.length < 3) return { ok: false, error: 'Escreva uma nota para quem vai receber (o que o cliente precisa).' }
  const share: TransferShare = input.share === 'tudo' || input.share === 'atendimento' ? input.share : 'nota'

  let toArea = input.toArea ?? null
  let destino = ''
  const { data: org } = await c.db.from('organization_settings').select('access_areas, profile_features').eq('tenant_id', c.tenantId).maybeSingle()
  const areas = resolveAreas((org as { access_areas?: unknown } | null)?.access_areas, (org as { profile_features?: unknown } | null)?.profile_features)
  if (input.toUser) {
    const { data: p } = await c.db.from('profiles').select('id, full_name, access_profile').eq('id', input.toUser).maybeSingle()
    if (!p) return { ok: false, error: 'Pessoa não encontrada.' }
    toArea = (p.access_profile as string | null) ?? toArea
    destino = (p.full_name as string | null) ?? 'nossa equipe'
  } else {
    destino = `a equipe de ${accessProfileLabel(toArea, areas)}`
  }

  const now = new Date()
  const from = share === 'tudo' ? new Date(0).toISOString()
    : share === 'atendimento' ? (c.st?.atend_started_at ?? now.toISOString()) : now.toISOString()

  // Aviso ao cliente (texto editável em Configurações → Conexões)
  if (input.notifyCustomer !== false) {
    try {
      const alias = (c.aliases as Record<string, unknown>)[Object.keys(c.aliases).find(k => k.toLowerCase() === instance.toLowerCase()) ?? ''] as { transfer_message?: string } | undefined
      const text = String(alias?.transfer_message || DEFAULT_TRANSFER_MSG).replace(/\{destino\}/g, destino)
      const { sendUnlinkedWhatsAppMessage } = await import('@/lib/actions/whatsapp')
      // sai antes de passar a conversa: quem transferiu ainda é o responsável neste momento
      await sendUnlinkedWhatsAppMessage(phone, text, instance)
    } catch (e) { console.error('[central] aviso ao cliente:', e) }
  }

  // Quem transferiu deixa de ver o que vem depois (continua vendo o trecho dele)
  if (!c.viewer.seesAll) await closeWindows(c, phone, instance, { userId: c.user.id })
  await closeWindows(c, phone, instance, { queue: true })
  await c.db.from('whatsapp_access_windows').insert({
    phone, instance_name: instance, user_id: input.toUser ?? null, area: toArea, from_ts: from, reason: 'transferencia',
  })
  const { error } = await c.db.from('whatsapp_transfers').insert({
    phone, instance_name: instance, from_user: c.user.id, from_area: c.viewer.area, to_user: input.toUser ?? null, to_area: toArea,
    note: note.slice(0, 2000), share, protocol: c.st?.protocol_number ?? null,
  })
  if (error) return { ok: false, error: error.message }

  if (input.toUser) {
    await c.db.from('whatsapp_conversation_assignments').upsert(
      { phone: c.st?.phone ?? phone, instance_name: instance, assigned_to: input.toUser, assigned_at: now.toISOString() }, { onConflict: 'tenant_id,phone' })
  } else {
    await c.db.from('whatsapp_conversation_assignments').delete().ilike('phone', `%${last8(phone)}`)
  }
  await setStatus(c, phone, instance, { area: toArea, attend_status: input.toUser ? 'em_atendimento' : 'nova' })

  // Aviso a quem recebe (sino + WhatsApp + e-mail), sem o conteúdo da conversa
  try {
    const { notifyPerson } = await import('@/lib/agent/handoff')
    const targets = input.toUser ? [input.toUser]
      : (((await c.db.from('profiles').select('id, access_profile')).data ?? []) as { id: string; access_profile: string | null }[])
          .filter(p => userInArea(p.access_profile, toArea) && p.id !== c.user.id).map(p => p.id)
    for (const id of targets.slice(0, 30)) {
      // Para uma pessoa: sino, WhatsApp e e-mail. Para a fila de uma área: só o sino (evita disparo em massa)
      await notifyPerson(c.tenantId, id, { text: `Conversa de WhatsApp transferida para ${input.toUser ? 'você' : destino}. Nota: "${note.slice(0, 300)}"`, subject: 'Conversa transferida para você' },
        input.toUser ? {} : { whatsapp: false, email: false })
    }
  } catch (e) { console.error('[central] aviso de transferência:', e) }

  revalidatePath('/whatsapp')
  return { ok: true }
}

// Pessoas e áreas para o "Transferir"
export async function listTransferTargets(): Promise<{ people: { id: string; name: string; area: string }[]; areas: { id: string; label: string }[] }> {
  const tenantId = await resolveTenantId()
  const db = await createScopedAdmin(tenantId)
  const [{ data: people }, { data: org }] = await Promise.all([
    db.from('profiles').select('id, full_name, access_profile, role').order('full_name'),
    db.from('organization_settings').select('access_areas, profile_features').eq('tenant_id', tenantId).maybeSingle(),
  ])
  const areas = resolveAreas((org as { access_areas?: unknown } | null)?.access_areas, (org as { profile_features?: unknown } | null)?.profile_features)
  return {
    people: ((people ?? []) as { id: string; full_name: string | null; access_profile: string | null; role: string }[])
      .filter(p => p.role !== 'super_admin')
      .map(p => ({ id: p.id, name: p.full_name ?? 'Sem nome', area: accessProfileLabel(p.access_profile ?? 'gestor', areas) })),
    areas: areas.map(a => ({ id: a.id, label: a.label })),
  }
}
