// ─── Varejo: vitrine pública (servidor) ───────────────────────────────────────
// A vitrine fica na Cloudflare e chama a API pública do Drone. Aqui: achar a loja
// pelo domínio ou endereço, montar o catálogo (sem custo, sem saldo exato) e gravar
// o pedido como "Novo pedido" no funil, com a cliente e o link para o WhatsApp.
// Rotina pública: cliente admin preso à empresa da vitrine encontrada.

import { createAdminClient } from '@/lib/supabase/admin'
import { scopeAdminClient } from '@/lib/tenant/scoped-admin'
import { getPublicBranding } from '@/lib/utils/public-branding'
import { effectivePrice, retailPhotoUrl } from '@/lib/retail/products'
import { priceItems, round2 } from '@/lib/retail/pricing'
import { notifyStoreAdmins } from '@/lib/retail/checkout-server'
import { fmtBRL } from '@/lib/format'
import { cleanDomain, cleanSlug, readContent, readOccasions, readTheme, storefrontWhatsappText, type Occasion, type StorefrontContent, type StorefrontOrderInput, type StorefrontTheme } from '@/lib/retail/storefront'

export type StorefrontRow = {
  id: string; tenant_id: string; slug: string; domains: string[]; enabled: boolean; whatsapp: string | null
  title: string | null; tagline: string | null; about: string | null; hero_photo: string | null; hero_photo_mobile: string | null; content: unknown; occasions: unknown; theme: unknown
}

// Loja pelo domínio (ex.: amaras.com.br) ou pelo endereço de teste (?loja=amaras). Só vitrines ligadas.
export async function findStorefront(q: { host?: string | null; slug?: string | null }): Promise<StorefrontRow | null> {
  const admin = createAdminClient()
  const cols = 'id, tenant_id, slug, domains, enabled, whatsapp, title, tagline, about, hero_photo, hero_photo_mobile, content, occasions, theme'
  const slug = cleanSlug(q.slug)
  if (slug) {
    const { data } = await admin.from('retail_storefronts').select(cols).eq('slug', slug).eq('enabled', true).maybeSingle()
    if (data) return data as StorefrontRow
  }
  const host = cleanDomain(q.host)
  if (host) {
    const { data } = await admin.from('retail_storefronts').select(cols).contains('domains', [host]).eq('enabled', true).maybeSingle()
    if (data) return data as StorefrontRow
  }
  return null
}

export type PublicProduct = {
  id: string; code: string; name: string; category: string | null; description: string | null; composition: string | null; care: string | null; measures: string | null
  price: number; promo_price: number | null; final_price: number; photos: string[]; occasions: string[]; is_new: boolean
  variants: { id: string; color: string | null; size: string | null; available: boolean; last_units: boolean }[]
}
export type PublicLook = { id: string; name: string; occasion: string | null; description: string | null; cover: string | null; product_ids: string[] }
export type PublicCatalog = {
  store: { name: string; slug: string; tagline: string | null; about: string | null; logo: string | null; hero: string | null; hero_mobile: string | null; whatsapp: string | null; theme: StorefrontTheme; occasions: Occasion[]; content: StorefrontContent }
  categories: string[]
  products: PublicProduct[]
  looks: PublicLook[]
  updated_at: string
}

