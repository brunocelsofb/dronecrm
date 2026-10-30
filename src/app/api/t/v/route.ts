// Visita no site da empresa (código colado no site). Público, sem login, sem cookies.
// Corpo (texto JSON): { e: <empresa>, u: <endereço>, r: <de onde veio>, t: <título>, w: <largura da tela> }
import { NextResponse } from 'next/server'
import { tenantIdForSlug } from '@/lib/tenant/context'
import { clientIp, recordVisit } from '@/lib/analytics/visits-server'

export const dynamic = 'force-dynamic'
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Cache-Control': 'no-store' }

export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: CORS }) }

export async function POST(req: Request) {
  let b: Record<string, unknown> = {}
  try { const t = await req.text(); if (t.length > 4000) throw new Error(); b = JSON.parse(t) } catch { return NextResponse.json({ ok: false }, { status: 400, headers: CORS }) }
  const slug = String(b.e ?? '').trim().slice(0, 80)
  const tenantId = slug ? await tenantIdForSlug(slug) : null
  if (!tenantId) return NextResponse.json({ ok: false }, { status: 404, headers: CORS })
  const r = await recordVisit({ tenantId, channel: 'site', href: String(b.u ?? ''), referrer: b.r ? String(b.r) : null, title: b.t ? String(b.t) : null, width: Number(b.w) || null, ip: clientIp(req.headers), ua: req.headers.get('user-agent') ?? '' })
  return NextResponse.json('id' in r ? { ok: true, id: r.id } : { ok: false }, { headers: CORS })
}
