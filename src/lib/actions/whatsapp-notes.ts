'use server'
/* eslint-disable @typescript-eslint/no-explicit-any -- linhas de consultas com seleção dinâmica */

// Central de WhatsApp → "Salvar como nota": grava mensagens escolhidas como nota
// na oportunidade, na empresa e/ou no lead ligados ao contato.

import { revalidatePath } from 'next/cache'
import { getUserAccess } from '@/lib/auth/access'
import { resolveTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { createActivity } from '@/lib/actions/activities'
import { phoneKey } from '@/lib/whatsapp/contact-kind'

export type NoteTargets = {
  contracts: { id: string; title: string; company_id: string | null }[]
  companies: { id: string; name: string }[]
  leads: { id: string; name: string }[]
}

async function allowed() {
  const me = await getUserAccess()
  return me && (me.isAdmin || me.features.includes('whatsapp')) ? me : null
}

// Onde dá para gravar: o que a conversa já tem ligado + empresas/oportunidades do contato
export async function getNoteTargets(phone: string): Promise<{ ok: true; targets: NoteTargets } | { ok: false; error: string }> {
  if (!(await allowed())) return { ok: false, error: 'Sem acesso à Central de WhatsApp.' }
  const key = phoneKey(phone)
  if (key.length !== 8) return { ok: false, error: 'Telefone inválido.' }
  const db = await createScopedAdmin(await resolveTenantId())

  const [{ data: msgLinks }, { data: contacts }, { data: comps }, { data: leads }] = await Promise.all([
    db.from('contract_whatsapp_messages').select('contract_id, lead_id').ilike('phone', `%${key}`)
      .or('contract_id.not.is.null,lead_id.not.is.null').order('created_at', { ascending: false }).limit(200),
    db.from('contacts').select('company_id').ilike('phone', `%${key}%`).not('company_id', 'is', null).limit(20),
    db.from('companies').select('id').ilike('phone', `%${key}%`).limit(20),
    db.from('leads').select('id, name').ilike('phone', `%${key}`).order('created_at', { ascending: false }).limit(5),
  ])

  const companyIds = new Set<string>([...(contacts ?? []).map(c => c.company_id as string), ...(comps ?? []).map(c => c.id as string)])
  const contractIds = new Set<string>((msgLinks ?? []).map(m => m.contract_id as string).filter(Boolean))
  const leadIds = new Set<string>([...(msgLinks ?? []).map(m => m.lead_id as string).filter(Boolean), ...(leads ?? []).map(l => l.id as string)])

  // Oportunidades das empresas do contato (as mais recentes)
  if (companyIds.size) {
    const { data } = await db.from('contracts').select('id').in('company_id', [...companyIds]).order('updated_at', { ascending: false }).limit(15)
    for (const c of data ?? []) contractIds.add(c.id as string)
  }
  const [{ data: contractRows }, { data: companyRows }, { data: leadRows }] = await Promise.all([
    contractIds.size ? db.from('contracts').select('id, title, client_name, company_id').in('id', [...contractIds]).limit(20) : Promise.resolve({ data: [] as any[] }),
    companyIds.size ? db.from('companies').select('id, name, trade_name').in('id', [...companyIds]).limit(20) : Promise.resolve({ data: [] as any[] }),
    leadIds.size ? db.from('leads').select('id, name').in('id', [...leadIds]).limit(5) : Promise.resolve({ data: [] as any[] }),
  ])
  // Empresa das oportunidades também entra como destino
  for (const c of contractRows ?? []) if (c.company_id && !companyIds.has(c.company_id)) companyIds.add(c.company_id)
  let companies = (companyRows ?? []).map((c: any) => ({ id: c.id as string, name: (c.trade_name || c.name) as string }))
  const missing = [...companyIds].filter(id => !companies.some(c => c.id === id))
  if (missing.length) {
    const { data } = await db.from('companies').select('id, name, trade_name').in('id', missing)
    companies = [...companies, ...(data ?? []).map((c: any) => ({ id: c.id as string, name: (c.trade_name || c.name) as string }))]
  }
  return {
    ok: true,
    targets: {
      contracts: (contractRows ?? []).map((c: any) => ({ id: c.id, title: c.title || c.client_name || 'Oportunidade', company_id: c.company_id ?? null })),
      companies,
      leads: (leadRows ?? []).map((l: any) => ({ id: l.id, name: l.name || 'Lead' })),
    },
  }
}

export async function saveWhatsAppNote(input: {
  phone: string; messageIds: string[]; comment: string
  contractId?: string | null; companyId?: string | null; leadId?: string | null
}): Promise<{ ok: true; saved: string[] } | { ok: false; error: string }> {
  const me = await allowed()
  if (!me) return { ok: false, error: 'Sem acesso à Central de WhatsApp.' }
  if (!input.contractId && !input.companyId && !input.leadId) return { ok: false, error: 'Escolha onde salvar a nota.' }
  const ids = [...new Set(input.messageIds)].slice(0, 50)
  if (!ids.length) return { ok: false, error: 'Escolha ao menos uma mensagem.' }
  const tenantId = await resolveTenantId()
  const db = await createScopedAdmin(tenantId)

  const { data: msgs } = await db.from('contract_whatsapp_messages')
    .select('id, message, direction, media_type, media_url, media_filename, created_at, unlinked_sender_name, phone')
    .in('id', ids).order('created_at', { ascending: true })
  const key = phoneKey(input.phone)
  const list = (msgs ?? []).filter(m => phoneKey(m.phone) === key)
  if (!list.length) return { ok: false, error: 'Mensagens não encontradas.' }

  // Destinos precisam ser desta empresa (o filtro por empresa já vem do scoped admin)
  const check = async (table: 'contracts' | 'companies' | 'leads', id?: string | null) =>
    !id || !!(await db.from(table).select('id').eq('id', id).maybeSingle()).data
  if (!(await check('contracts', input.contractId)) || !(await check('companies', input.companyId)) || !(await check('leads', input.leadId))) {
    return { ok: false, error: 'Destino da nota não encontrado.' }
  }

  const when = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  const lines = list.map(m => {
    const who = m.direction === 'enviado' ? 'Empresa' : (m.unlinked_sender_name || 'Contato')
    const media = m.media_type ? ` [${m.media_filename || m.media_type}]${m.media_url ? ` ${m.media_url}` : ''}` : ''
    const text = m.media_type && /^\[.*\]$/.test(String(m.message ?? '').trim()) ? '' : String(m.message ?? '').trim()
    return `${when(m.created_at)} · ${who}: ${text}${media}`.trim()
  })
  const comment = input.comment.trim().slice(0, 2000)
  const content = `💬 Via WhatsApp (${input.phone})${comment ? `\n${comment}` : ''}\n\n${lines.join('\n')}`.slice(0, 8000)

  const saved: string[] = []
  if (input.contractId || input.companyId) {
    const r = await createActivity({
      contractId: input.contractId ?? null, companyId: input.companyId ?? null,
      content, title: 'Nota do WhatsApp', activityType: 'note', status: 'done',
    } as Parameters<typeof createActivity>[0])
    if (r.error) return { ok: false, error: r.error }
    if (input.contractId) { saved.push('oportunidade'); revalidatePath(`/contracts/${input.contractId}`) }
    if (input.companyId) { saved.push('empresa'); revalidatePath(`/companies/${input.companyId}`) }
  }
  if (input.leadId) {
    const { error } = await db.from('lead_activities').insert({ lead_id: input.leadId, user_id: me.userId, type: 'note', content })
    if (error) return { ok: false, error: error.message }
    saved.push('lead')
    revalidatePath(`/leads/${input.leadId}`)
  }
  return { ok: true, saved }
}
