import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized, forEachActiveTenant } from '@/lib/tenant/cron'
import { syncPublications, watchedUfs, matchTenant, remindDeadlines, pruneOld } from '@/lib/pncp/engine'

export const maxDuration = 300

// Vercel Cron (vercel.json): 08h e 17h de Brasília. Baixa do PNCP as contratações publicadas
// ontem e hoje (só os estados que alguma empresa monitora), confere os monitoramentos de cada
// empresa, avisa quem ela escolheu e lembra os prazos de proposta do que ela vai disputar.
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const started = Date.now()
  const ufs = await watchedUfs()
  const now = new Date()
  const sync = ufs && ufs.length === 0
    ? null   // nenhuma empresa monitora nada: não baixa
    : await syncPublications({ from: new Date(now.getTime() - 86_400_000), to: now, ufs, deadlineMs: started + 200_000 })
  const results = await forEachActiveTenant(async tenantId => ({
    match: sync?.numeros.length ? await matchTenant(tenantId, { numeros: sync.numeros }) : null,
    reminders: await remindDeadlines(tenantId),
  }))
  await pruneOld().catch(() => {})
  return NextResponse.json({ ok: true, sync: sync && { ...sync, numeros: sync.numeros.length }, results, ms: Date.now() - started })
}
