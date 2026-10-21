'use server'

// ─── Varejo: cadastro de produtos, variações, fotos e importação ──────────────
// Só para empresas com a aba 'varejo' liberada (Super Admin → Planos e abas).
// Tudo passa por createScopedAdmin (empresa do usuário); fotos vão para
// "<tenant_id>/produtos/<produto>/..." no bucket público retail-media.

import * as XLSX from 'xlsx'
import { revalidatePath } from 'next/cache'
import { hasFeature } from '@/lib/auth/access'
import { requireTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { getSupportSession } from '@/lib/tenant/support'
import { sanitizeStorageFileName } from '@/lib/utils/storage'
import {
  cleanText, cleanLongText, normalizeCode, defaultSku, parseMoney, parseStock, isProductStatus,
  RETAIL_MEDIA_BUCKET, MAX_PHOTOS, type ProductStatus, type RetailVariant,
} from '@/lib/retail/products'

type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string }

async function guard(): Promise<{ tenantId: string } | { error: string }> {
  const access = await hasFeature('varejo')
  if (!access) return { error: 'Sem acesso ao módulo Varejo.' }
  if (await getSupportSession()) return { error: 'Acesso de suporte é só leitura.' }
  return { tenantId: await requireTenantId() }
}

export type ProductInput = {
  id?: string | null
  code: string
  name: string
  category?: string | null
  description?: string | null
  composition?: string | null
  care?: string | null
  measures?: string | null
  price: string | number
  promo_price?: string | number | null
  status: ProductStatus
  weight_g?: string | number | null
  variants: { id?: string | null; sku?: string | null; color?: string | null; size?: string | null; stock: string | number; active: boolean }[]
}

function validateVariants(code: string, raw: ProductInput['variants']): { ok: true; list: RetailVariant[] } | { ok: false; error: string } {
  const list: RetailVariant[] = []
  const skus = new Set<string>()
  const combos = new Set<string>()
  for (const v of raw ?? []) {
    const color = cleanText(v.color, 60)
    const size = cleanText(v.size, 20)
    const stock = parseStock(v.stock)
    if (stock === null) return { ok: false, error: `Estoque inválido na variação ${[color, size].filter(Boolean).join(' / ') || 'sem nome'}.` }
    const sku = normalizeCode(v.sku) ?? defaultSku(code, color, size)
    if (!sku) return { ok: false, error: 'Variação sem SKU.' }
    if (skus.has(sku)) return { ok: false, error: `SKU repetido: ${sku}.` }
    const combo = `${(color ?? '').toLowerCase()}|${(size ?? '').toLowerCase()}`
    if (combos.has(combo)) return { ok: false, error: `Cor e tamanho repetidos: ${[color, size].filter(Boolean).join(' / ') || 'sem cor e tamanho'}.` }
    skus.add(sku); combos.add(combo)
    list.push({ id: v.id ?? undefined, sku, color, size, stock, active: v.active !== false })
  }
  if (!list.length) return { ok: false, error: 'Cadastre ao menos uma variação (cor e/ou tamanho com estoque).' }
  if (list.length > 200) return { ok: false, error: 'Máximo de 200 variações por peça.' }
  return { ok: true, list }
}

