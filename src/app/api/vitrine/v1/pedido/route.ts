// Pedido da vitrine: cria (ou acha) a cliente pelo telefone e o pedido em "Novo pedido".
// Preço sempre do banco; só peças publicadas e com saldo; campo escondido barra robôs.
import type { NextRequest } from 'next/server'
import { createStorefrontOrder, findStorefront } from '@/lib/retail/storefront-server'
import { parseStorefrontOrder } from '@/lib/retail/storefront'
import { json, preflight, storeQuery } from '../cors'

export const dynamic = 'force-dynamic'

export function OPTIONS() { return preflight() }

export async function POST(req: NextRequest) {
  const sf = await findStorefront(storeQuery(req.nextUrl))
  if (!sf) return json({ error: 'Loja não encontrada.' }, 404)
  const raw = await req.text()
  if (raw.length > 20_000) return json({ error: 'Pedido grande demais.' }, 413)
  let body: unknown = null
  try { body = JSON.parse(raw) } catch { return json({ error: 'Pedido inválido.' }, 400) }
  const parsed = parseStorefrontOrder(body)
  if (!parsed.ok) return json({ error: parsed.error }, parsed.spam ? 202 : 400)
  try {
    const r = await createStorefrontOrder(sf, parsed.order)
    if (!r.ok) return json({ error: r.error }, r.status)
    return json({ number: r.number, total: r.total, whatsapp_url: r.whatsappUrl, tracking_url: r.trackingUrl }, 201)
  } catch (e) {
    console.error('[vitrine] pedido:', e instanceof Error ? e.message : e)
    return json({ error: 'Não foi possível registrar agora. Tente de novo.' }, 500)
  }
}
