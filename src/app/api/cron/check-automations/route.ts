import { NextRequest, NextResponse } from 'next/server'
import { checkAndTriggerTimeBasedAutomations, checkAndTriggerExpirationAutomations } from '@/lib/actions/automations'
import { checkAndSendWhatsAppCaptureReminders } from '@/lib/actions/whatsapp'
import { isCronAuthorized, forEachActiveTenant } from '@/lib/tenant/cron'

// Vercel Cron (vercel.json). Roda empresa por empresa.
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const results = await forEachActiveTenant(async () => {
    const [progress, expiration, captureReminders] = await Promise.all([
      checkAndTriggerTimeBasedAutomations(),
      checkAndTriggerExpirationAutomations(),
      checkAndSendWhatsAppCaptureReminders(),
    ])
    return { progress, expiration, captureReminders }
  })
  return NextResponse.json({ ok: true, checked_at: new Date().toISOString(), results })
}
