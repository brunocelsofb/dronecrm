// ─── Central de atendimento: finalidade dos números e quem vê o quê ──────────
// Cada número (canal) tem uma finalidade, em Configurações → Conexões:
//   shared   → Compartilhado: todos com a aba WhatsApp veem tudo (comportamento de sempre; padrão)
//   central  → Central: só quem tem acesso à conversa vê (regras abaixo)
//   personal → Pessoal do consultor: só o dono do número e o admin
//   private  → Privado: só envio (já existia); o CRM não lê nada
// Na Central, o acesso é por janelas de tempo (whatsapp_access_windows):
//   - a fila da área vê o atendimento atual enquanto ninguém assume;
//   - quem assume ou recebe uma transferência vê a partir do ponto combinado
//     (só a nota = dali em diante; atendimento atual; ou tudo);
//   - quem transferiu continua vendo só o trecho dele.
// Veem tudo: admin, Diretoria e o responsável pela conta do cliente (Farmer dono).
// O corte é feito no servidor: mensagens fora das janelas nem chegam ao navegador.
import { createAdminClient } from '@/lib/supabase/admin'

export type ChannelPurpose = 'shared' | 'central' | 'personal' | 'private'
type AliasValue = string | { label?: string; bot_enabled?: boolean; private?: boolean; purpose?: string; area?: string | null; owner_id?: string | null; user_id?: string | null; transfer_message?: string }
export type ChannelConfig = { purpose: ChannelPurpose; area: string | null; ownerId: string | null; label: string | null }

const norm = (s: string | null | undefined) => String(s ?? '').trim().toLowerCase()

export function channelConfig(aliases: Record<string, AliasValue> | null | undefined, instance: string | null | undefined): ChannelConfig {
  const key = Object.keys(aliases ?? {}).find(k => norm(k) === norm(instance))
  const v = key ? (aliases as Record<string, AliasValue>)[key] : undefined
  if (!v || typeof v === 'string') return { purpose: 'shared', area: null, ownerId: null, label: typeof v === 'string' ? v : null }
  const purpose: ChannelPurpose = v.private === true ? 'private'
    : v.purpose === 'central' ? 'central' : v.purpose === 'personal' ? 'personal' : 'shared'
  // dono do número Pessoal = o consultor já ligado ao WhatsApp em Conexões (user_id)
  return { purpose, area: v.area ?? null, ownerId: v.owner_id ?? v.user_id ?? null, label: v.label ?? null }
}

// Área "comercial" (dos menus de triagem antigos) = Gestor, Hunter e Farmer
const AREA_ALIASES: Record<string, string[]> = { comercial: ['gestor', 'hunter', 'farmer'] }
export function userInArea(userArea: string | null | undefined, area: string | null | undefined): boolean {
  const u = norm(userArea || 'gestor'), a = norm(area)
  if (!a) return false
  return u === a || (AREA_ALIASES[a]?.includes(u) ?? false)
}

export type Viewer = { userId: string; isAdmin: boolean; area: string; seesAll: boolean }

export async function getViewer(tenantId: string, userId: string): Promise<Viewer> {
  const db = createAdminClient()
  const { data: p } = await db.from('profiles').select('role, access_profile').eq('id', userId).eq('tenant_id', tenantId).maybeSingle()
  // Sem perfil nesta empresa = acesso de suporte liberado pelo admin da empresa (só leitura)
  if (!p) return { userId, isAdmin: false, area: 'suporte', seesAll: true }
  const isAdmin = p.role === 'admin'
  const area = (p.access_profile as string | null) || 'gestor'
  return { userId, isAdmin, area, seesAll: isAdmin || area === 'diretoria' }
}

const last8 = (phone: string) => String(phone ?? '').replace(/\D/g, '').slice(-8)
const convKey = (instance: string, phone: string) => `${norm(instance)}|${last8(phone)}`

export type Window = { phone: string; instance_name: string; user_id: string | null; area: string | null; from_ts: string; to_ts: string | null }