const photoUrl = (p: string | null | undefined) => (!p ? null : /^https:\/\//.test(p) ? p : retailPhotoUrl(p))

export async function loadCatalog(sf: StorefrontRow): Promise<PublicCatalog> {
  const db = scopeAdminClient(createAdminClient(), sf.tenant_id, null)
  const [branding, { data: prods }, { data: looks }] = await Promise.all([
    getPublicBranding(sf.tenant_id),
    db.from('retail_products')
      .select('id, code, name, category, description, composition, care, measures, price, promo_price, photos, occasions, created_at, retail_product_variants(id, color, size, stock, active)')
      .eq('status', 'publicado').order('created_at', { ascending: false }).limit(1000),
    db.from('retail_looks').select('id, name, occasion, description, cover_photo, product_ids').eq('active', true).order('position').limit(100),
  ])
  type P = { id: string; code: string; name: string; category: string | null; description: string | null; composition: string | null; care: string | null; measures: string | null; price: number; promo_price: number | null; photos: string[] | null; occasions: string[] | null; created_at: string; retail_product_variants: { id: string; color: string | null; size: string | null; stock: number; active: boolean }[] }
  const recent = Date.now() - 30 * 86_400_000
  const products: PublicProduct[] = ((prods ?? []) as unknown as P[])
    .map(p => {
      const variants = p.retail_product_variants.filter(v => v.active).map(v => ({ id: v.id, color: v.color, size: v.size, available: v.stock > 0, last_units: v.stock > 0 && v.stock <= 2 }))
      return {
        id: p.id, code: p.code, name: p.name, category: p.category, description: p.description, composition: p.composition, care: p.care, measures: p.measures,
        price: Number(p.price), promo_price: p.promo_price === null ? null : Number(p.promo_price),
        final_price: round2(effectivePrice({ price: Number(p.price), promo_price: p.promo_price === null ? null : Number(p.promo_price) })),
        photos: (p.photos ?? []).map(x => photoUrl(x)).filter((x): x is string => !!x), occasions: p.occasions ?? [],
        is_new: Date.parse(p.created_at) >= recent, variants,
      }
    })
    .filter(p => p.variants.some(v => v.available)) // esgotada não aparece
  const ids = new Set(products.map(p => p.id))
  const publicLooks: PublicLook[] = ((looks ?? []) as { id: string; name: string; occasion: string | null; description: string | null; cover_photo: string | null; product_ids: string[] }[])
    .map(l => ({ id: l.id, name: l.name, occasion: l.occasion, description: l.description, product_ids: (l.product_ids ?? []).filter(id => ids.has(id)), cover: photoUrl(l.cover_photo) }))
    .filter(l => l.product_ids.length > 0)
    .map(l => ({ ...l, cover: l.cover ?? products.find(p => p.id === l.product_ids[0])?.photos[0] ?? null }))
  const categories = [...new Set(products.map(p => p.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  return {
    store: {
      name: (sf.title || branding.companyName || 'Loja').trim(), slug: sf.slug, tagline: sf.tagline, about: sf.about,
      logo: branding.logoUrl, hero: photoUrl(sf.hero_photo) ?? products[0]?.photos[0] ?? null, hero_mobile: photoUrl(sf.hero_photo_mobile),
      whatsapp: sf.whatsapp, theme: readTheme(sf.theme), occasions: readOccasions(sf.occasions), content: readContent(sf.content),
    },
    categories, products, looks: publicLooks, updated_at: new Date().toISOString(),
  }
}

// Pedido da vitrine → cliente (pelo telefone) + pedido "Novo pedido" + aviso para a loja
export async function createStorefrontOrder(sf: StorefrontRow, input: StorefrontOrderInput): Promise<{ ok: true; number: number; total: number; whatsappUrl: string | null } | { ok: false; error: string; status: number }> {
  const db = scopeAdminClient(createAdminClient(), sf.tenant_id, null)
  const priced = await priceItems(db, input.items, { storefront: true })
  if (!priced.ok) return { ok: false, error: priced.error, status: 409 }

  // Freio contra abuso: no máximo 5 pedidos novos do mesmo telefone em 24 h
  const { data: existing } = await db.from('retail_customers').select('id, whatsapp_optin, email').eq('phone', input.customer.phone).maybeSingle()
  if (existing) {
    const { count } = await db.from('retail_orders').select('id', { count: 'exact', head: true })
      .eq('customer_id', existing.id).eq('source', 'vitrine').gte('created_at', new Date(Date.now() - 86_400_000).toISOString())
    if ((count ?? 0) >= 5) return { ok: false, error: 'Recebemos vários pedidos deste número hoje. Fale com a loja pelo WhatsApp.', status: 429 }
  }
  const now = new Date().toISOString()
  let customerId = existing?.id as string | undefined
  if (!customerId) {
    const { data, error } = await db.from('retail_customers').insert({
      name: input.customer.name, phone: input.customer.phone, email: input.customer.email, cep: input.customer.cep, source: 'vitrine',
      whatsapp_optin: input.customer.optin, optin_at: input.customer.optin ? now : null,
    }).select('id').single()
    if (error || !data) return { ok: false, error: 'Não foi possível registrar agora. Tente de novo.', status: 500 }
    customerId = data.id as string
  } else {
    const patch: Record<string, unknown> = {}
    if (input.customer.optin && !existing?.whatsapp_optin) { patch.whatsapp_optin = true; patch.optin_at = now }
    if (input.customer.email && !existing?.email) patch.email = input.customer.email
    if (Object.keys(patch).length) await db.from('retail_customers').update(patch).eq('id', customerId)
  }

  const { data: num, error: numErr } = await db.rpc('retail_next_order_number', { p_tenant: sf.tenant_id })
  if (numErr || typeof num !== 'number') return { ok: false, error: 'Não foi possível registrar agora. Tente de novo.', status: 500 }
  const { data: order, error } = await db.from('retail_orders').insert({
    number: num, customer_id: customerId, status: 'carrinho', source: 'vitrine',
    subtotal: priced.subtotal, discount: 0, shipping: 0, total: priced.subtotal,
    delivery: { method: null, cep: input.customer.cep, address: null }, notes: input.note,
  }).select('id, number').single()
  if (error || !order) return { ok: false, error: 'Não foi possível registrar agora. Tente de novo.', status: 500 }
  const { error: itErr } = await db.from('retail_order_items').insert(priced.items.map(i => ({ ...i, order_id: order.id })))
  if (itErr) {
    await db.from('retail_orders').delete().eq('id', order.id)
    return { ok: false, error: 'Não foi possível registrar agora. Tente de novo.', status: 500 }
  }

  const { data: org } = await db.from('organization_settings').select('company_name, name').eq('tenant_id', sf.tenant_id).maybeSingle()
  const store = (sf.title || (org?.company_name as string | null) || (org?.name as string | null) || 'loja').trim()
  await notifyStoreAdmins(sf.tenant_id, `Novo pedido nº ${order.number} da vitrine: ${input.customer.name}, ${fmtBRL(priced.subtotal)} em peças. Está no Funil da loja em "Novo pedido".`)
  const text = storefrontWhatsappText({ store, number: order.number as number, name: input.customer.name, items: priced.items, total: fmtBRL(priced.subtotal) })
  const wa = sf.whatsapp ? `https://wa.me/${sf.whatsapp.length <= 11 ? `55${sf.whatsapp}` : sf.whatsapp}?text=${encodeURIComponent(text)}` : null
  return { ok: true, number: order.number as number, total: priced.subtotal, whatsappUrl: wa }
}
