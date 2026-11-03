import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized, forEachActiveTenant } from '@/lib/tenant/cron'
import { syncPublications, matchTenant, remindDeadlines, pruneOld, seedWatchers } from '@/lib/pncp/engine'

export const maxDuration = 300

// Vercel Cron (vercel.json): 08h e 17h de Brasília. Baixa do PNCP as contratações publicadas
// ontem e hoje (país inteiro: é a base da pesquisa), confere os monitoramentos de cada empresa,
// avisa quem ela escolheu e lembra os prazos de proposta do que ela vai disputar.
// Também procura por palavra (busca do portal do PNCP) as linhas de cada monitoramento.
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const started = Date.now()
  // Base da pesquisa: país inteiro, todas as modalidades (ontem e hoje)
  const now = new Date()
  const sync = await syncPublications({ from: new Date(now.getTime() - 86_400_000), to: now, ufs: null, deadlineMs: started + 150_000 })
  const results = await forEachActiveTenant(async tenantId => {
    // Também procura no PNCP, por palavra, cada linha dos monitoramentos (pega publicações antigas ainda abertas)
    const seeded = await seedWatchers(tenantId, Date.now() + 25_000).catch(() => [] as string[])
    const numeros = [...new Set([...sync.numeros, ...seeded])]
    return {
      match: numeros.length ? await matchTenant(tenantId, { numeros }) : null,
      reminders: await remindDeadlines(tenantId),
    }
  })
  await pruneOld().catch(() => {})
  return NextResponse.json({ ok: true, sync: { ...sync, numeros: sync.numeros.length }, results, ms: Date.now() - started })
}
