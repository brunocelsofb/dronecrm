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
import { readPhotoMeta, type PhotoMeta } from '@/lib/retail/photo-colors'
import { similarColors } from '@/lib/retail/merge'
import { needsSplit } from '@/lib/retail/split'
import { normalizeBarcode } from '@/lib/retail/scan'
import {
  cleanText, cleanLongText, normalizeCode, defaultSku, parseMoney, parseStock, isProductStatus,
  RETAIL_MEDIA_BUCKET, MAX_PHOTOS, type ProductStatus, type RetailVariant,
} from '@/lib/retail/products'

type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string }

async function guard(): Promise<{ tenantId: string; userId: string } | { error: string }> {
  const access = await hasFeature('varejo')
  if (!access) return { error: 'Sem acesso ao módulo Varejo.' }
  if (await getSupportSession()) return { error: 'Acesso de suporte é só leitura.' }
  return { tenantId: await requireTenantId(), userId: access.userId }
}

// Mudança de saldo sempre pela função do banco: fica no histórico com o motivo e quem fez
type StockRow = { variant_id: string; mode: 'add' | 'set'; qty: number }
async function moveStock(db: Awaited<ReturnType<typeof createScopedAdmin>>, tenantId: string, userId: string, kind: 'entrada' | 'contagem' | 'ajuste' | 'importacao' | 'cadastro', rows: StockRow[], note?: string | null): Promise<string | null> {
  if (!rows.length) return null
  const { data, error } = await db.rpc('retail_stock_batch', { p_tenant: tenantId, p_user: userId, p_kind: kind, p_note: note ?? null, p_rows: rows })
  return error ? error.message : (data as string | null)
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
  cost_price?: string | number | null
  status: ProductStatus
  weight_g?: string | number | null
  occasions?: string[] | null // ids das ocasiões da vitrine
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
  const cost = input.cost_price === null || input.cost_price === undefined || input.cost_price === '' ? null : parseMoney(input.cost_price)
  if (input.cost_price && cost === null) return { ok: false, error: 'Custo inválido.' }
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
    price, promo_price: promo, cost_price: cost, status: input.status, weight_g: weight,
    occasions: [...new Set((Array.isArray(input.occasions) ? input.occasions : []).map(o => String(o)).filter(o => /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(o)))].slice(0, 12),
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

  // Variações: apaga as removidas, atualiza as existentes, cria as novas.
  // O saldo muda pela função do banco (histórico "ajuste" com quem fez)
  const { data: current } = await db.from('retail_product_variants').select('id, stock, color, price, promo_price').eq('product_id', productId)
  // Tamanho novo numa cor com preço próprio herda o preço da cor
  const colorPrice = new Map<string, { price: unknown; promo_price: unknown }>()
  for (const r of current ?? []) if (r.price !== null || r.promo_price !== null) colorPrice.set(String(r.color ?? ''), { price: r.price, promo_price: r.promo_price })
  const stockNow = new Map((current ?? []).map(r => [r.id as string, Number(r.stock)]))
  const stockRows: StockRow[] = []
  const newStock: StockRow[] = []
  const keep = new Set(vv.list.map(v => v.id).filter(Boolean) as string[])
  const removed = (current ?? []).map(r => r.id as string).filter(id => !keep.has(id))
  if (removed.length) await db.from('retail_product_variants').delete().in('id', removed).eq('product_id', productId)
  for (const v of vv.list) {
    const vrow = { sku: v.sku, color: v.color, size: v.size, active: v.active, updated_at: new Date().toISOString() }
    if (v.id) {
      const { error } = await db.from('retail_product_variants').update(vrow).eq('id', v.id).eq('product_id', productId)
      if (error) return { ok: false, error: error.code === '23505' ? `SKU ${v.sku} já usado em outra peça (ou cor e tamanho repetidos).` : error.message }
      if (stockNow.get(v.id) !== v.stock) stockRows.push({ variant_id: v.id, mode: 'set', qty: v.stock })
    } else {
      const { data, error } = await db.from('retail_product_variants').insert({ ...vrow, ...(colorPrice.get(String(v.color ?? '')) ?? {}), stock: 0, product_id: productId }).select('id').single()
      if (error || !data) return { ok: false, error: error?.code === '23505' ? `SKU ${v.sku} já usado em outra peça (ou cor e tamanho repetidos).` : error?.message ?? 'Falha ao criar a variação.' }
      if (v.stock > 0) newStock.push({ variant_id: data.id as string, mode: 'set', qty: v.stock })
    }
  }
  const stockErr = (await moveStock(db, g.tenantId, g.userId, 'ajuste', stockRows, 'cadastro da peça')) ?? (await moveStock(db, g.tenantId, g.userId, 'cadastro', newStock, 'variação nova'))
  if (stockErr) return { ok: false, error: `Peça salva, mas o estoque não foi gravado: ${stockErr}` }

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
  // Só os arquivos da pasta da peça; foto do Estúdio IA continua no banco de imagens
  const photos = ((p.photos as string[] | null) ?? []).filter(path => path.startsWith(`${g.tenantId}/produtos/`))
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
  const { data: cur } = await db.from('retail_products').select('photo_meta').eq('id', productId).maybeSingle()
  const meta = { ...((cur?.photo_meta as Record<string, unknown> | null) ?? {}) }
  delete meta[path]
  const { error } = await db.from('retail_products').update({ photos: next, photo_meta: meta, updated_at: new Date().toISOString() }).eq('id', productId)
  if (error) return { ok: false, error: error.message }
  // Foto do Estúdio IA (pasta "ia/") sai só da peça: continua no banco de imagens
  if (photos.includes(path) && path.startsWith(`${g.tenantId}/produtos/`)) await db.storage.from(RETAIL_MEDIA_BUCKET).remove([path])
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

// Cor da foto (null = vale para todas as cores) e se é foto com modelo
export async function setRetailPhotoMeta(productId: string, path: string, info: { color: string | null; model: boolean }): Promise<Result<{ meta: PhotoMeta }>> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  const db = await createScopedAdmin(g.tenantId)
  const { data: p } = await db.from('retail_products').select('photos, photo_meta, retail_product_variants(color, active)').eq('id', productId).maybeSingle()
  if (!p) return { ok: false, error: 'Peça não encontrada.' }
  const photos = ((p.photos as string[] | null) ?? [])
  if (!photos.includes(path)) return { ok: false, error: 'Foto não encontrada nesta peça.' }
  const colors = [...new Set(((p.retail_product_variants ?? []) as { color: string | null; active: boolean }[]).filter(v => v.active && v.color).map(v => v.color as string))]
  if (info.color !== null && !colors.includes(info.color)) return { ok: false, error: 'Essa cor não existe nesta peça. Confira o passo 2.' }
  const raw = { ...((p.photo_meta as Record<string, unknown> | null) ?? {}), [path]: { color: info.color, model: !!info.model } }
  const meta = readPhotoMeta(raw, photos, colors)
  const { error } = await db.from('retail_products').update({ photo_meta: meta, updated_at: new Date().toISOString() }).eq('id', productId)
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/varejo/produtos/${productId}`); revalidatePath('/varejo/estudio')
  return { ok: true, meta }
}

// ── Importação por planilha ──────────────────────────────────────────────────
// Uma linha por variação. Linhas com o mesmo código formam uma peça. Nada é apagado.
// Três jeitos, escolhidos antes de subir:
//   cadastro  → atualiza dados e preços; NÃO mexe no estoque de variação que já existe
//   entrada   → soma a quantidade da planilha ao estoque (mercadoria que chegou)
//   contagem  → o estoque fica igual ao da planilha (inventário)
// Campo vazio na planilha não apaga o que já está cadastrado.
export type ImportMode = 'cadastro' | 'entrada' | 'contagem'
const isImportMode = (v: unknown): v is ImportMode => v === 'cadastro' || v === 'entrada' || v === 'contagem'

export type ImportProduct = {
  code: string; name: string | null; category: string | null; price: number | null; promo_price: number | null; cost_price: number | null
  status: ProductStatus | null; description: string | null; composition: string | null; care: string | null
  variants: { sku: string; color: string | null; size: string | null; stock: number; barcode?: string | null }[]
}

const MAX_BYTES = 950 * 1024
const MAX_ROWS = 3000
const COLS: Record<string, string[]> = {
  code: ['codigo', 'código', 'cod', 'referencia', 'referência', 'ref', 'modelo'],
  name: ['nome', 'produto', 'descricao do produto', 'peça', 'peca'],
  category: ['categoria'],
  price: ['preco', 'preço', 'preco de venda', 'preço de venda', 'valor'],
  promo_price: ['preco promocional', 'preço promocional', 'promocao', 'promoção'],
  cost_price: ['custo', 'preco de custo', 'preço de custo', 'custo unitario', 'custo unitário'],
  color: ['cor'],
  size: ['tamanho', 'tam'],
  sku: ['sku', 'codigo da variacao', 'código da variação'],
  barcode: ['codigo de barras', 'código de barras', 'codigo barras', 'ean', 'gtin', 'cod barras'],
  stock: ['estoque', 'saldo', 'quantidade', 'qtd'],
  description: ['descricao', 'descrição'],
  composition: ['composicao', 'composição', 'tecido'],
  care: ['cuidados', 'conservacao', 'conservação'],
  status: ['situacao', 'situação', 'status'],
}
const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[_\s]+/g, ' ').trim()

function pick(rec: Record<string, unknown>, field: string): unknown {
  const wanted = COLS[field].map(norm)
  for (const [k, v] of Object.entries(rec)) if (wanted.includes(norm(k))) return v
  return undefined
}

function statusFrom(v: unknown): ProductStatus | null {
  const s = norm(String(v ?? ''))
  if (!s) return null
  if (s.startsWith('pub') || s === 'ativo' || s === 'sim') return 'publicado'
  if (s.startsWith('arq') || s === 'inativo') return 'arquivado'
  return 'rascunho'
}

export async function parseRetailProductFile(formData: FormData): Promise<Result<{ products: ImportProduct[]; ignored: string[]; warnings: string[] }>> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  const mode: ImportMode = isImportMode(formData.get('mode')) ? formData.get('mode') as ImportMode : 'cadastro'
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
  if (mode !== 'cadastro' && !records.some(r => pick(r, 'stock') !== undefined)) return { ok: false, error: 'A planilha não tem a coluna de quantidade (Estoque).' }

  const byCode = new Map<string, ImportProduct>()
  const ignored: string[] = []
  const warnings: string[] = []
  records.forEach((rec, i) => {
    const line = i + 2
    const code = normalizeCode(pick(rec, 'code'))
    if (!code) { if (Object.values(rec).some(v => String(v).trim())) ignored.push(`Linha ${line}: sem código.`); return }
    const rawStock = String(pick(rec, 'stock') ?? '').trim()
    const stock = parseStock(rawStock) ?? 0
    if (rawStock && parseStock(rawStock) === null) warnings.push(`Linha ${line} (${code}): quantidade "${rawStock}" inválida, conta como 0.`)
    const color = cleanText(pick(rec, 'color'), 60)
    const size = cleanText(pick(rec, 'size'), 20)
    let p = byCode.get(code)
    if (!p) {
      const name = cleanText(pick(rec, 'name'), 160)
      const price = parseMoney(pick(rec, 'price'))
      // Sem preço: peça nova entra como rascunho, com aviso; peça existente mantém o preço que tem
      if (price === null && mode === 'cadastro') warnings.push(`Linha ${line} (${code}${name ? ` · ${name}` : ''}): sem preço. Se a peça for nova, entra como rascunho; defina o preço antes de publicar.`)
      p = {
        code, name, category: cleanText(pick(rec, 'category'), 80), price,
        promo_price: parseMoney(pick(rec, 'promo_price')),
        cost_price: parseMoney(pick(rec, 'cost_price')),
        status: statusFrom(pick(rec, 'status')),
        description: cleanLongText(pick(rec, 'description')), composition: cleanText(pick(rec, 'composition'), 300), care: cleanLongText(pick(rec, 'care'), 1000),
        variants: [],
      }
      byCode.set(code, p)
    }
    const sku = normalizeCode(pick(rec, 'sku')) ?? defaultSku(code, color, size)
    const dupe = p.variants.find(v => v.sku === sku || ((v.color ?? '').toLowerCase() === (color ?? '').toLowerCase() && (v.size ?? '').toLowerCase() === (size ?? '').toLowerCase()))
    // Mesma cor e tamanho em duas linhas: soma as quantidades (com aviso para conferir)
    if (dupe) { warnings.push(`Linha ${line} (${code}): ${[color, size].filter(Boolean).join(' / ') || sku} repetida. Quantidades somadas (${dupe.stock} + ${stock} = ${dupe.stock + stock}); confira se não foi linha duplicada.`); dupe.stock += stock; return }
    const bc = normalizeBarcode(String(pick(rec, 'barcode') ?? ''))
    p.variants.push({ sku, color, size, stock, barcode: bc.length >= 4 ? bc : null })
  })
  // Várias cores ou tamanhos na mesma célula ("Preto / Azul", "P/M"): entram como uma cor só
  const multi = [...byCode.values()].flatMap(p => p.variants.filter(v => needsSplit(v.color ?? null, v.size ?? null)).map(v => `${p.code} (${[v.color, v.size].filter(Boolean).join(' · ')})`))
  if (multi.length) warnings.unshift(`${multi.length} linha(s) com várias cores ou tamanhos na mesma célula: ${multi.slice(0, 5).join('; ')}${multi.length > 5 ? '…' : ''}. O certo é uma linha por cor e tamanho. Se importar assim, use depois Produtos → Separar cores e tamanhos.`)
  // Cores parecidas (Preta x Preto): viram duas cores diferentes se não forem iguais
  const sheetColors = [...byCode.values()].flatMap(p => p.variants.map(v => cleanText(v.color, 60) ?? '')).filter(Boolean)
  if (sheetColors.length) {
    const { data: known } = await (await createScopedAdmin(g.tenantId)).from('retail_product_variants').select('color').not('color', 'is', null).limit(20000)
    for (const [a, b] of similarColors(sheetColors, [...new Set((known ?? []).map(k => String(k.color)))]).slice(0, 20))
      warnings.unshift(`Cores parecidas: "${a}" e "${b}". Se for a mesma cor, escreva igual nas duas (senão viram duas cores na vitrine).`)
  }
  return { ok: true, products: [...byCode.values()], ignored: ignored.slice(0, 50), warnings: warnings.slice(0, 100) }
}

// Saldo atual das variações da planilha (para mostrar "antes → depois" antes de importar)
export async function retailStockForSkus(skus: string[]): Promise<Result<{ stock: Record<string, { stock: number; code: string }> }>> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  const list = [...new Set((Array.isArray(skus) ? skus : []).map(s => normalizeCode(s)).filter(Boolean) as string[])].slice(0, 5000)
  const db = await createScopedAdmin(g.tenantId)
  const out: Record<string, { stock: number; code: string }> = {}
  for (let i = 0; i < list.length; i += 300) {
    const { data } = await db.from('retail_product_variants').select('sku, stock, retail_products(code)').in('sku', list.slice(i, i + 300))
    for (const v of (data ?? []) as unknown as { sku: string; stock: number; retail_products: { code: string } | null }[]) out[v.sku] = { stock: Number(v.stock), code: v.retail_products?.code ?? '' }
  }
  return { ok: true, stock: out }
}

export async function importRetailProductsChunk(products: ImportProduct[], modeIn: ImportMode = 'cadastro'): Promise<Result<{ created: number; updated: number; errors: string[] }>> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  if (!Array.isArray(products) || products.length > 20) return { ok: false, error: 'Lote inválido.' }
  const mode: ImportMode = isImportMode(modeIn) ? modeIn : 'cadastro'
  const db = await createScopedAdmin(g.tenantId)
  let created = 0, updated = 0
  const errors: string[] = []
  const kind = mode === 'entrada' ? 'entrada' : mode === 'contagem' ? 'contagem' : 'importacao'
  for (const raw of products) {
    const code = normalizeCode(raw.code)
    if (!code) { errors.push(`${raw.code ?? '?'}: sem código.`); continue }
    const name = cleanText(raw.name, 160)
    const price = parseMoney(raw.price)
    let { data: existing } = await db.from('retail_products').select('id, price').eq('code', code).maybeSingle()
    // Código que foi juntado em outra peça (Juntar cores): acha a peça pelo SKU das variações
    // e só mexe nas variações (nome e preço continuam os da peça juntada)
    let joined = false
    if (!existing) {
      const skus = (raw.variants ?? []).map(v => normalizeCode(v.sku) ?? defaultSku(code, cleanText(v.color, 60), cleanText(v.size, 20)))
      const { data: hit } = skus.length ? await db.from('retail_product_variants').select('product_id').in('sku', skus).limit(1) : { data: [] }
      if (hit?.[0]) {
        const { data: jp } = await db.from('retail_products').select('id, price').eq('id', hit[0].product_id).maybeSingle()
        if (jp) { existing = jp; joined = true }
      }
    }
    // Só grava o que veio preenchido; vazio mantém o que já está cadastrado
    const filled: Record<string, unknown> = {}
    const put = (k: string, v: unknown) => { if (v !== null && v !== undefined && v !== '') filled[k] = v }
    put('name', name); put('category', cleanText(raw.category, 80)); put('price', price); put('promo_price', parseMoney(raw.promo_price))
    put('cost_price', parseMoney(raw.cost_price)); put('description', cleanLongText(raw.description)); put('composition', cleanText(raw.composition, 300)); put('care', cleanLongText(raw.care, 1000))
    const hasPrice = price !== null || (existing?.price !== null && existing?.price !== undefined)
    const status = isProductStatus(raw.status) ? raw.status : null
    let productId: string
    if (existing && joined) {
      productId = existing.id as string; updated++
    } else if (existing) {
      // Sem preço não publica; situação em branco mantém a atual
      const patch = { ...filled, ...(status ? { status: hasPrice ? status : 'rascunho' } : {}), updated_at: new Date().toISOString() }
      const { error } = await db.from('retail_products').update(patch).eq('id', existing.id)
      if (error) { errors.push(`${code}: ${error.message}`); continue }
      productId = existing.id as string; updated++
    } else {
      if (!name) { errors.push(`${code}: peça nova precisa de nome.`); continue }
      const { data, error } = await db.from('retail_products').insert({ code, ...filled, price, status: hasPrice && status ? status : 'rascunho' }).select('id').single()
      if (error || !data) { errors.push(`${code}: ${error?.message ?? 'falha ao criar'}`); continue }
      productId = data.id as string; created++
    }
    const moves: StockRow[] = []
    for (const v of raw.variants ?? []) {
      const sku = normalizeCode(v.sku) ?? defaultSku(code, cleanText(v.color, 60), cleanText(v.size, 20))
      const qty = parseStock(v.stock) ?? 0
      const { data: ev } = await db.from('retail_product_variants').select('id, product_id').eq('sku', sku).maybeSingle()
      if (ev && ev.product_id !== productId) { errors.push(`${code}: SKU ${sku} já pertence a outra peça.`); continue }
      if (ev) {
        const vpatch: Record<string, unknown> = { updated_at: new Date().toISOString() }
        if (v.barcode) vpatch.barcode = normalizeBarcode(v.barcode)
        if (cleanText(v.color, 60) && !joined) vpatch.color = cleanText(v.color, 60)
        if (cleanText(v.size, 20) && !joined) vpatch.size = cleanText(v.size, 20)
        const { error } = await db.from('retail_product_variants').update(vpatch).eq('id', ev.id)
        if (error) { errors.push(`${code} / ${sku}: ${error.code === '23505' ? 'cor e tamanho (ou código de barras) repetidos' : error.message}`); continue }
        // cadastro: não mexe no saldo; entrada: soma; contagem: define
        if (mode === 'entrada' && qty > 0) moves.push({ variant_id: ev.id as string, mode: 'add', qty })
        if (mode === 'contagem') moves.push({ variant_id: ev.id as string, mode: 'set', qty })
      } else {
        const { data: nv, error } = await db.from('retail_product_variants')
          .insert({ sku, color: cleanText(v.color, 60), size: cleanText(v.size, 20), stock: 0, active: true, product_id: productId, ...(v.barcode ? { barcode: normalizeBarcode(v.barcode) } : {}) }).select('id').single()
        if (error || !nv) { errors.push(`${code} / ${sku}: ${error?.code === '23505' ? 'cor e tamanho (ou código de barras) repetidos' : error?.message ?? 'falha ao criar'}`); continue }
        if (qty > 0) moves.push({ variant_id: nv.id as string, mode: 'set', qty })
      }
    }
    const err = await moveStock(db, g.tenantId, g.userId, kind, moves, `planilha (${mode})`)
    if (err) errors.push(`${code}: estoque não gravado (${err}).`)
  }
  revalidatePath('/varejo/produtos'); revalidatePath('/varejo/estoque')
  return { ok: true, created, updated, errors: errors.slice(0, 30) }
}

// ── Juntar cadastros da mesma peça (uma cor por código) ─────────────────────
// Só a administradora. Tudo num passo só no banco (retail_merge_products): ou junta tudo ou nada.
export async function mergeRetailProducts(input: { mainId: string; otherIds: string[]; priceFrom: string | null; colors: Record<string, string> }): Promise<Result<{ id: string }>> {
  const access = await hasFeature('varejo')
  if (!access) return { ok: false, error: 'Sem acesso ao módulo Varejo.' }
  if (await getSupportSession()) return { ok: false, error: 'Acesso de suporte é só leitura.' }
  if (!access.isAdmin) return { ok: false, error: 'Só a administradora junta peças.' }
  const tenantId = await requireTenantId()
  const UUIDRE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const others = [...new Set((input.otherIds ?? []).filter(x => UUIDRE.test(x) && x !== input.mainId))].slice(0, 20)
  if (!UUIDRE.test(input.mainId) || !others.length) return { ok: false, error: 'Escolha a peça principal e ao menos uma para juntar.' }
  const priceFrom = input.priceFrom && UUIDRE.test(input.priceFrom) ? input.priceFrom : null
  const colors: Record<string, string> = {}
  for (const [k, v] of Object.entries(input.colors ?? {})) if (others.includes(k) && String(v ?? '').trim()) colors[k] = String(v).trim().slice(0, 60)
  const db = await createScopedAdmin(tenantId)
  const { data, error } = await db.rpc('retail_merge_products', { p_tenant: tenantId, p_user: access.userId, p_main: input.mainId, p_others: others, p_price_from: priceFrom, p_colors: colors })
  if (error) return { ok: false, error: error.message.replace(/^.*?ERROR:\s*/, '') }
  if (data) return { ok: false, error: String(data) }
  revalidatePath('/varejo/produtos'); revalidatePath(`/varejo/produtos/${input.mainId}`); revalidatePath('/varejo/estudio'); revalidatePath('/varejo/vitrine')
  return { ok: true, id: input.mainId }
}

// Preço e promoção por cor (vazio = segue a peça). Vale para todos os tamanhos da cor.
export async function setRetailColorPrices(productId: string, rows: { color: string | null; price: string | null; promo_price: string | null }[]): Promise<Result> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  const db = await createScopedAdmin(g.tenantId)
  const { data: p } = await db.from('retail_products').select('id, price').eq('id', productId).maybeSingle()
  if (!p) return { ok: false, error: 'Peça não encontrada.' }
  for (const r of (rows ?? []).slice(0, 40)) {
    const price = r.price && String(r.price).trim() ? parseMoney(r.price) : null
    const promo = r.promo_price && String(r.promo_price).trim() ? parseMoney(r.promo_price) : null
    const label = r.color ?? 'Cor única'
    if (r.price && String(r.price).trim() && price === null) return { ok: false, error: `${label}: preço inválido.` }
    if (r.promo_price && String(r.promo_price).trim() && promo === null) return { ok: false, error: `${label}: promoção inválida.` }
    const base = price ?? (p.price === null ? null : Number(p.price))
    if (promo !== null && base !== null && promo >= base) return { ok: false, error: `${label}: a promoção precisa ser menor que o preço.` }
    let q = db.from('retail_product_variants').update({ price, promo_price: promo, updated_at: new Date().toISOString() }).eq('product_id', productId)
    q = r.color === null ? q.is('color', null) : q.eq('color', r.color)
    const { error } = await q
    if (error) return { ok: false, error: error.message }
  }
  revalidatePath(`/varejo/produtos/${productId}`); revalidatePath('/varejo/produtos')
  return { ok: true }
}

// ── Separar cores e tamanhos que vieram juntos numa linha da planilha ────────
export async function splitRetailVariant(variantId: string, rows: { color: string; size: string; qty: number }[]): Promise<Result> {
  const access = await hasFeature('varejo')
  if (!access) return { ok: false, error: 'Sem acesso ao módulo Varejo.' }
  if (await getSupportSession()) return { ok: false, error: 'Acesso de suporte é só leitura.' }
  if (!access.isAdmin) return { ok: false, error: 'Só a administradora separa as linhas.' }
  const tenantId = await requireTenantId()
  const db = await createScopedAdmin(tenantId)
  const { data: v } = await db.from('retail_product_variants').select('id, product_id, retail_products(code)').eq('id', variantId).maybeSingle()
  if (!v) return { ok: false, error: 'Linha não encontrada.' }
  const code = String((v.retail_products as unknown as { code: string } | null)?.code ?? '')
  const clean = (rows ?? []).slice(0, 40).map(r => ({ color: cleanText(r.color, 60) ?? '', size: cleanText(r.size, 20) ?? '', qty: Math.floor(Number(r.qty)) }))
    .filter(r => r.color || r.size)
  if (!clean.length) return { ok: false, error: 'Informe ao menos uma linha com cor ou tamanho.' }
  if (clean.some(r => !Number.isFinite(r.qty) || r.qty < 0)) return { ok: false, error: 'Quantidade inválida.' }
  if (clean.some(r => r.color.includes('/') || r.size.includes('/'))) return { ok: false, error: 'Cada linha deve ter uma cor e um tamanho só (sem "/").' }
  const payload = clean.map(r => ({ ...r, sku: defaultSku(code, r.color || null, r.size || null) }))
  const { data, error } = await db.rpc('retail_split_variant', { p_tenant: tenantId, p_user: access.userId, p_variant: variantId, p_rows: payload })
  if (error) return { ok: false, error: error.message }
  if (data) return { ok: false, error: String(data) }
  revalidatePath('/varejo/produtos'); revalidatePath(`/varejo/produtos/${v.product_id}`); revalidatePath('/varejo/estoque')
  return { ok: true }
}

// ── Leitor de código de barras ───────────────────────────────────────────────
// Liga o código lido (etiqueta do fornecedor) a uma cor e tamanho da peça
export async function linkRetailBarcode(variantId: string, code: string): Promise<Result> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  const c = normalizeBarcode(code)
  if (c.length < 4) return { ok: false, error: 'Código de barras inválido.' }
  const db = await createScopedAdmin(g.tenantId)
  const { data: other } = await db.from('retail_product_variants').select('id, sku, retail_products(name)').eq('barcode', c).maybeSingle()
  if (other && other.id !== variantId) return { ok: false, error: `Este código já está ligado a ${(other.retail_products as unknown as { name: string } | null)?.name ?? 'outra peça'} (${other.sku}).` }
  const { data, error } = await db.from('retail_product_variants').update({ barcode: c, updated_at: new Date().toISOString() }).eq('id', variantId).select('id').maybeSingle()
  if (error) return { ok: false, error: error.code === '23505' ? 'Este código já está ligado a outra peça.' : error.message }
  if (!data) return { ok: false, error: 'Variação não encontrada.' }
  return { ok: true }
}

// Aplica a contagem feita com o leitor: entrada soma; contagem iguala (e pode zerar o que não foi lido)
export async function applyRetailScan(mode: 'entrada' | 'contagem', rows: { variant_id: string; mode: 'add' | 'set'; qty: number }[]): Promise<Result<{ changed: number }>> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  if (mode !== 'entrada' && mode !== 'contagem') return { ok: false, error: 'Escolha entrada ou contagem.' }
  const clean = (rows ?? []).slice(0, 5000).filter(r => typeof r.variant_id === 'string' && (r.mode === 'add' || r.mode === 'set') && Number.isInteger(r.qty) && r.qty >= 0)
    .filter(r => (mode === 'entrada' ? r.mode === 'add' : r.mode === 'set'))
  if (!clean.length) return { ok: false, error: 'Nada para mudar no estoque.' }
  const db = await createScopedAdmin(g.tenantId)
  const err = await moveStock(db, g.tenantId, g.userId, mode, clean, 'leitor de código de barras')
  if (err) return { ok: false, error: err }
  revalidatePath('/varejo/estoque'); revalidatePath('/varejo/produtos')
  return { ok: true, changed: clean.length }
}

// Publicar (ou voltar a rascunho) direto da lista "Pronta para vender"
export async function setRetailProductStatus(productId: string, status: 'publicado' | 'rascunho'): Promise<Result> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  if (status !== 'publicado' && status !== 'rascunho') return { ok: false, error: 'Situação inválida.' }
  const db = await createScopedAdmin(g.tenantId)
  const { data: p } = await db.from('retail_products').select('price').eq('id', productId).maybeSingle()
  if (!p) return { ok: false, error: 'Peça não encontrada.' }
  if (status === 'publicado' && p.price === null) return { ok: false, error: 'Defina o preço antes de publicar.' }
  const { error } = await db.from('retail_products').update({ status, updated_at: new Date().toISOString() }).eq('id', productId)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/varejo/produtos'); revalidatePath('/varejo/produtos/prontas'); revalidatePath(`/varejo/produtos/${productId}`)
  return { ok: true }
}
