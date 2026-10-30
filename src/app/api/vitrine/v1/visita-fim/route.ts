// Fim da visita na vitrine: { id, d: milissegundos visíveis, i: interagiu }
import { endVisit } from '@/lib/analytics/visits-server'
import { json, preflight } from '../cors'

export const dynamic = 'force-dynamic'
export function OPTIONS() { return preflight() }

export async function POST(req: Request) {
  try {
    const t = await req.text()
    if (t.length <= 1000) { const b = JSON.parse(t) as Record<string, unknown>; await endVisit(String(b.id ?? ''), Number(b.d) || 0, b.i === true || b.i === 1) }
  } catch { /* ignora */ }
  return json({ ok: true })
}
