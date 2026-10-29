import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/lib/tenant/cron'
import { runAsTenant } from '@/lib/tenant/context'
import { createAdminClient } from '@/lib/supabase/admin'
import { metaConfig, syncMetaAds } from '@/lib/ads/meta-server'

export const maxDuration = 60

// Vercel Cron (vercel.json), todo dia: números dos anúncios do Meta de cada empresa conectada
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!metaConfig()) return NextResponse.json({ ok: true, skipped: 'meta não configurado' })
  const admin = createAdminClient()
  const [{ data: conns }, { data: tenants }] = await Promise.all([
    admin.from('ads_meta_connections').select('tenant_id').not('ad_account_id', 'is', null),
    admin.from('tenants').select('id, is_active'),
  ])
  const active = new Set((tenants ?? []).filter(t => t.is_active).map(t => t.id as string))
  const results: Record<string, unknown> = {}
  for (const c of conns ?? []) {
    const tid = c.tenant_id as string
    if (!active.has(tid)) continue
    results[tid] = await runAsTenant(tid, () => syncMetaAds(tid)).catch(e => ({ ok: false, error: e instanceof Error ? e.message : String(e) }))
  }
  return NextResponse.json({ ok: true, checked_at: new Date().toISOString(), results })
}
