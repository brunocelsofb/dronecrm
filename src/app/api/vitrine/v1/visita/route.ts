// Visita na vitrine da loja (chamada pelo Worker da vitrine, que repassa o IP e o navegador
// de quem abriu a página nos cabeçalhos x-visitor-ip / x-visitor-ua). Sem cookies.
import type { NextRequest } from 'next/server'
import { findStorefront } from '@/lib/retail/storefront-server'
import { clientIp, recordVisit } from '@/lib/analytics/visits-server'
import { json, preflight, storeQuery } from '../cors'

export const dynamic = 'force-dynamic'
export function OPTIONS() { return preflight() }

export async function POST(req: NextRequest) {
  const sf = await findStorefront(storeQuery(req.nextUrl))
  if (!sf) return json({ ok: false }, 404)
  let b: Record<string, unknown> = {}
  try { const t = await req.text(); if (t.length > 4000) throw new Error(); b = JSON.parse(t) } catch { return json({ ok: false }, 400) }
  const r = await recordVisit({
    tenantId: sf.tenant_id, channel: 'vitrine', href: String(b.u ?? ''), referrer: b.r ? String(b.r) : null, title: b.t ? String(b.t) : null, width: Number(b.w) || null,
    ip: clientIp(req.headers, req.headers.get('x-visitor-ip')), ua: req.headers.get('x-visitor-ua') || req.headers.get('user-agent') || '',
  })
  return json('id' in r ? { ok: true, id: r.id } : { ok: false }, 200, { 'Cache-Control': 'no-store' })
}