export async function saveRetailProduct(input: ProductInput): Promise<Result<{ id: string; variants: RetailVariant[] }>> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  const code = normalizeCode(input.code)
  const name = cleanText(input.name, 160)
  const price = parseMoney(input.price)
  const promo = input.promo_price === null || input.promo_price === undefined || input.promo_price === '' ? null : parseMoney(input.promo_price)
  if (!code) return { ok: false, error: 'Informe o código da peça.' }
  if (!name) return { ok: false, error: 'Informe o nome da peça.' }
  if (price === null) return { ok: false, error: 'Preço inválido.' }
  if (input.promo_price && promo === null) return { ok: false, error: 'Preço promocional inválido.' }
  if (!isProductStatus(input.status)) return { ok: false, error: 'Situação inválida.' }
  const weight = input.weight_g === null || input.weight_g === undefined || input.weight_g === '' ? null : parseStock(input.weight_g)
  const vv = validateVariants(code, input.variants)
  if (!vv.ok) return vv

  const db = await createScopedAdmin(g.tenantId)
  const row = {
    code, name,
    category: cleanText(input.category, 80),
    description: cleanLongText(input.description),
    composition: cleanText(input.composition, 300),
    care: cleanLongText(input.care, 1000),
    measures: cleanLongText(input.measures, 2000),
    price, promo_price: promo, status: input.status, weight_g: weight,
    updated_at: new Date().toISOString(),
  }

  let productId = input.id ?? null
  if (productId) {
    const { data, error } = await db.from('retail_products').update(row).eq('id', productId).select('id').maybeSingle()
    if (error) return { ok: false, error: error.code === '23505' ? `Já existe outra peça com o código ${code}.` : error.message }
    if (!data) return { ok: false, error: 'Peça não encontrada.' }
  } else {
    const { data, error } = await db.from('retail_products').insert(row).select('id').single()
    if (error) return { ok: false, error: error.code === '23505' ? `Já existe uma peça com o código ${code}.` : error.message }
    productId = data.id as string
  }

  // Variações: apaga as removidas, atualiza as existentes, cria as novas
  const { data: current } = await db.from('retail_product_variants').select('id').eq('product_id', productId)
  const keep = new Set(vv.list.map(v => v.id).filter(Boolean) as string[])
  const removed = (current ?? []).map(r => r.id as string).filter(id => !keep.has(id))
  if (removed.length) await db.from('retail_product_variants').delete().in('id', removed).eq('product_id', productId)
  for (const v of vv.list) {
    const vrow = { sku: v.sku, color: v.color, size: v.size, stock: v.stock, active: v.active, updated_at: new Date().toISOString() }
    const { error } = v.id
      ? await db.from('retail_product_variants').update(vrow).eq('id', v.id).eq('product_id', productId)
      : await db.from('retail_product_variants').insert({ ...vrow, product_id: productId })
    if (error) return { ok: false, error: error.code === '23505' ? `SKU ${v.sku} já usado em outra peça (ou cor e tamanho repetidos).` : error.message }
  }

  revalidatePath('/varejo/produtos')
  const { data: saved } = await db.from('retail_product_variants').select('id, sku, color, size, stock, active').eq('product_id', productId)
  return { ok: true, id: productId, variants: (saved ?? []) as RetailVariant[] }
}

export async function deleteRetailProduct(productId: string): Promise<Result> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  const db = await createScopedAdmin(g.tenantId)
  const { data: p } = await db.from('retail_products').select('id, photos').eq('id', productId).maybeSingle()
  if (!p) return { ok: false, error: 'Peça não encontrada.' }
  const photos = ((p.photos as string[] | null) ?? []).filter(path => path.startsWith(`${g.tenantId}/`))
  if (photos.length) await db.storage.from(RETAIL_MEDIA_BUCKET).remove(photos)
  const { error } = await db.from('retail_products').delete().eq('id', productId)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/varejo/produtos')
  return { ok: true }
}

// ── Fotos ────────────────────────────────────────────────────────────────────
// 1) createRetailPhotoUpload: confere a peça e devolve um link de envio de uso único
// 2) a tela envia o arquivo direto ao Storage (sem o limite de 1 MB das ações)
// 3) attachRetailPhoto: grava o caminho na peça
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']

async function productPhotos(db: Awaited<ReturnType<typeof createScopedAdmin>>, productId: string): Promise<string[] | null> {
  const { data } = await db.from('retail_products').select('photos').eq('id', productId).maybeSingle()
  return data ? ((data.photos as string[] | null) ?? []) : null
}

export async function createRetailPhotoUpload(productId: string, fileName: string, contentType: string): Promise<Result<{ path: string; token: string }>> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  if (!IMAGE_TYPES.includes(contentType)) return { ok: false, error: 'Use foto JPG, PNG, WEBP ou HEIC.' }
  const db = await createScopedAdmin(g.tenantId)
  const photos = await productPhotos(db, productId)
  if (!photos) return { ok: false, error: 'Peça não encontrada.' }
  if (photos.length >= MAX_PHOTOS) return { ok: false, error: `Máximo de ${MAX_PHOTOS} fotos por peça.` }
  const path = `${g.tenantId}/produtos/${productId}/${Date.now()}-${sanitizeStorageFileName(fileName).slice(-80)}`
  const { data, error } = await db.storage.from(RETAIL_MEDIA_BUCKET).createSignedUploadUrl(path)
  if (error || !data) return { ok: false, error: error?.message ?? 'Não foi possível preparar o envio.' }
  return { ok: true, path: data.path ?? path, token: data.token }
}

