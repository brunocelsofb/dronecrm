import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized, forEachActiveTenant } from '@/lib/tenant/cron'
import { applyRetention, encryptBacklog } from '@/lib/privacy/routines'

export const maxDuration = 60

// Vercel Cron (vercel.json), todo dia: retenção das mensagens de WhatsApp e
// criptografia do conteúdo antigo, empresa por empresa.
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const results = await forEachActiveTenant(async tenantId => ({
    retention: await applyRetention(tenantId),
    encryption: await encryptBacklog(tenantId),
  }))
  return NextResponse.json({ ok: true, checked_at: new Date().toISOString(), results })
}