// Contas (contratos) dos números, para o Farmer dono ver tudo dos clientes dele
async function ownedPhones(tenantId: string, userId: string, phones: string[]): Promise<Set<string>> {
  const out = new Set<string>()
  if (!phones.length) return out
  try {
    const { identifyPhones } = await import('./contact-identity')
    const ids = await identifyPhones(tenantId, phones)
    const contractIds = new Set<string>()
    for (const who of Object.values(ids)) for (const l of who?.links ?? []) contractIds.add(l.contractId)
    if (!contractIds.size) return out
    const { data } = await createAdminClient().from('contracts').select('id, owner_id, current_assignee_id')
      .eq('tenant_id', tenantId).in('id', [...contractIds])
    const mine = new Set(((data ?? []) as { id: string; owner_id: string | null; current_assignee_id: string | null }[])
      .filter(c => c.owner_id === userId || c.current_assignee_id === userId).map(c => c.id))
    for (const [k, who] of Object.entries(ids)) {
      if ((who?.links ?? []).some(l => mine.has(l.contractId))) out.add(k)
    }
  } catch (e) { console.error('[central] dono da conta:', e) }
  return out
}

export type Access = 'all' | 'none' | { ranges: { from: number; to: number }[] }

// Acesso do usuário a várias conversas de uma vez (inbox)
export async function accessFor(
  tenantId: string, viewer: Viewer, aliases: Record<string, AliasValue> | null | undefined,
  convs: { phone: string; instance: string }[],
): Promise<Map<string, Access>> {
  const res = new Map<string, Access>()
  const centralConvs: { phone: string; instance: string }[] = []
  for (const c of convs) {
    const ch = channelConfig(aliases, c.instance)
    const k = convKey(c.instance, c.phone)
    if (ch.purpose === 'shared') res.set(k, 'all')
    else if (ch.purpose === 'private') res.set(k, 'all') // privada: o CRM não grava nada dela (comportamento de sempre)
    else if (ch.purpose === 'personal') res.set(k, viewer.isAdmin || ch.ownerId === viewer.userId ? 'all' : 'none')
    else if (viewer.seesAll) res.set(k, 'all')
    else centralConvs.push(c)
  }
  if (!centralConvs.length) return res

  const owned = await ownedPhones(tenantId, viewer.userId, centralConvs.map(c => c.phone))
  const db = createAdminClient()
  const instances = [...new Set(centralConvs.map(c => c.instance))]
  const { data: wins } = await db.from('whatsapp_access_windows')
    .select('phone, instance_name, user_id, area, from_ts, to_ts')
    .eq('tenant_id', tenantId).in('instance_name', instances)
  const byConv = new Map<string, Window[]>()
  for (const w of (wins ?? []) as Window[]) {
    const k = convKey(w.instance_name, w.phone)
    byConv.set(k, [...(byConv.get(k) ?? []), w])
  }
  for (const c of centralConvs) {
    const k = convKey(c.instance, c.phone)
    if (owned.has(last8(c.phone))) { res.set(k, 'all'); continue }
    const mine = (byConv.get(k) ?? []).filter(w => w.user_id === viewer.userId || (!w.user_id && userInArea(viewer.area, w.area)))
    res.set(k, mine.length
      ? { ranges: mine.map(w => ({ from: new Date(w.from_ts).getTime(), to: w.to_ts ? new Date(w.to_ts).getTime() : Infinity })) }
      : 'none')
  }
  return res
}

export async function accessForOne(tenantId: string, viewer: Viewer, aliases: Record<string, AliasValue> | null | undefined, phone: string, instance: string): Promise<Access> {
  return (await accessFor(tenantId, viewer, aliases, [{ phone, instance }])).get(convKey(instance, phone)) ?? 'none'
}

export const keyOf = convKey

export function messageVisible(access: Access, createdAt: string): boolean {
  if (access === 'all') return true
  if (access === 'none') return false
  const t = new Date(createdAt).getTime()
  return access.ranges.some(r => t >= r.from && t <= r.to)
}

