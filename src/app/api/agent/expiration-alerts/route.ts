// /api/agent/expiration-alerts
// CRON diário (configurar no vercel.json):
//   "schedule": "0 8 * * *"  → todo dia às 08h UTC
//
// Autenticação: header Authorization: Bearer <CRON_SECRET>
// O mesmo padrão do /api/agent/briefing

import { NextRequest, NextResponse } from 'next/server'
import { runExpirationAlerts } from '@/lib/agent/expiration-alerts'

export const maxDuration = 60  // segundos — Vercel Pro permite até 300s

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Autenticação por CRON_SECRET ─────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const authHeader = req.headers.get('authorization') ?? ''
    const token      = authHeader.replace(/^Bearer\s+/i, '')
    const query      = new URL(req.url).searchParams.get('cron_secret')
    if (token !== cronSecret && query !== cronSecret) {
      console.warn('[expiration-alerts] token inválido')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  // ── Executa varredura ────────────────────────────────────────────────────
  try {
    console.log('[expiration-alerts] ▶ iniciando via API route')
    const report = await runExpirationAlerts()
    console.log(`[expiration-alerts] ✓ concluído — ${report.total} alertas | ${report.errors.length} erros`)

    return NextResponse.json({
      ok:       true,
      ran_at:   report.ran_at,
      total:    report.total,
      by_level: report.by_level,
      results:  report.results,
      internal_whatsapp: report.internal_whatsapp,
      errors:   report.errors,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[expiration-alerts] erro fatal: ${msg}`)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

// Vercel CRON também chama via GET
export async function GET(req: NextRequest): Promise<NextResponse> {
  return POST(req)
}
