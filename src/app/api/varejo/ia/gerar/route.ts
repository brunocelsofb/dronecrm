// Estúdio IA: gera uma imagem (modelo virtual, cenário ou foto de look) com a conta de IA
// da própria administradora e guarda no banco de imagens da loja.
import { NextResponse, type NextRequest } from 'next/server'
import { randomUUID } from 'crypto'
import { hasFeature } from '@/lib/auth/access'
import { requireTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { getSupportSession } from '@/lib/tenant/support'
import { decryptSecret } from '@/lib/ai/tenant-key'
import { generateImage } from '@/lib/retail/ai-providers'
import { completeLookBrief, swapColorPrompt, defaultModel, IMAGE_FORMAT, isAiKind, isAiProvider, isPose, MAX_LOOK_PIECES, pieceBrief, validModel } from '@/lib/retail/ai-studio'
import { readContent } from '@/lib/retail/storefront'
import { RETAIL_MEDIA_BUCKET, retailPhotoUrl } from '@/lib/retail/products'

export const dynamic = 'force-dynamic'
export const maxDuration = 120 // geração em 1600×2000 pode passar de 1 minuto

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })

export async function POST(req: NextRequest) {
  const access = await hasFeature('varejo')
  if (!access) return bad('Sem acesso ao módulo Varejo.', 403)
  if (await getSupportSession()) return bad('Acesso de suporte é só leitura.', 403)
  if (!access.isAdmin) return bad('Só a administradora da loja usa o Estúdio IA.', 403)
  const tenantId = await requireTenantId()
  let b: Record<string, unknown>
  try { b = await req.json() } catch { return bad('Pedido inválido.') }
  const provider = b.provider, kind = b.kind
  if (!isAiProvider(provider)) return bad('Escolha Gemini ou ChatGPT.')
  if (!isAiKind(kind)) return bad('Tipo de imagem inválido.')
  const swap = kind === 'look' && typeof b.base_image_id === 'string' && UUID.test(b.base_image_id)
  const base = String(b.prompt ?? '').trim().slice(0, 6000)
  if (base.length < 10 && !swap) return bad('Escreva o pedido para a IA.')
  // Pose escolhida (com 2 fotos, cada pedido vem com uma pose diferente)
  const pose = kind === 'look' && isPose(b.pose) ? String(b.pose) : null
  let prompt = pose ? `${base}\nPose da modelo nesta foto: ${pose}.` : base
  const title = String(b.title ?? '').trim().slice(0, 80) || null

  const db = await createScopedAdmin(tenantId)
  // Conta de IA da própria usuária (nunca a de outra pessoa da empresa)
  const { data: conn } = await db.from('retail_ai_connections').select('key_enc, model').eq('user_id', access.userId).eq('provider', provider).maybeSingle()
  if (!conn) return bad(`Conecte a sua conta ${provider === 'gemini' ? 'do Gemini' : 'do ChatGPT'} no topo do Estúdio.`)
  let key: string
  try { key = decryptSecret(String(conn.key_enc)) } catch { return bad('Não consegui ler a sua chave. Conecte de novo.') }
  const model = validModel(provider, b.model) ? String(b.model) : (conn.model && validModel(provider, conn.model) ? String(conn.model) : defaultModel(provider))

  // Fotos de referência: só da própria loja (peças cadastradas e imagens do Estúdio)
  const images: string[] = []
  const inputs: Record<string, unknown> = {}
  if (swap) {
    // Outra cor: parte da foto pronta e troca só a peça (mesma modelo, pose e cenário)
    const p0 = (Array.isArray(b.pieces) ? (b.pieces as { product_id?: string; photo?: number }[]) : [])[0]
    const t = (b.target && typeof b.target === 'object' ? b.target : null) as { product_id?: unknown; color?: unknown } | null
    if (!p0 || typeof p0.product_id !== 'string' || !UUID.test(p0.product_id)) return bad('Escolha a peça.')
    if (!t || t.product_id !== p0.product_id || typeof t.color !== 'string' || !t.color.trim()) return bad('Escolha a cor.')
    const [{ data: baseImg }, { data: prod }] = await Promise.all([
      db.from('retail_ai_images').select('id, kind, path').eq('id', String(b.base_image_id)).maybeSingle(),
      db.from('retail_products').select('id, name, category, photos').eq('id', p0.product_id).maybeSingle(),
    ])
    if (!baseImg || baseImg.kind !== 'look') return bad('A foto de base não foi encontrada no banco de imagens.')
    if (!prod) return bad('Peça não encontrada.')
    const photo = ((prod.photos ?? []) as string[])[Number(p0.photo ?? 0)]
    if (!photo) return bad('A peça não tem essa foto.')
    images.push(retailPhotoUrl(baseImg.path as string), /^https:\/\//.test(photo) ? photo : retailPhotoUrl(photo))
    prompt = swapColorPrompt({ name: String(prod.name), category: (prod.category as string | null) ?? null, color: t.color.trim().slice(0, 60) })
    Object.assign(inputs, { base_image_id: baseImg.id, pieces: [{ product_id: p0.product_id, photo: Number(p0.photo ?? 0) }], target: { product_id: p0.product_id, color: t.color.trim().slice(0, 60) } })
  } else if (kind === 'look') {
    const modelId = String(b.model_image_id ?? ''), sceneId = String(b.scene_image_id ?? '')
    if (!UUID.test(modelId)) return bad('Escolha a modelo.')
    const pieces = Array.isArray(b.pieces) ? (b.pieces as { product_id?: string; photo?: number }[]).slice(0, MAX_LOOK_PIECES + 1) : []
    if (!pieces.length) return bad('Escolha ao menos uma peça.')
    if (pieces.length > MAX_LOOK_PIECES) return bad(`Até ${MAX_LOOK_PIECES} peças por foto.`)
    const ids = [modelId, ...(UUID.test(sceneId) ? [sceneId] : [])]
    const { data: refs } = await db.from('retail_ai_images').select('id, kind, path').in('id', ids)
    const m = (refs ?? []).find(r => r.id === modelId && r.kind === 'modelo')
    if (!m) return bad('Modelo não encontrada no banco de imagens.')
    const sc = UUID.test(sceneId) ? (refs ?? []).find(r => r.id === sceneId && r.kind === 'cenario') : null
    if (UUID.test(sceneId) && !sc) return bad('Cenário não encontrado no banco de imagens.')
    const prodIds = [...new Set(pieces.map(p => String(p.product_id ?? '')).filter(id => UUID.test(id)))]
    const { data: prods } = prodIds.length ? await db.from('retail_products').select('id, name, category, photos, photo_meta').in('id', prodIds) : { data: [] }
    const byId = new Map((prods ?? []).map(p => [p.id as string, (p.photos ?? []) as string[]]))
    const info = new Map((prods ?? []).map(p => [p.id as string, p]))
    images.push(retailPhotoUrl(m.path as string))
    for (const p of pieces) {
      const photo = byId.get(String(p.product_id))?.[Number(p.photo ?? 0)]
      if (!photo) return bad('Uma das peças escolhidas não tem essa foto.')
      images.push(/^https:\/\//.test(photo) ? photo : retailPhotoUrl(photo))
    }
    if (sc) images.push(retailPhotoUrl(sc.path as string))
    // Foto feita para uma cor de uma peça (vem do aviso "faltam fotos com modelo")
    const t = (b.target && typeof b.target === 'object' ? b.target : null) as { product_id?: unknown; color?: unknown } | null
    const target = t && typeof t.product_id === 'string' && prodIds.includes(t.product_id) ? { product_id: t.product_id, color: typeof t.color === 'string' ? t.color.slice(0, 60) : null } : null
    Object.assign(inputs, { model_image_id: modelId, scene_image_id: sc?.id ?? null, pieces, pose, target })
    // Sempre (mesmo com o texto editado): nome, tipo e cor de cada peça, e o que trocar na modelo
    const brief = pieceBrief(pieces.map(p => {
      const row = info.get(String(p.product_id))
      const path = byId.get(String(p.product_id))?.[Number(p.photo ?? 0)] ?? ''
      const metaColor = ((row?.photo_meta ?? {}) as Record<string, { color?: string | null }>)[path]?.color ?? null
      const color = target && target.product_id === p.product_id && target.color ? target.color : metaColor
      return { name: String(row?.name ?? 'peça'), category: (row?.category as string | null) ?? null, color }
    }))
    if (brief) prompt = `${prompt}\n\n${brief}`
    // Completar o look com peças simples que combinem com a essência da loja (escolha da tela)
    if (b.complete === true) {
      const { data: sf } = await db.from('retail_storefronts').select('tagline, content').maybeSingle()
      const essence = readContent(sf?.content).hero_title || (sf?.tagline as string | null) || 'moda feminina elegante para o dia a dia'
      prompt = `${prompt}\n\n${completeLookBrief(essence)}`
      inputs.complete = true
    }
  }

  const fmt = IMAGE_FORMAT[kind]
  const r = await generateImage({ provider, key, model, prompt, images, size: fmt.openai, aspect: fmt.gemini })
  if (!r.ok) return bad(r.error, 502)
  const ext = r.mime.includes('png') ? 'png' : r.mime.includes('webp') ? 'webp' : 'jpg'
  const path = `${tenantId}/ia/${kind}-${randomUUID()}.${ext}`
  const { error: upErr } = await db.storage.from(RETAIL_MEDIA_BUCKET).upload(path, r.data, { contentType: r.mime, upsert: false })
  if (upErr) return bad(`A imagem foi gerada, mas não consegui guardar: ${upErr.message}`, 500)
  const { data: row, error } = await db.from('retail_ai_images').insert({ kind, title, path, provider, model, prompt, inputs, created_by: access.userId }).select('id').single()
  if (error || !row) return bad(error?.message ?? 'Falha ao registrar a imagem.', 500)
  return NextResponse.json({ id: row.id, url: retailPhotoUrl(path), kind })
}
