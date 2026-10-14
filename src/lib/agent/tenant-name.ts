// Razão social da conta (tenant) dona do contrato — é o nome que assina os
// e-mails e preenche {{empresa}} nos avisos ao cliente.

import type { SupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

export async function getTenantNamesById(supabase: AnyClient, tenantIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(tenantIds.filter(Boolean))]
  if (ids.length === 0) return new Map()
  const { data } = await supabase.from('tenants').select('id, name').in('id', ids)
  return new Map((data ?? []).filter(t => t.name?.trim()).map(t => [t.id as string, String(t.name).trim()]))
}

export async function getContractTenantName(supabase: AnyClient, contractId: string): Promise<string | null> {
  const { data: c } = await supabase.from('contracts').select('tenant_id').eq('id', contractId).maybeSingle()
  if (!c?.tenant_id) return null
  const names = await getTenantNamesById(supabase, [c.tenant_id as string])
  return names.get(c.tenant_id as string) ?? null
}
