import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/lib/tenant/cron'
import { backfillStep } from '@/lib/pncp/engine'

export const maxDuration = 300

// Vercel Cron (vercel.json), várias vezes ao dia (cada horário é uma rotina diária): carrega dias
// antigos de publicações do PNCP (país inteiro) até completar a base da pesquisa. Sem avisos.
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const started = Date.now()
  const days = []
  while (Date.now() - started < 200_000) {
    const b = await backfillStep(started + 240_000)
    days.push(b)
    if (b.done || b.partial) break
  }
  return NextResponse.json({ ok: true, days, ms: Date.now() - started })
}
