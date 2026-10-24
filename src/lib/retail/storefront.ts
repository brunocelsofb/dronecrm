// ─── Varejo: vitrine pública (regras puras, sem imports — testadas com o Node) ─
// A vitrine (landing) fica fora do Drone (Cloudflare) e conversa com a API pública
// /api/vitrine/v1. Aqui ficam as regras de endereço, ocasiões e o pedido que chega.

export const STOREFRONT_LIMITS = { occasions: 12, domains: 5, items: 30, qty: 20 } as const

export function cleanSlug(v: unknown): string | null {
  const s = String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(s) ? s : null
}

// Domínio da loja: minúsculo, sem protocolo, porta ou caminho. "www." conta como o mesmo domínio.
export function cleanDomain(v: unknown): string | null {
  let s = String(v ?? '').trim().toLowerCase()
  s = s.replace(/^[a-z]+:\/\//, '').split('/')[0].split('?')[0].split(':')[0].replace(/\.$/, '')
  if (s.startsWith('www.')) s = s.slice(4)
  return /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(s) ? s : null
}

export type Occasion = { id: string; name: string }
export function readOccasions(raw: unknown): Occasion[] {
  const out: Occasion[] = []
  const seen = new Set<string>()
  for (const x of Array.isArray(raw) ? raw : []) {
    const name = String((x && typeof x === 'object' ? (x as Record<string, unknown>).name : x) ?? '').replace(/\s+/g, ' ').trim().slice(0, 30)
    const id = cleanSlug((x && typeof x === 'object' ? (x as Record<string, unknown>).id : null) ?? name) ?? cleanSlug(`${name}-x`)
    if (!name || !id || seen.has(id)) continue
    seen.add(id); out.push({ id, name })
    if (out.length >= STOREFRONT_LIMITS.occasions) break
  }
  return out
}

export type StorefrontTheme = { primary: string; accent: string }
const HEX = /^#[0-9a-f]{6}$/i
export function readTheme(raw: unknown): StorefrontTheme {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return { primary: HEX.test(String(r.primary)) ? String(r.primary) : '#1B556B', accent: HEX.test(String(r.accent)) ? String(r.accent) : '#E98C5F' }
}

// Pedido que chega da vitrine
export type StorefrontOrderInput = {
  customer: { name: string; phone: string; email: string | null; cep: string | null; optin: boolean }
  items: { variant_id: string; qty: number }[]
  note: string | null
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function phoneBR(raw: unknown): string | null {
  let d = String(raw ?? '').replace(/\D/g, '')
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2)
  if (d.length === 10 && /^[6-9]/.test(d.slice(2))) d = `${d.slice(0, 2)}9${d.slice(2)}`
  return d.length === 10 || d.length === 11 ? d : null
}

export function parseStorefrontOrder(body: unknown): { ok: true; order: StorefrontOrderInput } | { ok: false; error: string; spam?: boolean } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  if (typeof b.website === 'string' && b.website.trim()) return { ok: false, error: 'Pedido recusado.', spam: true } // campo escondido (robôs)
  const c = (b.customer && typeof b.customer === 'object' ? b.customer : {}) as Record<string, unknown>
  const name = String(c.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
  if (name.length < 2) return { ok: false, error: 'Informe seu nome.' }
  const phone = phoneBR(c.phone)
  if (!phone) return { ok: false, error: 'Informe seu WhatsApp com DDD.' }
  const emailRaw = String(c.email ?? '').trim().toLowerCase().slice(0, 160)
  const email = emailRaw ? (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) ? emailRaw : null) : null
  if (emailRaw && !email) return { ok: false, error: 'E-mail inválido.' }
  const cepD = String(c.cep ?? '').replace(/\D/g, '')
  const cep = cepD ? (cepD.length === 8 ? cepD : null) : null
  if (cepD && !cep) return { ok: false, error: 'CEP precisa ter 8 números.' }
  const list = Array.isArray(b.items) ? b.items : []
  if (!list.length) return { ok: false, error: 'Sua sacola está vazia.' }
  if (list.length > STOREFRONT_LIMITS.items) return { ok: false, error: `Até ${STOREFRONT_LIMITS.items} peças por pedido.` }
  const items: { variant_id: string; qty: number }[] = []
  for (const it of list) {
    const x = (it && typeof it === 'object' ? it : {}) as Record<string, unknown>
    const qty = Math.floor(Number(x.qty))
    if (typeof x.variant_id !== 'string' || !UUID.test(x.variant_id) || !Number.isFinite(qty) || qty < 1 || qty > STOREFRONT_LIMITS.qty) return { ok: false, error: 'Item inválido na sacola.' }
    items.push({ variant_id: x.variant_id, qty })
  }
  const note = String(b.note ?? '').trim().slice(0, 500) || null
  return { ok: true, order: { customer: { name, phone, email, cep, optin: c.optin === true }, items, note } }
}

// Mensagem que a cliente manda no WhatsApp da loja depois do pedido
export function storefrontWhatsappText(d: { store: string; number: number; name: string; items: { name: string; color: string | null; size: string | null; qty: number }[]; total: string }): string {
  const first = d.name.split(' ')[0]
  const lines = d.items.map(i => `• ${i.qty}x ${i.name}${[i.color, i.size].filter(Boolean).length ? ` (${[i.color, i.size].filter(Boolean).join(' / ')})` : ''}`)
  return [`Oi! Sou ${first} e acabei de fazer o pedido nº ${d.number} na vitrine da ${d.store}:`, ...lines, `Total das peças: ${d.total}`, 'Pode confirmar tamanho e frete?'].join('\n')
}
