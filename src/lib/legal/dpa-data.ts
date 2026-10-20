// Dados da empresa para o contrato — só servidor (sem 'use server').
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { DPA_VERSION, type DpaParty } from './dpa'

// Dados da empresa que entram no contrato (razão social/CNPJ das Configurações gerais)
export async function dpaControllerOf(tenantId: string): Promise<DpaParty> {
  const db = await createScopedAdmin(tenantId)
  const [{ data: org }, { data: t }] = await Promise.all([
    db.from('organization_settings').select('company_name, company_cnpj, name').eq('tenant_id', tenantId).maybeSingle(),
    db.from('tenants').select('name').eq('id', tenantId).maybeSingle(),
  ])
  const o = (org ?? {}) as { company_name?: string | null; company_cnpj?: string | null; name?: string | null }
  return { name: o.company_name || o.name || (t?.name as string | undefined) || null, cnpj: o.company_cnpj || null }
}


// Aceites da empresa (o mais recente primeiro) e se a versão atual está aceita
export async function dpaStatus(tenantId: string) {
  const db = await createScopedAdmin(tenantId)
  const { data } = await db.from('dpa_acceptances').select('version, accepted_by_name, accepted_by_email, accepted_at, ip, text_hash').order('accepted_at', { ascending: false })
  const list = (data ?? []) as { version: string; accepted_by_name: string | null; accepted_by_email: string | null; accepted_at: string; ip: string | null; text_hash: string }[]
  return { list, current: list.find(a => a.version === DPA_VERSION) ?? null }
}
