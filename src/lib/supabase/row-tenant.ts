// Empresa (tenant) de uma linha que vai ser gravada com conteúdo cifrado.
// Ordem: tenant_id da linha → contrato → lead → instância de WhatsApp → usuário logado.
// Sem empresa: a linha vai sem cifrar e a rotina diária cifra depois (tenant_id já
// preenchido pelo gatilho do banco). Uso só no servidor.

import { createRawAdminClient } from './admin'

type Row = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' && v ? v : null)

export async function resolveRowTenant(_table: string, row: Row): Promise<string | null> {
  const direct = str(row.tenant_id)
  if (direct) return direct
  const db = createRawAdminClient()
  try {
    const contractId = str(row.contract_id)
    if (contractId) {
      const { data } = await db.from('contracts').select('tenant_id').eq('id', contractId).maybeSingle()
      if (data?.tenant_id) return data.tenant_id as string
    }
    const leadId = str(row.lead_id)
    if (leadId) {
      const { data } = await db.from('leads').select('tenant_id').eq('id', leadId).maybeSingle()
      if (data?.tenant_id) return data.tenant_id as string
    }
    const instance = str(row.instance_name)
    if (instance) {
      const { tenantIdForInstance } = await import('@/lib/tenant/context')
      const t = await tenantIdForInstance(instance)
      if (t) return t
    }
    const { getCurrentTenantId } = await import('@/lib/tenant/context')
    return await getCurrentTenantId()
  } catch {
    return null
  }
}
