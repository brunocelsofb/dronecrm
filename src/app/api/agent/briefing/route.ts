/**
 * Copiloto Estratégico — API Route
 * GET /api/agent/briefing
 *
 * Cron: Segunda e Quinta às 07h (vercel.json)
 * Toda a lógica de negócio vive em src/lib/agent/briefing-core.ts
 *
 * Env vars: CRON_SECRET, ANTHROPIC_API_KEY, NEXT_PUBLIC_SUPABASE_URL,
 *   SUPABASE_SERVICE_ROLE_KEY, EVOLUTION_API_URL, EVOLUTION_API_KEY,
 *   EVOLUTION_INSTANCE_NAME, WHATSAPP_NUMBER
 */

import { NextRequest, NextResponse } from 'next/server'
import { generateBriefing } from '@/lib/agent/briefing-core'

function isAuthorized(req: NextRequest): boolean {
  const headerSecret = req.headers.get('x-cron-secret')
  const querySecret  = new URL(req.url).searchParams.get('cron_secret')
  const expected     = process.env.CRON_SECRET
  if (!expected) {
    console.warn('[agent] CRON_SECRET não configurado — rota desprotegida!')
    return true
  }
  return headerSecret === expected || querySecret === expected
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    console.warn('[agent] tentativa de acesso não autorizada')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await generateBriefing({ sendViaWhatsApp: true })
    const status = result.ok ? 200 : 500
    return NextResponse.json(result, { status })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    console.error('[agent] erro crítico:', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
