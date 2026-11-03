import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/lib/tenant/cron'
import { backfillStep } from '@/lib/pncp/engine'

export const maxDuration = 300

// Vercel Cron (vercel.json), de hora em hora: carrega um dia antigo de publicações do PNCP
// (país inteiro) até completar a base da pesquisa de Licitações. Sem avisos.
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const started = Date.now()
  const b = await backfillStep(started + 240_000)
  return NextResponse.json({ ok: true, backfill: b, ms: Date.now() - started })
}
