'use server'

// Central de WhatsApp → vincular a conversa a uma conta exige cadastrar (ou
// escolher) o contato na empresa da conta. O contato entra na oportunidade e o
// nome passa a aparecer na Central.

import { revalidatePath } from 'next/cache'
import { getUserAccess } from '@/lib/auth/access'
import { resolveTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { phoneKey } from '@/lib/whatsapp/contact-kind'
import { linkUnlinkedWhatsAppConversation, saveUnlinkedContactName } from '@/lib/actions/whatsapp'

export type LinkContext = {
  contract: { id: string; label: string; number: string | null }
  company: { id: string; name: string; cnpj: string | null } | null
  existing: { id: string; name: string; role: string | null; email: string | null }[]   // contatos da empresa com este telefone
  others: { id: string; name: string; role: string | null }[]                            // demais contatos da empresa
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const fmtPhone = (d: string) => {
  const l = d.length > 11 && d.startsWith('55') ? d.slice(2) : d
  return l.length === 11 ? `(${l.slice(0, 2)}) ${l.slice(2, 7)}-${l.slice(7)}` : l.length === 10 ? `(${l.slice(0, 2)}) ${l.slice(2, 6)}-${l.slice(6)}` : d
}

async function allowed() {
  const me = await getUserAccess()
  return me && (me.isAdmin || me.features.includes('whatsapp')) ? me : null
}

export async function getLinkContext(phone: string, contractId: string): Promise<{ ok: true; ctx: LinkContext } | { ok: false; error: string }> {
  if (!(await allowed())) return { ok: false, error: 'Sem acesso à Central de WhatsApp.' }
  const db = await createScopedAdmin(await resolveTenantId())
  const { data: c } = await db.from('contracts').select('id, title, client_name, process_number, company_id').eq('id', contractId).maybeSingle()
  if (!c) return { ok: false, error: 'Conta não encontrada.' }
  let company: LinkContext['company'] = null
  let existing: LinkContext['existing'] = []
  let others: LinkContext['others'] = []
  if (c.company_id) {
    const [{ data: comp }, { data: contacts }] = await Promise.all([
      db.from('companies').select('id, name, trade_name, cnpj').eq('id', c.company_id).maybeSingle(),
      db.from('contacts').select('id, name, role, email, phone').eq('company_id', c.company_id).order('name'),
    ])
    if (comp) company = { id: comp.id as string, name: (comp.trade_name || comp.name) as string, cnpj: (comp.cnpj as string | null) ?? null }
    const key = phoneKey(phone)
    for (const ct of contacts ?? []) {
      const keys = String(ct.phone ?? '').split(/[\/,;]| e /).map(phoneKey)
      if (keys.includes(key)) existing.push({ id: ct.id as string, name: ct.name as string, role: (ct.role as string | null) ?? null, email: (ct.email as string | null) ?? null })
      else others.push({ id: ct.id as string, name: ct.name as string, role: (ct.role as string | null) ?? null })
    }
  }
  existing = existing.slice(0, 10); others = others.slice(0, 50)
  return { ok: true, ctx: { contract: { id: c.id as string, label: (c.client_name || c.title || 'Oportunidade') as string, number: (c.process_number as string | null) ?? null }, company, existing, others } }
}

// Vincula a conversa e garante o contato: escolhido (contactId) ou novo (name…)
export async function linkConversationWithContact(phone: string, contractId: string, input: {
  contactId?: string | null; name?: string; role?: string; email?: string; addPhoneToContact?: boolean
}): Promise<{ ok: true; contactName: string; linkedMessages: boolean } | { ok: false; error: string }> {
  const me = await allowed()
  if (!me) return { ok: false, error: 'Sem acesso à Central de WhatsApp.' }
  const db = await createScopedAdmin(await resolveTenantId())
  const { data: c } = await db.from('contracts').select('id, company_id').eq('id', contractId).maybeSingle()
  if (!c) return { ok: false, error: 'Conta não encontrada.' }
  if (!c.company_id) return { ok: false, error: 'Esta oportunidade não tem empresa. Abra a oportunidade e vincule a empresa antes.' }
  const digits = phone.replace(/\D/g, '')

  let contactId: string
  let contactName: string
  if (input.contactId) {
    const { data: ct } = await db.from('contacts').select('id, name, phone').eq('id', input.contactId).eq('company_id', c.company_id).maybeSingle()
    if (!ct) return { ok: false, error: 'Contato não encontrado nesta empresa.' }
    contactId = ct.id as string
    contactName = ct.name as string
    // Contato escolhido sem este telefone: acrescenta o número no cadastro
    if (input.addPhoneToContact) {
      const keys = String(ct.phone ?? '').split(/[\/,;]| e /).map(phoneKey)
      if (!keys.includes(phoneKey(digits))) {
        const phoneField = ct.phone ? `${ct.phone} / ${fmtPhone(digits)}` : fmtPhone(digits)
        await db.from('contacts').update({ phone: phoneField }).eq('id', contactId)
      }
    }
  } else {
    const name = (input.name ?? '').trim().slice(0, 120)
    if (!name) return { ok: false, error: 'Informe o nome do contato.' }
    const email = (input.email ?? '').trim().slice(0, 200)
    if (email && !EMAIL_RE.test(email)) return { ok: false, error: 'E-mail inválido.' }
    const { data: created, error } = await db.from('contacts').insert({
      company_id: c.company_id, name, role: (input.role ?? '').trim().slice(0, 80) || null,
      email: email || null, phone: fmtPhone(digits), is_primary: false,
    }).select('id').single()
    if (error || !created) return { ok: false, error: error?.message ?? 'Não foi possível cadastrar o contato.' }
    contactId = created.id as string
    contactName = name
  }

  // Contato na oportunidade (principal se for o primeiro)
  const { data: links } = await db.from('contract_contacts').select('contact_id').eq('contract_id', contractId)
  if (!(links ?? []).some(l => l.contact_id === contactId)) {
    const { error } = await db.from('contract_contacts').insert({ contract_id: contractId, contact_id: contactId, is_primary: !(links ?? []).length })
    if (error) return { ok: false, error: error.message }
  }

  // Nome na Central e vínculo das mensagens
  await saveUnlinkedContactName(digits, contactName)
  const r = await linkUnlinkedWhatsAppConversation(digits, contractId)
  const linkedMessages = !r.error
  revalidatePath(`/contracts/${contractId}`)
  revalidatePath(`/companies/${c.company_id}`)
  revalidatePath('/whatsapp')
  return { ok: true, contactName, linkedMessages }
}
