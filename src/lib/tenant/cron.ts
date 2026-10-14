// Crons da plataforma: autenticação e "uma rodada por empresa ativa".
import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runAsTenant } from './context'

export function isCronAuthorized(req: NextRequest | Request): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) return true
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  const query = new URL(req.url).searchParams.get('cron_secret')
  return bearer === expected || req.headers.get('x-cron-secret') === expected || query === expected
}

export async function forEachActiveTenant<T>(fn: (tenantId: string) => Promise<T>): Promise<Record<string, T | { error: string }>> {
  const admin = createAdminClient()
  const [{ data: orgs }, { data: tenants }] = await Promise.all([
    admin.from('organization_settings').select('tenant_id'),
    admin.from('tenants').select('id, is_active'),
  ])
  const active = new Set((tenants ?? []).filter(t => t.is_active).map(t => t.id as string))
  const out: Record<string, T | { error: string }> = {}
  for (const o of orgs ?? []) {
    const tid = o.tenant_id as string
    if (!active.has(tid)) continue
    try {
      out[tid] = await runAsTenant(tid, () => fn(tid))
    } catch (e) {
      out[tid] = { error: e instanceof Error ? e.message : String(e) }
    }
  }
  return out
}
