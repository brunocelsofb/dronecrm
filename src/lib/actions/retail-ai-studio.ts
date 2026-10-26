'use server'

// ─── Varejo: Estúdio IA — conta de IA da usuária e banco de imagens ───────────
// Só o administrador da loja. A chave é dela (por usuário), criptografada; ninguém
// mais da empresa usa nem vê. Gerar imagem fica na rota /api/varejo/ia/gerar.

import { revalidatePath } from 'next/cache'
import { hasFeature } from '@/lib/auth/access'
import { requireTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { getSupportSession } from '@/lib/tenant/support'
import { encryptSecret } from '@/lib/ai/tenant-key'
import { checkKey } from '@/lib/retail/ai-providers'
import { defaultModel, isAiProvider, validModel } from '@/lib/retail/ai-studio'
import { MAX_PHOTOS, RETAIL_MEDIA_BUCKET, retailPhotoUrl } from '@/lib/retail/products'
import { insertModelPhoto, readPhotoMeta } from '@/lib/retail/photo-colors'

type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function guard(): Promise<{ tenantId: string; userId: string } | { error: string }> {
  const access = await hasFeature('varejo')
  if (!access) return { error: 'Sem acesso ao módulo Varejo.' }
  if (await getSupportSession()) return { error: 'Acesso de suporte é só leitura.' }
  if (!access.isAdmin) return { error: 'Só a administradora da loja usa o Estúdio IA.' }
  return { tenantId: await requireTenantId(), userId: access.userId }
}

export async function saveAiConnection(provider: string, apiKey: string, model: string): Promise<Result<{ last4: string }>> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  if (!isAiProvider(provider)) return { ok: false, error: 'Escolha Gemini ou ChatGPT.' }
  const key = String(apiKey ?? '').trim()
  if (key.length < 20 || key.length > 300 || /\s/.test(key)) return { ok: false, error: 'Chave inválida. Copie a chave inteira, sem espaços.' }
  const bad = await checkKey(provider, key)
  if (bad) return { ok: false, error: bad }
  const db = await createScopedAdmin(g.tenantId)
  const row = { user_id: g.userId, provider, key_enc: encryptSecret(key), key_last4: key.slice(-4), model: validModel(provider, model) ? model : defaultModel(provider), updated_at: new Date().toISOString() }
  const { data: ex } = await db.from('retail_ai_connections').select('id').eq('user_id', g.userId).eq('provider', provider).maybeSingle()
  const { error } = ex ? await db.from('retail_ai_connections').update(row).eq('id', ex.id) : await db.from('retail_ai_connections').insert(row)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/varejo/estudio')
  return { ok: true, last4: key.slice(-4) }
}

export async function setAiModel(provider: string, model: string): Promise<Result> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  if (!isAiProvider(provider) || !validModel(provider, model)) return { ok: false, error: 'Modelo inválido.' }
  const db = await createScopedAdmin(g.tenantId)
  await db.from('retail_ai_connections').update({ model, updated_at: new Date().toISOString() }).eq('user_id', g.userId).eq('provider', provider)
  revalidatePath('/varejo/estudio')
  return { ok: true }
}

export async function removeAiConnection(provider: string): Promise<Result> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  if (!isAiProvider(provider)) return { ok: false, error: 'Conexão inválida.' }
  const db = await createScopedAdmin(g.tenantId)
  await db.from('retail_ai_connections').delete().eq('user_id', g.userId).eq('provider', provider)
  revalidatePath('/varejo/estudio')
  return { ok: true }
}

export async function deleteAiImage(id: string): Promise<Result> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  if (!UUID.test(id)) return { ok: false, error: 'Imagem inválida.' }
  const db = await createScopedAdmin(g.tenantId)
  const { data: img } = await db.from('retail_ai_images').select('id, path').eq('id', id).maybeSingle()
  if (!img) return { ok: false, error: 'Imagem não encontrada.' }
  const url = retailPhotoUrl(img.path as string)
  const [{ count: inLooks }, { count: inHero }, { data: inProducts }] = await Promise.all([
    db.from('retail_looks').select('id', { count: 'exact', head: true }).eq('cover_photo', url),
    db.from('retail_storefronts').select('id', { count: 'exact', head: true }).or(`hero_photo.eq.${url},hero_photo_mobile.eq.${url}`),
    db.from('retail_products').select('code').contains('photos', [img.path as string]).limit(3),
  ])
  if (inLooks || inHero) return { ok: false, error: 'Esta imagem está publicada (capa de look ou da vitrine). Troque a capa antes de excluir.' }
  if (inProducts?.length) return { ok: false, error: `Esta imagem está na peça ${inProducts.map(p => p.code).join(', ')}. Remova a foto da peça (Produtos → Fotos) antes de excluir.` }
  await db.storage.from(RETAIL_MEDIA_BUCKET).remove([img.path as string])
  await db.from('retail_ai_images').delete().eq('id', id)
  revalidatePath('/varejo/estudio')
  return { ok: true }
}

