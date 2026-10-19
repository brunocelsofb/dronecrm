// ─── Quem é o número na Central de WhatsApp ───────────────────────────────────
// Nome: o salvo na Central → o do cadastro de contatos (empresa) → nenhum.
// Vínculos: oportunidades/contratos às quais a conversa foi vinculada.
// Chave = 8 últimos dígitos (o mesmo número aparece com ou sem 55/9). Uso só no servidor.

import { createAdminClient } from '@/lib/supabase/admin'
import { phoneKey } from './contact-kind'

export type LinkedAccount = { contractId: string; label: string; number: string | null; companyName: string | null }
export type ContactIdentity = { name: string | null; source: 'manual' | 'cadastro' | null; companyName: string | null; links: LinkedAccount[] }

const splitPhones = (v: unknown) => String(v ?? '').split(/[\/,;]| e /).map(phoneKey).filter(k => k.length === 8)

export async function identifyPhones(tenantId: string, phones: string[]): Promise<Record<string, ContactIdentity>> {
  const keys = new Set(phones.map(phoneKey).filter(k => k.length === 8))
  const out: Record<string, ContactIdentity> = {}
  for (const k of keys) out[k] = { name: null, source: null, companyName: null, links: [] }
  if (!keys.size) return out
  const db = createAdminClient()

  const [{ data: org }, { data: contacts }, { data: linkedMsgs }] = await Promise.all([
    db.from('organization_settings').select('whatsapp_contact_names').eq('tenant_id', tenantId).maybeSingle(),
    db.from('contacts').select('name, phone, company_id').eq('tenant_id', tenantId).not('phone', 'is', null).limit(5000),
    db.from('contract_whatsapp_messages').select('phone, contract_id').eq('tenant_id', tenantId).not('contract_id', 'is', null)
      .order('created_at', { ascending: false }).limit(5000),
  ])

  // Nome salvo na Central (vale mais)
  for (const [p, name] of Object.entries(((org as { whatsapp_contact_names?: Record<string, string> } | null)?.whatsapp_contact_names) ?? {})) {
    const k = phoneKey(p)
    if (out[k] && typeof name === 'string' && name.trim()) out[k] = { ...out[k], name: name.trim(), source: 'manual' }
  }

  // Cadastro de contatos das empresas
  const companyOfKey = new Map<string, string>()
  for (const c of contacts ?? []) {
    for (const k of splitPhones(c.phone)) {
      if (!out[k]) continue
      if (!out[k].name && c.name) out[k] = { ...out[k], name: String(c.name).trim(), source: 'cadastro' }
      if (c.company_id && !companyOfKey.has(k)) companyOfKey.set(k, c.company_id as string)
    }
  }

  // Vínculos com oportunidades/contratos
  const contractsOfKey = new Map<string, Set<string>>()
  for (const m of linkedMsgs ?? []) {
    const k = phoneKey(m.phone)
    if (!out[k]) continue
    const set = contractsOfKey.get(k) ?? new Set<string>()
    set.add(m.contract_id as string)
    contractsOfKey.set(k, set)
  }
  const contractIds = [...new Set([...contractsOfKey.values()].flatMap(s => [...s]))]
  const contractById = new Map<string, { title: string | null; client_name: string | null; process_number: string | null; company_id: string | null }>()
  for (let i = 0; i < contractIds.length; i += 300) {
    const { data } = await db.from('contracts').select('id, title, client_name, process_number, company_id').eq('tenant_id', tenantId).in('id', contractIds.slice(i, i + 300))
    for (const c of data ?? []) contractById.set(c.id as string, c as never)
  }
  const companyIds = [...new Set([...companyOfKey.values(), ...[...contractById.values()].map(c => c.company_id).filter(Boolean) as string[]])]
  const companyName = new Map<string, string>()
  for (let i = 0; i < companyIds.length; i += 300) {
    const { data } = await db.from('companies').select('id, name, trade_name').eq('tenant_id', tenantId).in('id', companyIds.slice(i, i + 300))
    for (const c of data ?? []) companyName.set(c.id as string, (c.trade_name || c.name) as string)
  }

  for (const k of keys) {
    const links: LinkedAccount[] = [...(contractsOfKey.get(k) ?? [])].map(id => {
      const c = contractById.get(id)
      return {
        contractId: id,
        label: c?.client_name || c?.title || 'Oportunidade',
        number: c?.process_number ?? null,
        companyName: c?.company_id ? companyName.get(c.company_id) ?? null : null,
      }
    }).filter(l => contractById.has(l.contractId))
    const comp = companyOfKey.get(k)
    out[k] = { ...out[k], links, companyName: (comp && companyName.get(comp)) || links[0]?.companyName || links[0]?.label || null }
  }
  return out
}
