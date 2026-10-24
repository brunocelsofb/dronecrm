// Catálogo público da vitrine (loja, ocasiões, peças com fotos e preço, looks). Sem custo nem saldo exato.
import type { NextRequest } from 'next/server'
import { findStorefront, loadCatalog } from '@/lib/retail/storefront-server'
import { json, preflight, storeQuery } from '../cors'

export const dynamic = 'force-dynamic'

export function OPTIONS() { return preflight() }

export async function GET(req: NextRequest) {
  const sf = await findStorefront(storeQuery(req.nextUrl))
  if (!sf) return json({ error: 'Loja não encontrada.' }, 404)
  try {
    const catalog = await loadCatalog(sf)
    return json(catalog, 200, { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' })
  } catch (e) {
    console.error('[vitrine] catálogo:', e instanceof Error ? e.message : e)
    return json({ error: 'Catálogo indisponível agora.' }, 500)
  }
}
