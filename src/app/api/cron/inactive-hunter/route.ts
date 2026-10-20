import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized, forEachActiveTenant } from '@/lib/tenant/cron'
import { runInactiveHunter } from '@/lib/companies/inactive-hunter'

export const maxDuration = 60

// Vercel Cron (vercel.json): segunda-feira 08h de Brasília. Empresa por empresa:
// resumo dos clientes inativos ao gestor e tarefas de reativação.
// ?force=1 ignora o dia e a trava (teste manual, exige CRON_SECRET).
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const force = new URL(req.url).searchParams.get('force') === '1'
  const results = await forEachActiveTenant(tenantId => runInactiveHunter(tenantId, { force }))
  return NextResponse.json({ ok: true, checked_at: new Date().toISOString(), results })
}
