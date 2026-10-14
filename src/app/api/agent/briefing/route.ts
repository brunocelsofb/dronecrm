/**
 * Copiloto Estratégico — API Route
 * GET /api/agent/briefing
 *
 * Cron: 07h de Brasília / 10h UTC, segunda a sexta (vercel.json).
 * Trava: só 1 envio por dia útil (copilot_settings.briefing_last_sent_at);
 * sábado/domingo não envia. ?force=1 ignora a trava (teste manual).
 * Toda a lógica de negócio vive em src/lib/agent/briefing-core.ts
 *
 * Env vars: CRON_SECRET, ANTHROPIC_API_KEY, NEXT_PUBLIC_SUPABASE_URL,
 *   SUPABASE_SERVICE_ROLE_KEY, EVOLUTION_API_URL, EVOLUTION_API_KEY,
 *   EVOLUTION_INSTANCE_NAME (fallback: EVOLUTION_INSTANCE_NOVOS), WHATSAPP_NUMBER
 */

import { NextRequest, NextResponse } from 'next/server'
import { generateBriefing } from '@/lib/agent/briefing-core'
import { createAdminClient } from '@/lib/supabase/admin'

export const maxDuration = 60  // queries + chamada ao modelo + envio WhatsApp

function isAuthorized(req: NextRequest): boolean {
  // O Vercel Cron envia "Authorization: Bearer <CRON_SECRET>"
  const bearer       = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  const headerSecret = req.headers.get('x-cron-secret')
  const querySecret  = new URL(req.url).searchParams.get('cron_secret')
  const expected     = process.env.CRON_SECRET
  if (!expected) {
    console.warn('[agent] CRON_SECRET não configurado — rota desprotegida!')
    return true
  }
  return bearer === expected || headerSecret === expected || querySecret === expected
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    console.warn('[agent] tentativa de acesso não autorizada')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const force = new URL(req.url).searchParams.get('force') === '1'
    const admin = createAdminClient()
    const { data: org } = await admin
      .from('organization_settings').select('copilot_settings').eq('id', 'default').maybeSingle()
    const copilot = (org?.copilot_settings ?? {}) as Record<string, unknown>
    const lastSentAt = typeof copilot.briefing_last_sent_at === 'string' ? copilot.briefing_last_sent_at : null

    // Data/dia da semana em Brasília
    const brNow = new Date(Date.now() - 3 * 3600 * 1000)
    const todayBr = brNow.toISOString().slice(0, 10)
    const weekday = brNow.getUTCDay() // 0 = domingo, 6 = sábado
    if (!force) {
      if (weekday === 0 || weekday === 6) {
        return NextResponse.json({ ok: true, skipped: 'fim de semana — briefing só de segunda a sexta' })
      }
      const lastBr = lastSentAt ? new Date(new Date(lastSentAt).getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10) : null
      if (lastBr === todayBr) {
        return NextResponse.json({ ok: true, skipped: `briefing já enviado hoje (${lastSentAt})` })
      }
    }

    const result = await generateBriefing({
      sendViaWhatsApp: true,
      // Envios de avisos desde o último briefing (segunda pega sexta → domingo)
      renewalSince: lastSentAt ?? new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
    })
    if (result.ok && result.whatsapp.sent) {
      await admin.from('organization_settings')
        .update({ copilot_settings: { ...copilot, briefing_last_sent_at: new Date().toISOString() } })
        .eq('id', 'default')
    }
    const status = result.ok ? 200 : 500
    return NextResponse.json(result, { status })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    console.error('[agent] erro crítico:', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
