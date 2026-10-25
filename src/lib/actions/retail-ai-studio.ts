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
import { RETAIL_MEDIA_BUCKET, retailPhotoUrl } from '@/lib/retail/products'

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
  const [{ count: inLooks }, { count: inHero }] = await Promise.all([
    db.from('retail_looks').select('id', { count: 'exact', head: true }).eq('cover_photo', url),
    db.from('retail_storefronts').select('id', { count: 'exact', head: true }).or(`hero_photo.eq.${url},hero_photo_mobile.eq.${url}`),
  ])
  if (inLooks || inHero) return { ok: false, error: 'Esta imagem está publicada (capa de look ou da vitrine). Troque a capa antes de excluir.' }
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
