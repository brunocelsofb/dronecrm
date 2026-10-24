// CORS da vitrine pública: os dados do catálogo são públicos; o pedido é validado
// no servidor (preço do banco, saldo, limite por telefone), então qualquer origem pode chamar.
import { NextResponse } from 'next/server'

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
}

export function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...CORS, ...extra } })
}

export function preflight() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

// Loja: ?loja=<endereço> (testes) ou o domínio de onde a vitrine foi aberta (?host=)
export function storeQuery(url: URL) {
  return { slug: url.searchParams.get('loja'), host: url.searchParams.get('host') }
}
