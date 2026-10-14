import { NextRequest, NextResponse } from 'next/server'
import { checkAndTriggerRenewals } from '@/lib/actions/pipeline'
import { isCronAuthorized, forEachActiveTenant } from '@/lib/tenant/cron'

// Vercel Cron (vercel.json). Roda empresa por empresa.
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const results = await forEachActiveTenant(async () => { await checkAndTriggerRenewals(); return { ok: true } })
  return NextResponse.json({ ok: true, checked_at: new Date().toISOString(), results })
}