// Publicar: capa de um look ou capa da vitrine (computador/celular)
export async function publishAiImage(id: string, target: { look?: string | null; hero?: 'desktop' | 'mobile' | null }): Promise<Result> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  if (!UUID.test(id)) return { ok: false, error: 'Imagem inválida.' }
  const db = await createScopedAdmin(g.tenantId)
  const { data: img } = await db.from('retail_ai_images').select('path').eq('id', id).maybeSingle()
  if (!img) return { ok: false, error: 'Imagem não encontrada.' }
  const url = retailPhotoUrl(img.path as string)
  if (target.look) {
    if (!UUID.test(target.look)) return { ok: false, error: 'Look inválido.' }
    const { data, error } = await db.from('retail_looks').update({ cover_photo: url, updated_at: new Date().toISOString() }).eq('id', target.look).select('id').maybeSingle()
    if (error || !data) return { ok: false, error: error?.message ?? 'Look não encontrado.' }
  } else if (target.hero) {
    const { data: sf } = await db.from('retail_storefronts').select('id').maybeSingle()
    if (!sf) return { ok: false, error: 'Configure a vitrine primeiro (Varejo → Vitrine).' }
    await db.from('retail_storefronts').update({ [target.hero === 'mobile' ? 'hero_photo_mobile' : 'hero_photo']: url, updated_at: new Date().toISOString() }).eq('id', sf.id)
  } else return { ok: false, error: 'Escolha onde publicar.' }
  revalidatePath('/varejo/estudio'); revalidatePath('/varejo/vitrine')
  return { ok: true }
}

// Lançar no site em um passo: cria o look da vitrine com esta foto de capa e as peças usadas nela
export async function createLookFromAiImage(id: string, input: { name: string; occasion: string | null; description?: string | null }): Promise<Result<{ lookId: string }>> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  if (!UUID.test(id)) return { ok: false, error: 'Imagem inválida.' }
  const name = String(input.name ?? '').trim().slice(0, 80)
  if (!name) return { ok: false, error: 'Dê um nome ao look.' }
  const db = await createScopedAdmin(g.tenantId)
  const { data: img } = await db.from('retail_ai_images').select('path, kind, inputs').eq('id', id).maybeSingle()
  if (!img || img.kind !== 'look') return { ok: false, error: 'Escolha uma foto de look.' }
  const pieces = ((img.inputs as { pieces?: { product_id?: string }[] } | null)?.pieces ?? []).map(p => String(p.product_id ?? '')).filter(x => UUID.test(x))
  const ids = [...new Set(pieces)].slice(0, 12)
  const { data: found } = ids.length ? await db.from('retail_products').select('id').in('id', ids) : { data: [] }
  const productIds = ids.filter(x => (found ?? []).some(f => f.id === x))
  if (!productIds.length) return { ok: false, error: 'As peças desta foto não existem mais. Use "Capa de um look" e escolha as peças na Vitrine.' }
  const occ = input.occasion && /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(input.occasion) ? input.occasion : null
  const { data: last } = await db.from('retail_looks').select('position').order('position', { ascending: false }).limit(1).maybeSingle()
  const { data, error } = await db.from('retail_looks').insert({
    name, occasion: occ, description: String(input.description ?? '').trim().slice(0, 600) || null, product_ids: productIds, cover_photo: retailPhotoUrl(img.path as string), active: true, position: Number(last?.position ?? 0) + 1,
  }).select('id').single()
  if (error || !data) return { ok: false, error: error?.message ?? 'Falha ao criar o look.' }
  revalidatePath('/varejo/estudio'); revalidatePath('/varejo/vitrine')
  return { ok: true, lookId: data.id as string }
}

// Publicar a foto com modelo NA PEÇA, na cor certa (a vitrine mostra essa foto ao escolher a cor).
// Entra junto das outras fotos com modelo, na frente (a primeira foto é a capa do cartão).
// O texto sugerido (editável) vira a descrição da peça, se a pessoa quiser.
export async function publishAiImageToProduct(id: string, input: { productId: string; color: string | null; description?: string | null }): Promise<Result> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  if (!UUID.test(id) || !UUID.test(input.productId)) return { ok: false, error: 'Escolha a peça.' }
  const db = await createScopedAdmin(g.tenantId)
  const [{ data: img }, { data: p }] = await Promise.all([
    db.from('retail_ai_images').select('path, kind').eq('id', id).maybeSingle(),
    db.from('retail_products').select('photos, photo_meta, retail_product_variants(color, active)').eq('id', input.productId).maybeSingle(),
  ])
  if (!img || img.kind !== 'look') return { ok: false, error: 'Escolha uma foto com a modelo vestindo a peça.' }
  if (!p) return { ok: false, error: 'Peça não encontrada.' }
  const path = img.path as string
  const photos = (p.photos as string[] | null) ?? []
  const colors = [...new Set(((p.retail_product_variants ?? []) as { color: string | null; active: boolean }[]).filter(v => v.active && v.color).map(v => v.color as string))]
  const color = input.color && colors.includes(input.color) ? input.color : null
  if (input.color && !color) return { ok: false, error: 'Essa cor não existe na peça.' }
  if (!photos.includes(path) && photos.length >= MAX_PHOTOS) return { ok: false, error: `A peça já tem ${MAX_PHOTOS} fotos (o máximo). Remova uma em Produtos → Fotos e publique de novo.` }
  const meta0 = readPhotoMeta(p.photo_meta, photos, colors)
  const nextPhotos = insertModelPhoto(photos, meta0, path)
  const meta = readPhotoMeta({ ...meta0, [path]: { color, model: true } }, nextPhotos, colors)
  const desc = String(input.description ?? '').trim().slice(0, 2000)
  const patch: Record<string, unknown> = { photos: nextPhotos, photo_meta: meta, updated_at: new Date().toISOString() }
  if (desc) patch.description = desc
  const { error } = await db.from('retail_products').update(patch).eq('id', input.productId)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/varejo/estudio'); revalidatePath(`/varejo/produtos/${input.productId}`); revalidatePath('/varejo/produtos')
  return { ok: true }
}