export async function attachRetailPhoto(productId: string, path: string): Promise<Result<{ photos: string[] }>> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  if (!path.startsWith(`${g.tenantId}/produtos/${productId}/`) || path.includes('..')) return { ok: false, error: 'Foto inválida.' }
  const db = await createScopedAdmin(g.tenantId)
  const photos = await productPhotos(db, productId)
  if (!photos) return { ok: false, error: 'Peça não encontrada.' }
  if (photos.includes(path)) return { ok: true, photos }
  if (photos.length >= MAX_PHOTOS) return { ok: false, error: `Máximo de ${MAX_PHOTOS} fotos por peça.` }
  const next = [...photos, path]
  const { error } = await db.from('retail_products').update({ photos: next, updated_at: new Date().toISOString() }).eq('id', productId)
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/varejo/produtos/${productId}`)
  return { ok: true, photos: next }
}

export async function removeRetailPhoto(productId: string, path: string): Promise<Result<{ photos: string[] }>> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  const db = await createScopedAdmin(g.tenantId)
  const photos = await productPhotos(db, productId)
  if (!photos) return { ok: false, error: 'Peça não encontrada.' }
  const next = photos.filter(p => p !== path)
  const { error } = await db.from('retail_products').update({ photos: next, updated_at: new Date().toISOString() }).eq('id', productId)
  if (error) return { ok: false, error: error.message }
  if (photos.includes(path) && path.startsWith(`${g.tenantId}/produtos/${productId}/`)) await db.storage.from(RETAIL_MEDIA_BUCKET).remove([path])
  revalidatePath(`/varejo/produtos/${productId}`)
  return { ok: true, photos: next }
}

// Primeira foto = capa da vitrine
export async function moveRetailPhoto(productId: string, path: string, direction: -1 | 1): Promise<Result<{ photos: string[] }>> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  const db = await createScopedAdmin(g.tenantId)
  const photos = await productPhotos(db, productId)
  if (!photos) return { ok: false, error: 'Peça não encontrada.' }
  const i = photos.indexOf(path), j = i + direction
  if (i < 0 || j < 0 || j >= photos.length) return { ok: true, photos }
  const next = [...photos];[next[i], next[j]] = [next[j], next[i]]
  const { error } = await db.from('retail_products').update({ photos: next, updated_at: new Date().toISOString() }).eq('id', productId)
  if (error) return { ok: false, error: error.message }
  return { ok: true, photos: next }
}

// ── Importação por planilha ──────────────────────────────────────────────────
// Uma linha por variação. Linhas com o mesmo código formam uma peça.
// Peça e variação existentes (mesmo código / mesmo SKU) são atualizadas; nada é apagado.
export type ImportProduct = {
  code: string; name: string; category: string | null; price: number; promo_price: number | null
  status: ProductStatus; description: string | null; composition: string | null; care: string | null
  variants: { sku: string; color: string | null; size: string | null; stock: number }[]
}

const MAX_BYTES = 950 * 1024
const MAX_ROWS = 3000
const COLS: Record<string, string[]> = {
  code: ['codigo', 'código', 'cod', 'referencia', 'referência', 'ref', 'modelo'],
  name: ['nome', 'produto', 'descricao do produto', 'peça', 'peca'],
  category: ['categoria'],
  price: ['preco', 'preço', 'preco de venda', 'preço de venda', 'valor'],
  promo_price: ['preco promocional', 'preço promocional', 'promocao', 'promoção'],
  color: ['cor'],
  size: ['tamanho', 'tam'],
  sku: ['sku', 'codigo da variacao', 'código da variação'],
  stock: ['estoque', 'saldo', 'quantidade', 'qtd'],
  description: ['descricao', 'descrição'],
  composition: ['composicao', 'composição', 'tecido'],
  care: ['cuidados', 'conservacao', 'conservação'],
  status: ['situacao', 'situação', 'status'],
}
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[_\s]+/g, ' ').trim()

function pick(rec: Record<string, unknown>, field: string): unknown {
  const wanted = COLS[field].map(norm)
  for (const [k, v] of Object.entries(rec)) if (wanted.includes(norm(k))) return v
  return undefined
}

function statusFrom(v: unknown): ProductStatus {
  const s = norm(String(v ?? ''))
  if (s.startsWith('pub') || s === 'ativo' || s === 'sim') return 'publicado'
  if (s.startsWith('arq') || s === 'inativo') return 'arquivado'
  return 'rascunho'
}

export async function parseRetailProductFile(formData: FormData): Promise<Result<{ products: ImportProduct[]; ignored: string[] }>> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  const file = formData.get('file')
  if (!(file instanceof File)) return { ok: false, error: 'Escolha a planilha.' }
  if (file.size > MAX_BYTES) return { ok: false, error: 'Planilha maior que 950 KB. Divida em partes.' }
  if (!/\.(xlsx|xls|csv)$/i.test(file.name)) return { ok: false, error: 'Use Excel (.xlsx/.xls) ou CSV.' }
  let records: Record<string, unknown>[]
  try {
    const wb = XLSX.read(Buffer.from(await file.arrayBuffer()), { type: 'buffer' })
    records = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false })
  } catch {
    return { ok: false, error: 'Não foi possível ler a planilha.' }
  }
  if (!records.length) return { ok: false, error: 'A planilha está vazia (a primeira linha deve ter os títulos das colunas).' }
  if (records.length > MAX_ROWS) return { ok: false, error: `Máximo de ${MAX_ROWS} linhas por importação.` }

  const byCode = new Map<string, ImportProduct>()
  const ignored: string[] = []
  records.forEach((rec, i) => {
    const line = i + 2
    const code = normalizeCode(pick(rec, 'code'))
    if (!code) { if (Object.values(rec).some(v => String(v).trim())) ignored.push(`Linha ${line}: sem código.`); return }
    const price = parseMoney(pick(rec, 'price'))
    const stock = parseStock(pick(rec, 'stock')) ?? 0
    const color = cleanText(pick(rec, 'color'), 60)
    const size = cleanText(pick(rec, 'size'), 20)
    let p = byCode.get(code)
    if (!p) {
      const name = cleanText(pick(rec, 'name'), 160)
      if (!name) { ignored.push(`Linha ${line} (${code}): sem nome.`); return }
      if (price === null) { ignored.push(`Linha ${line} (${code}): preço inválido.`); return }
      p = {
        code, name, category: cleanText(pick(rec, 'category'), 80), price,
        promo_price: parseMoney(pick(rec, 'promo_price')),
        status: statusFrom(pick(rec, 'status')),
        description: cleanLongText(pick(rec, 'description')), composition: cleanText(pick(rec, 'composition'), 300), care: cleanLongText(pick(rec, 'care'), 1000),
        variants: [],
      }
      byCode.set(code, p)
    }
    const sku = normalizeCode(pick(rec, 'sku')) ?? defaultSku(code, color, size)
    const dupe = p.variants.find(v => v.sku === sku || ((v.color ?? '').toLowerCase() === (color ?? '').toLowerCase() && (v.size ?? '').toLowerCase() === (size ?? '').toLowerCase()))
    if (dupe) { ignored.push(`Linha ${line} (${code}): variação repetida (${[color, size].filter(Boolean).join(' / ') || sku}).`); return }
    p.variants.push({ sku, color, size, stock })
  })
  return { ok: true, products: [...byCode.values()], ignored: ignored.slice(0, 50) }
}

export async function importRetailProductsChunk(products: ImportProduct[]): Promise<Result<{ created: number; updated: number; errors: string[] }>> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  if (!Array.isArray(products) || products.length > 20) return { ok: false, error: 'Lote inválido.' }
  const db = await createScopedAdmin(g.tenantId)
  let created = 0, updated = 0
  const errors: string[] = []
  for (const raw of products) {
    const code = normalizeCode(raw.code)
    const name = cleanText(raw.name, 160)
    const price = parseMoney(raw.price)
    if (!code || !name || price === null) { errors.push(`${raw.code ?? '?'}: dados incompletos.`); continue }
    const { data: existing } = await db.from('retail_products').select('id').eq('code', code).maybeSingle()
    const row = {
      code, name, category: cleanText(raw.category, 80), price, promo_price: parseMoney(raw.promo_price),
      status: isProductStatus(raw.status) ? raw.status : 'rascunho',
      description: cleanLongText(raw.description), composition: cleanText(raw.composition, 300), care: cleanLongText(raw.care, 1000),
      updated_at: new Date().toISOString(),
    }
    let productId: string
    if (existing) {
      const { error } = await db.from('retail_products').update(row).eq('id', existing.id)
      if (error) { errors.push(`${code}: ${error.message}`); continue }
      productId = existing.id as string; updated++
    } else {
      const { data, error } = await db.from('retail_products').insert(row).select('id').single()
      if (error || !data) { errors.push(`${code}: ${error?.message ?? 'falha ao criar'}`); continue }
      productId = data.id as string; created++
    }
    for (const v of raw.variants ?? []) {
      const sku = normalizeCode(v.sku) ?? defaultSku(code, cleanText(v.color, 60), cleanText(v.size, 20))
      const stock = parseStock(v.stock) ?? 0
      const vrow = { sku, color: cleanText(v.color, 60), size: cleanText(v.size, 20), stock, active: true, updated_at: new Date().toISOString() }
      const { data: ev } = await db.from('retail_product_variants').select('id, product_id').eq('sku', sku).maybeSingle()
      if (ev && ev.product_id !== productId) { errors.push(`${code}: SKU ${sku} já pertence a outra peça.`); continue }
      const { error } = ev
        ? await db.from('retail_product_variants').update(vrow).eq('id', ev.id)
        : await db.from('retail_product_variants').insert({ ...vrow, product_id: productId })
      if (error) errors.push(`${code} / ${sku}: ${error.code === '23505' ? 'cor e tamanho repetidos' : error.message}`)
    }
  }
  revalidatePath('/varejo/produtos')
  return { ok: true, created, updated, errors: errors.slice(0, 30) }
}