// Quem pode responder numa conversa da Central: o responsável, ou quem vê tudo
export async function canReply(tenantId: string, viewer: Viewer, aliases: Record<string, AliasValue> | null | undefined, phone: string, instance: string): Promise<{ ok: boolean; reason?: string }> {
  const ch = channelConfig(aliases, instance)
  if (ch.purpose === 'shared') return { ok: true }
  if (ch.purpose === 'private') return { ok: false, reason: 'Número privado: só envio automático.' }
  if (ch.purpose === 'personal') return ch.ownerId === viewer.userId || viewer.isAdmin ? { ok: true } : { ok: false, reason: 'Número pessoal de outro consultor.' }
  if (viewer.seesAll) return { ok: true }
  const { data } = await createAdminClient().from('whatsapp_conversation_assignments').select('assigned_to, phone')
    .eq('tenant_id', tenantId).ilike('phone', `%${last8(phone)}`)
  if ((data ?? []).some(a => a.assigned_to === viewer.userId)) return { ok: true }
  const owned = await ownedPhones(tenantId, viewer.userId, [phone])
  if (owned.size) return { ok: true }
  return { ok: false, reason: 'Assuma a conversa para responder.' }
}

// ─── Abertura de atendimento na Central (chamado pelo webhook) ────────────────
// Abre a janela da fila da área para o atendimento atual (do início do protocolo em diante).
export async function openAreaQueue(args: { tenantId: string; phone: string; instance: string; area: string; startedAt?: string | null; slaMinutes?: number }) {
  const db = createAdminClient()
  let from = args.startedAt ?? null
  if (!from) {
    const { data: st } = await db.from('whatsapp_conversation_status').select('atend_started_at').eq('tenant_id', args.tenantId)
      .eq('instance_name', args.instance).ilike('phone', `%${last8(args.phone)}`).maybeSingle()
    from = (st as { atend_started_at?: string | null } | null)?.atend_started_at ?? new Date().toISOString()
  }
  // fecha filas abertas anteriores desta conversa (mudou de área)
  await db.from('whatsapp_access_windows').update({ to_ts: new Date().toISOString() })
    .eq('tenant_id', args.tenantId).eq('instance_name', args.instance).ilike('phone', `%${last8(args.phone)}`)
    .is('user_id', null).is('to_ts', null)
  await db.from('whatsapp_access_windows').insert({
    tenant_id: args.tenantId, phone: args.phone, instance_name: args.instance, area: args.area, from_ts: from, reason: 'triagem',
  })
  await db.from('whatsapp_conversation_status').update({
    area: args.area, attend_status: 'nova', atend_started_at: from,
    first_response_due_at: new Date(Date.now() + (args.slaMinutes ?? 30) * 60_000).toISOString(), updated_at: new Date().toISOString(),
  }).eq('tenant_id', args.tenantId).eq('instance_name', args.instance).ilike('phone', `%${last8(args.phone)}`)
}

// ─── Filtro único para qualquer leitura de mensagens ─────────────────────────
// Sem número Central/Pessoal configurado, devolve tudo como sempre (nenhuma consulta a mais).
export function hasRestrictedChannels(aliases: Record<string, AliasValue> | null | undefined): boolean {
  return Object.values(aliases ?? {}).some(v => typeof v === 'object' && v !== null && (v.purpose === 'central' || v.purpose === 'personal'))
}

type Msg = { phone?: string | null; instance_name?: string | null; created_at?: string | null }

export async function filterVisible<T extends Msg>(tenantId: string, userId: string, aliases: Record<string, AliasValue> | null | undefined, msgs: T[]): Promise<T[]> {
  if (!msgs.length || !hasRestrictedChannels(aliases)) return msgs
  const viewer = await getViewer(tenantId, userId)
  const convs = new Map<string, { phone: string; instance: string }>()
  for (const m of msgs) {
    if (!m.phone || !m.instance_name) continue
    convs.set(convKey(m.instance_name, m.phone), { phone: m.phone, instance: m.instance_name })
  }
  const acc = await accessFor(tenantId, viewer, aliases, [...convs.values()])
  return msgs.filter(m => {
    if (!m.phone || !m.instance_name) return true
    return messageVisible(acc.get(convKey(m.instance_name, m.phone)) ?? 'all', m.created_at ?? new Date(0).toISOString())
  })
}

