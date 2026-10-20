'use server'

// Busca de conversas na Central de WhatsApp em TODO o histórico da empresa
// (a lista da tela carrega só as conversas mais recentes).
// Procura por: nome do contato/remetente, nome do cliente (contrato), telefone e texto das mensagens.

import { createClient } from '@/lib/supabase/server'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

export type WhatsAppSearchHit = {
  phone: string
  instance: string
  name: string | null
  snippet: string
  matchedBy: 'nome' | 'cliente' | 'telefone' | 'mensagem'
  createdAt: string
  archived: boolean
  department: string | null
  protocol_number: string | null
}

const last8 = (p: string | null | undefined) => (p ?? '').replace(/\D/g, '').slice(-8)

export async function searchWhatsAppConversations(term: string): Promise<{ ok: true; hits: WhatsAppSearchHit[] } | { ok: false; error: string }> {
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) return { ok: false, error: 'Usuário não autenticado.' }

  // Remove caracteres que quebram o filtro (ilike / or)
  const q = (term ?? '').trim().replace(/[%_,()*\\]/g, ' ').replace(/\s+/g, ' ').slice(0, 80)
  const digits = q.replace(/\D/g, '')
  if (q.length < 2) return { ok: true, hits: [] }

  const admin = await createScopedAdmin()
  // Quantas mensagens recentes entram na busca por texto (o texto é cifrado no banco)
  const TEXT_SEARCH_WINDOW = 1000   // limite por consulta do banco
  const cols = 'phone, instance_name, message, unlinked_sender_name, created_at, contract_id'
  type Msg = { phone: string; instance_name: string | null; message: string | null; unlinked_sender_name: string | null; created_at: string; contract_id: string | null }
  const found: { m: Msg; by: WhatsAppSearchHit['matchedBy'] }[] = []

  // 1. Telefone
  if (digits.length >= 4) {
    const { data } = await admin.from('contract_whatsapp_messages').select(cols).ilike('phone', `%${digits}%`).order('created_at', { ascending: false }).limit(200)
    for (const m of (data ?? []) as Msg[]) found.push({ m, by: 'telefone' })
  }

  // 2. Nome de quem mandou (sem cadastro) e texto das mensagens
  const [{ data: byName }, { data: byText }] = await Promise.all([
    admin.from('contract_whatsapp_messages').select(cols).ilike('unlinked_sender_name', `%${q}%`).order('created_at', { ascending: false }).limit(200),
    // O texto das mensagens fica cifrado no banco: busca nas mais recentes já abertas
    q.length >= 3
      ? admin.from('contract_whatsapp_messages').select(cols).not('message', 'is', null).order('created_at', { ascending: false }).limit(TEXT_SEARCH_WINDOW)
      : Promise.resolve({ data: [] as Msg[] }),
  ])
  for (const m of (byName ?? []) as Msg[]) found.push({ m, by: 'nome' })
  const norm = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const needle = norm(q)
  let textHits = 0
  for (const m of (byText ?? []) as Msg[]) {
    if (textHits >= 200) break
    if (m.message && norm(m.message).includes(needle)) { found.push({ m, by: 'mensagem' }); textHits++ }
  }

  // 3. Contatos cadastrados e clientes (contratos) com esse nome
  const [{ data: contacts }, { data: contracts }] = await Promise.all([
    admin.from('contacts').select('name, phone').ilike('name', `%${q}%`).not('phone', 'is', null).limit(30),
    admin.from('contracts').select('id, client_name').ilike('client_name', `%${q}%`).limit(30),
  ])
  const contactNameByPhone = new Map<string, string>()
  for (const c of contacts ?? []) if (last8(c.phone)) contactNameByPhone.set(last8(c.phone), c.name)
  const phones = [...contactNameByPhone.keys()]
  if (phones.length) {
    const { data } = await admin.from('contract_whatsapp_messages').select(cols)
      .or(phones.map(p => `phone.ilike.%${p}`).join(','))
      .order('created_at', { ascending: false }).limit(300)
    for (const m of (data ?? []) as Msg[]) found.push({ m, by: 'nome' })
  }
  const clientById = new Map((contracts ?? []).map(c => [c.id as string, c.client_name as string]))
  if (clientById.size) {
    const { data } = await admin.from('contract_whatsapp_messages').select(cols)
      .in('contract_id', [...clientById.keys()])
      .order('created_at', { ascending: false }).limit(300)
    for (const m of (data ?? []) as Msg[]) found.push({ m, by: 'cliente' })
  }

  // Uma linha por conversa (número + WhatsApp da empresa), com a mensagem mais recente que casou
  const byKey = new Map<string, { m: Msg; by: WhatsAppSearchHit['matchedBy'] }>()
  const rank: Record<WhatsAppSearchHit['matchedBy'], number> = { nome: 0, cliente: 1, telefone: 2, mensagem: 3 }
  for (const f of found) {
    const key = `${f.m.instance_name ?? ''}-${last8(f.m.phone)}`
    const cur = byKey.get(key)
    if (!cur || rank[f.by] < rank[cur.by] || (rank[f.by] === rank[cur.by] && f.m.created_at > cur.m.created_at)) byKey.set(key, f)
  }
  if (byKey.size === 0) return { ok: true, hits: [] }

  // Situação da conversa (arquivada, setor, protocolo)
  const { data: statusRows } = await admin.from('whatsapp_conversation_status').select('phone, instance_name, is_archived, department, protocol_number')
  const statusBy = new Map<string, { is_archived: boolean | null; department: string | null; protocol_number: string | null }>()
  for (const s of statusRows ?? []) statusBy.set(`${s.instance_name ?? ''}-${last8(s.phone)}`, s as never)

  const hits: WhatsAppSearchHit[] = [...byKey.entries()].map(([key, { m, by }]) => {
    const st = statusBy.get(key)
    const name = contactNameByPhone.get(last8(m.phone)) ?? (m.contract_id ? clientById.get(m.contract_id) ?? null : null) ?? m.unlinked_sender_name ?? null
    return {
      phone: m.phone,
      instance: m.instance_name ?? '',
      name,
      snippet: (m.message ?? '').slice(0, 140),
      matchedBy: by,
      createdAt: m.created_at,
      archived: !!st?.is_archived,
      department: st?.department ?? null,
      protocol_number: st?.protocol_number ?? null,
    }
  }).sort((a, b) => (rank[a.matchedBy] - rank[b.matchedBy]) || (b.createdAt.localeCompare(a.createdAt)))

  return { ok: true, hits: hits.slice(0, 50) }
}
