'use server'

// ─── Varejo: vitrine (landing) e looks ────────────────────────────────────────
// Configuração da vitrine só o administrador; looks qualquer pessoa da equipe com Varejo.

import { revalidatePath } from 'next/cache'
import { hasFeature } from '@/lib/auth/access'
import { requireTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { getSupportSession } from '@/lib/tenant/support'
import { cleanLongText, cleanText } from '@/lib/retail/products'
import { cleanDomain, cleanSlug, phoneBR, readOccasions, readTheme, STOREFRONT_LIMITS, type Occasion, type StorefrontTheme } from '@/lib/retail/storefront'

type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function guard(adminOnly = false): Promise<{ tenantId: string } | { error: string }> {
  const access = await hasFeature('varejo')
  if (!access) return { error: 'Sem acesso ao módulo Varejo.' }
  if (await getSupportSession()) return { error: 'Acesso de suporte é só leitura.' }
  if (adminOnly && !access.isAdmin) return { error: 'Só o administrador muda a vitrine.' }
  return { tenantId: await requireTenantId() }
}

export type StorefrontInput = {
  enabled: boolean; slug: string; domains: string[]; whatsapp: string
  title: string; tagline: string; about: string; hero_photo: string | null
  occasions: Occasion[]; theme: StorefrontTheme
}

export async function saveRetailStorefront(input: StorefrontInput): Promise<Result> {
  const g = await guard(true)
  if ('error' in g) return { ok: false, error: g.error }
  const slug = cleanSlug(input.slug)
  if (!slug) return { ok: false, error: 'Endereço inválido: use letras, números e hífen (3 a 40).' }
  const domains: string[] = []
  for (const d of input.domains ?? []) {
    if (!String(d ?? '').trim()) continue
    const c = cleanDomain(d)
    if (!c) return { ok: false, error: `Domínio inválido: ${d}. Use só o domínio, ex.: minhaloja.com.br` }
    if (!domains.includes(c)) domains.push(c)
  }
  if (domains.length > STOREFRONT_LIMITS.domains) return { ok: false, error: `Até ${STOREFRONT_LIMITS.domains} domínios.` }
  const whatsapp = input.whatsapp?.trim() ? phoneBR(input.whatsapp) : null
  if (input.whatsapp?.trim() && !whatsapp) return { ok: false, error: 'WhatsApp da loja inválido: use DDD + número.' }
  if (input.enabled && !whatsapp) return { ok: false, error: 'Para ligar a vitrine, informe o WhatsApp da loja (é para onde a cliente vai depois do pedido).' }
  const occasions = readOccasions(input.occasions)
  const hero = input.hero_photo && /^https:\/\//.test(input.hero_photo) ? input.hero_photo.slice(0, 600) : null
  const db = await createScopedAdmin(g.tenantId)
  const row = {
    slug, domains, enabled: !!input.enabled, whatsapp,
    title: cleanText(input.title, 80), tagline: cleanText(input.tagline, 160), about: cleanLongText(input.about, 1500),
    hero_photo: hero, occasions, theme: readTheme(input.theme), updated_at: new Date().toISOString(),
  }
  const { data: existing } = await db.from('retail_storefronts').select('id').eq('tenant_id', g.tenantId).maybeSingle()
  const { error } = existing
    ? await db.from('retail_storefronts').update(row).eq('id', existing.id)
    : await db.from('retail_storefronts').insert(row)
  if (error) {
    if (error.code === '23505') return { ok: false, error: /dom[ií]nio/i.test(error.message) ? 'Este domínio já está em outra vitrine.' : 'Este endereço já está em uso. Escolha outro.' }
    return { ok: false, error: error.message }
  }
  // Ocasião apagada: some das peças e dos looks
  const ids = occasions.map(o => o.id)
  const { data: prods } = await db.from('retail_products').select('id, occasions').limit(5000)
  for (const p of (prods ?? []) as { id: string; occasions: string[] }[]) {
    const keep = (p.occasions ?? []).filter(o => ids.includes(o))
    if (keep.length !== (p.occasions ?? []).length) await db.from('retail_products').update({ occasions: keep }).eq('id', p.id)
  }
  revalidatePath('/varejo/vitrine')
  return { ok: true }
}

export type LookInput = { id?: string | null; name: string; occasion: string | null; description: string; product_ids: string[]; cover_photo: string | null; active: boolean }

export async function saveRetailLook(input: LookInput): Promise<Result<{ id: string }>> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  const name = cleanText(input.name, 80)
  if (!name) return { ok: false, error: 'Dê um nome ao look.' }
  const ids = [...new Set((input.product_ids ?? []).filter(id => UUID.test(id)))].slice(0, 12)
  if (ids.length < 1) return { ok: false, error: 'Escolha ao menos uma peça.' }
  const db = await createScopedAdmin(g.tenantId)
  const { data: found } = await db.from('retail_products').select('id').in('id', ids)
  if ((found ?? []).length !== ids.length) return { ok: false, error: 'Uma das peças não existe mais.' }
  const row = {
    name, occasion: cleanSlug(input.occasion) ?? null, description: cleanLongText(input.description, 600),
    product_ids: ids, cover_photo: input.cover_photo && /^https:\/\//.test(input.cover_photo) ? input.cover_photo.slice(0, 600) : null,
    active: input.active !== false, updated_at: new Date().toISOString(),
  }
  if (input.id) {
    if (!UUID.test(input.id)) return { ok: false, error: 'Look inválido.' }
    const { error } = await db.from('retail_looks').update(row).eq('id', input.id)
    if (error) return { ok: false, error: error.message }
    revalidatePath('/varejo/vitrine')
    return { ok: true, id: input.id }
  }
  const { data: last } = await db.from('retail_looks').select('position').order('position', { ascending: false }).limit(1).maybeSingle()
  const { data, error } = await db.from('retail_looks').insert({ ...row, position: Number(last?.position ?? 0) + 1 }).select('id').single()
  if (error || !data) return { ok: false, error: error?.message ?? 'Falha ao criar o look.' }
  revalidatePath('/varejo/vitrine')
  return { ok: true, id: data.id as string }
}

export async function deleteRetailLook(id: string): Promise<Result> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  if (!UUID.test(id)) return { ok: false, error: 'Look inválido.' }
  const db = await createScopedAdmin(g.tenantId)
  const { error } = await db.from('retail_looks').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/varejo/vitrine')
  return { ok: true }
}

// Sobe ou desce o look na vitrine (troca a posição com o vizinho)
export async function moveRetailLook(id: string, dir: -1 | 1): Promise<Result> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  const db = await createScopedAdmin(g.tenantId)
  const { data } = await db.from('retail_looks').select('id, position').order('position').order('created_at')
  const list = (data ?? []) as { id: string; position: number }[]
  const i = list.findIndex(l => l.id === id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= list.length) return { ok: true }
  await db.from('retail_looks').update({ position: j }).eq('id', list[i].id)
  await db.from('retail_looks').update({ position: i }).eq('id', list[j].id)
  for (const [k, l] of list.entries()) if (k !== i && k !== j && l.position !== k) await db.from('retail_looks').update({ position: k }).eq('id', l.id)
  revalidatePath('/varejo/vitrine')
  return { ok: true }
}
