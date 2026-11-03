import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized, forEachActiveTenant } from '@/lib/tenant/cron'
import { trackParticipations } from '@/lib/pncp/engine'

export const maxDuration = 300

// Vercel Cron (vercel.json): 10h e 19h de Brasília. Para cada empresa, acompanha no PNCP as licitações
// que ela disputa ("Vamos participar" ou que viraram oportunidade): situação dos itens, vencedor e valor.
// Quando muda, avisa quem a empresa escolheu (Licitações → Inteligência) pelos canais escolhidos.
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const started = Date.now()
  const results = await forEachActiveTenant(async tenantId => trackParticipations(tenantId, Date.now() + 50_000))
  return NextResponse.json({ ok: true, results, ms: Date.now() - started })
}
