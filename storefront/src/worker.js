// Vitrine do Varejo: as páginas são arquivos estáticos (grátis e sem limite na Cloudflare).
// Este Worker só responde /api/* e repassa ao Drone, com o domínio de onde a cliente abriu
// a vitrine (?host=) ou o endereço de teste (?loja=). Assim cada loja usa o seu domínio
// sem nada fixo aqui: quem decide qual loja é o Drone (Varejo → Vitrine).

const CATALOG_TTL = 60 // segundos de cache do catálogo na Cloudflare

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request)
    try {
      if (url.pathname === '/api/catalogo' && request.method === 'GET') return await catalog(request, url, env, ctx)
      if (url.pathname === '/api/pedido' && request.method === 'POST') return await order(request, url, env)
      return json({ error: 'Não encontrado.' }, 404)
    } catch (e) {
      console.error('vitrine', e && e.message)
      return json({ error: 'A loja não respondeu agora. Tente de novo em instantes.' }, 502)
    }
  },
}

export function storeParams(url) {
  const p = new URLSearchParams()
  const loja = (url.searchParams.get('loja') || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40)
  if (loja) p.set('loja', loja)
  p.set('host', url.hostname)
  return p.toString()
}

async function catalog(request, url, env, ctx) {
  const target = `${env.DRONE_API}/loja?${storeParams(url)}`
  const cache = caches.default
  const key = new Request(target, { method: 'GET' })
  const hit = await cache.match(key)
  if (hit) return hit
  const r = await fetch(target, { headers: { Accept: 'application/json' } })
  const res = new Response(r.body, { status: r.status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': r.ok ? `public, max-age=${CATALOG_TTL}` : 'no-store' } })
  if (r.ok) ctx.waitUntil(cache.put(key, res.clone()))
  return res
}

async function order(request, url, env) {
  const body = await request.text()
  if (body.length > 20000) return json({ error: 'Pedido grande demais.' }, 413)
  const r = await fetch(`${env.DRONE_API}/pedido?${storeParams(url)}`, {
    method: 'POST', body, headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  })
  return new Response(r.body, { status: r.status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } })
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } })
}
