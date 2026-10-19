// ─── Selo do contato na Central: Cliente / Lead / Visitante ───────────────────
// Automático:
//   Cliente   = telefone de contato (ou da própria empresa) com contrato ativo na
//               carteira (funil de gestão de contratos com execução aberta), ou
//               conversa vinculada a um contrato ativo da carteira;
//   Lead      = telefone de lead aberto (não convertido nem descartado), ou
//               conversa vinculada a uma oportunidade de vendas aberta;
//   Visitante = nenhum dos dois.
// A pessoa pode corrigir na Central; a correção vale para a empresa toda e para
// o SDR de IA. Chave = 8 últimos dígitos (o mesmo número aparece com ou sem 55/9).
// Uso só no servidor.

import { createAdminClient } from '@/lib/supabase/admin'

export type ContactKind = 'cliente' | 'lead' | 'visitante'
export type KindInfo = { kind: ContactKind; manual: boolean }

export const phoneKey = (p: unknown) => String(p ?? '').replace(/\D/g, '').slice(-8)

export async function classifyPhones(tenantId: string, phones: string[]): Promise<Record<string, KindInfo>> {
  const keys = [...new Set(phones.map(phoneKey).filter(k => k.length === 8))]
  const out: Record<string, KindInfo> = {}
  if (!keys.length) return out
  const db = createAdminClient()

  const { data: manual } = await db.from('whatsapp_contact_kind').select('phone, kind').eq('tenant_id', tenantId).in('phone', keys)
  for (const r of manual ?? []) out[r.phone as string] = { kind: r.kind as ContactKind, manual: true }
  const pending = new Set(keys.filter(k => !out[k]))
  if (!pending.size) return out

  // Empresas com contrato ativo (carteira)
  const { data: pipes } = await db.from('pipelines').select('id').eq('tenant_id', tenantId).eq('type', 'gestao_contratos')
  const pipeIds = (pipes ?? []).map(p => p.id as string)
  let companyIds: string[] = []
  let carteiraContractIds: string[] = []
  if (pipeIds.length) {
    const { data: runs } = await db.from('pipeline_runs').select('contract_id').in('pipeline_id', pipeIds).eq('status', 'open').limit(5000)
    const contractIds = [...new Set((runs ?? []).map(r => r.contract_id as string).filter(Boolean))]
    carteiraContractIds = contractIds
    for (let i = 0; i < contractIds.length; i += 300) {
      const { data: cs } = await db.from('contracts').select('company_id').eq('tenant_id', tenantId).in('id', contractIds.slice(i, i + 300))
      companyIds.push(...(cs ?? []).map(c => c.company_id as string).filter(Boolean))
    }
    companyIds = [...new Set(companyIds)]
  }
  const clientKeys = new Set<string>()
  for (let i = 0; i < companyIds.length; i += 300) {
    const slice = companyIds.slice(i, i + 300)
    const [{ data: contacts }, { data: companies }] = await Promise.all([
      db.from('contacts').select('phone').eq('tenant_id', tenantId).in('company_id', slice).not('phone', 'is', null),
      db.from('companies').select('phone').eq('tenant_id', tenantId).in('id', slice).not('phone', 'is', null),
    ])
    for (const r of [...(contacts ?? []), ...(companies ?? [])]) {
      // Um campo pode ter mais de um número ("62 9999-0000 / 62 3333-0000")
      for (const part of String(r.phone).split(/[\/,;]| e /)) { const k = phoneKey(part); if (k.length === 8) clientKeys.add(k) }
    }
  }

  // Conversas vinculadas a contrato da carteira (cliente) ou a oportunidade de vendas aberta (lead)
  const leadKeys = new Set<string>()
  const { data: salesPipes } = await db.from('pipelines').select('id').eq('tenant_id', tenantId).eq('type', 'vendas')
  const salesIds = (salesPipes ?? []).map(p => p.id as string)
  const { data: salesRuns } = salesIds.length
    ? await db.from('pipeline_runs').select('contract_id').in('pipeline_id', salesIds).eq('status', 'open').limit(5000)
    : { data: [] as { contract_id: string }[] }
  const salesContractIds = new Set((salesRuns ?? []).map(r => r.contract_id as string))
  const carteiraSet = new Set(carteiraContractIds)
  const { data: linked } = await db.from('contract_whatsapp_messages').select('phone, contract_id').eq('tenant_id', tenantId)
    .not('contract_id', 'is', null).order('created_at', { ascending: false }).limit(5000)
  for (const m of linked ?? []) {
    const k = phoneKey(m.phone)
    if (!pending.has(k)) continue
    if (carteiraSet.has(m.contract_id as string)) clientKeys.add(k)
    else if (salesContractIds.has(m.contract_id as string)) leadKeys.add(k)
  }

  // Leads abertos
  const { data: leads } = await db.from('leads').select('phone').eq('tenant_id', tenantId).not('phone', 'is', null)
    .not('status', 'in', '(convertido,descartado)').limit(5000)
  for (const r of leads ?? []) { const k = phoneKey(r.phone); if (k.length === 8) leadKeys.add(k) }

  for (const k of pending) {
    out[k] = { kind: clientKeys.has(k) ? 'cliente' : leadKeys.has(k) ? 'lead' : 'visitante', manual: false }
  }
  return out
}

export async function kindOf(tenantId: string, phone: string): Promise<KindInfo> {
  const k = phoneKey(phone)
  return (await classifyPhones(tenantId, [phone]))[k] ?? { kind: 'visitante', manual: false }
}