export async function loadAliases(tenantId: string): Promise<Record<string, AliasValue>> {
  const { data } = await createAdminClient().from('organization_settings').select('evo_instance_aliases').eq('tenant_id', tenantId).maybeSingle()
  return ((data as { evo_instance_aliases?: Record<string, AliasValue> } | null)?.evo_instance_aliases ?? {})
}

// Para leituras feitas pelo usuário logado (resolve empresa, usuário e números sozinho)
export async function filterVisibleForMe<T extends Msg>(msgs: T[]): Promise<T[]> {
  if (!msgs.length) return msgs
  const [{ resolveTenantId }, { createClient }] = await Promise.all([import('@/lib/tenant/context'), import('@/lib/supabase/server')])
  const tenantId = await resolveTenantId()
  const aliases = await loadAliases(tenantId)
  if (!hasRestrictedChannels(aliases)) return msgs
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) return []
  return filterVisible(tenantId, user.id, aliases, msgs)
}

// Trava de envio: numa conversa da Central só responde quem assumiu (ou quem vê tudo).
// Devolve o motivo do bloqueio, ou null quando pode enviar. Números "Compartilhado" nunca bloqueiam.
export async function replyBlockedReason(userId: string, phone: string, instance: string | null | undefined): Promise<string | null> {
  try {
    const { resolveTenantId } = await import('@/lib/tenant/context')
    const tenantId = await resolveTenantId()
    const { data } = await createAdminClient().from('organization_settings').select('evo_instance_aliases, evo_instance_name').eq('tenant_id', tenantId).maybeSingle()
    const aliases = ((data as { evo_instance_aliases?: Record<string, AliasValue> } | null)?.evo_instance_aliases ?? {})
    if (!hasRestrictedChannels(aliases)) return null
    const inst = instance || (data as { evo_instance_name?: string | null } | null)?.evo_instance_name || ''
    if (channelConfig(aliases, inst).purpose === 'shared') return null
    const r = await canReply(tenantId, await getViewer(tenantId, userId), aliases, phone, inst)
    return r.ok ? null : (r.reason ?? 'Sem permissão para responder esta conversa.')
  } catch (e) {
    console.error('[central] trava de envio:', e)
    return null
  }
}

// Mensagem recebida num número Central sem ninguém com a conversa: abre a fila da área padrão do número.
// Conversa reaberta (estava arquivada) = atendimento novo: fecha os acessos do atendimento anterior.
export async function ensureCentralQueue(a: { tenantId: string; phone: string; instance: string; aliases: Record<string, AliasValue> | null | undefined; reopened: boolean; messageAt: string }) {
  const ch = channelConfig(a.aliases, a.instance)
  if (ch.purpose !== 'central') return
  const db = createAdminClient()
  const conv = () => db.from('whatsapp_access_windows')
  if (a.reopened) {
    await conv().update({ to_ts: a.messageAt }).eq('tenant_id', a.tenantId).eq('instance_name', a.instance)
      .ilike('phone', `%${last8(a.phone)}`).is('to_ts', null)
    await db.from('whatsapp_conversation_assignments').delete().eq('tenant_id', a.tenantId).ilike('phone', `%${last8(a.phone)}`)
  } else {
    const { data: open } = await conv().select('id').eq('tenant_id', a.tenantId).eq('instance_name', a.instance)
      .ilike('phone', `%${last8(a.phone)}`).is('to_ts', null).limit(1)
    if (open?.length) return
  }
  const area = ch.area || 'comercial'
  await conv().insert({ tenant_id: a.tenantId, phone: a.phone, instance_name: a.instance, area, from_ts: a.messageAt, reason: 'nova' })
  const patch = {
    area, attend_status: 'nova', atend_started_at: a.messageAt,
    first_response_due_at: new Date(Date.now() + 30 * 60_000).toISOString(), updated_at: new Date().toISOString(),
  }
  const { data: upd } = await db.from('whatsapp_conversation_status').update(patch).eq('tenant_id', a.tenantId)
    .eq('instance_name', a.instance).ilike('phone', `%${last8(a.phone)}`).select('phone')
  if (!upd?.length) await db.from('whatsapp_conversation_status').insert({ tenant_id: a.tenantId, phone: a.phone, instance_name: a.instance, triage_state: 'none', ...patch })
}
