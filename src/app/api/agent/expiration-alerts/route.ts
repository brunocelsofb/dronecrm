// /api/agent/expiration-alerts
// CRON diário (configurar no vercel.json):
//   "schedule": "0 8 * * *"  → todo dia às 08h UTC
//
// Autenticação: header Authorization: Bearer <CRON_SECRET>
// O mesmo padrão do /api/agent/briefing

import { NextRequest, NextResponse } from 'next/server'
import { runExpirationAlerts } from '@/lib/agent/expiration-alerts'
import { createAdminClient } from '@/lib/supabase/admin'
import { createMonthlyImplementationReport } from '@/lib/agent/internal-notices'

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
    const admin = createAdminClient()
    const [{ data: orgs }, { data: tenants }] = await Promise.all([
      admin.from('organization_settings').select('tenant_id'),
      admin.from('tenants').select('id, is_active'),
    ])
    const activeIds = new Set((tenants ?? []).filter(t => t.is_active).map(t => t.id as string))
    const byTenant: Record<string, unknown>[] = []

    // Uma rodada por empresa ativa (contratos, textos e gestor de cada uma)
    for (const o of orgs ?? []) {
      const tenantId = o.tenant_id as string
      if (!activeIds.has(tenantId)) continue
      try {
        const report = await runExpirationAlerts(tenantId)
        let implReport: { status: string; id?: string; detail?: string }
        try {
          implReport = await createMonthlyImplementationReport(tenantId)
        } catch (e) {
          implReport = { status: 'error', detail: e instanceof Error ? e.message : String(e) }
        }
        byTenant.push({
          tenantId,
          total:    report.total,
          by_level: report.by_level,
          results:  report.results,
          internal_whatsapp: report.internal_whatsapp,
          internal_email:    report.internal_email,
          impl_report:       implReport,
          errors:   report.errors,
        })
      } catch (e) {
        byTenant.push({ tenantId, error: e instanceof Error ? e.message : String(e) })
      }
    }

    return NextResponse.json({ ok: true, ran_at: new Date().toISOString(), tenants: byTenant })
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
