// Fim da visita (sendBeacon): { id, d: milissegundos visíveis, i: interagiu }
import { NextResponse } from 'next/server'
import { endVisit } from '@/lib/analytics/visits-server'

export const dynamic = 'force-dynamic'
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Cache-Control': 'no-store' }

export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: CORS }) }

export async function POST(req: Request) {
  try {
    const t = await req.text()
    if (t.length <= 1000) { const b = JSON.parse(t) as Record<string, unknown>; await endVisit(String(b.id ?? ''), Number(b.d) || 0, b.i === true || b.i === 1) }
  } catch { /* aviso inválido: ignora */ }
  return new NextResponse(null, { status: 204, headers: CORS })
}
