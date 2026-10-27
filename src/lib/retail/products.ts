// ─── Varejo: produtos e variações (regras compartilhadas) ─────────────────────
// Usado pelas telas, pelas ações e, nas próximas etapas, pela vitrine pública.
// Saldo é sempre por variação (cor + tamanho). Código da peça e SKU são únicos
// dentro da empresa e preservam o que a empresa já usa (ex.: PC682).

export const PRODUCT_STATUSES = [
  { id: 'rascunho', label: 'Rascunho' },
  { id: 'publicado', label: 'Publicado' },
  { id: 'arquivado', label: 'Arquivado' },
] as const
export type ProductStatus = (typeof PRODUCT_STATUSES)[number]['id']

export function isProductStatus(v: unknown): v is ProductStatus {
  return PRODUCT_STATUSES.some(s => s.id === v)
}

export type RetailVariant = {
  id?: string
  sku: string
  color: string | null
  size: string | null
  stock: number
  active: boolean
  price?: number | null // preço só desta cor (vazio = da peça)
  promo_price?: number | null
}

export type RetailProduct = {
  id: string
  code: string
  name: string
  category: string | null
  description: string | null
  composition: string | null
  care: string | null
  measures: string | null
  price: number | null // null = importada sem preço (rascunho até definir)
  promo_price: number | null
  cost_price?: number | null // só no Drone; nunca vai para a vitrine pública
  status: ProductStatus
  photos: string[]
  photo_meta?: Record<string, { color: string | null; model: boolean }> // cor de cada foto e se é com modelo
  weight_g: number | null
  occasions?: string[]
  variants: RetailVariant[]
}

export const RETAIL_MEDIA_BUCKET = 'retail-media'
export const MAX_PHOTOS = 8

// Texto curto, sem espaços sobrando
export function cleanText(v: unknown, max = 300): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).replace(/\s+/g, ' ').trim()
  return s ? s.slice(0, max) : null
}

// Texto longo (mantém quebras de linha)
export function cleanLongText(v: unknown, max = 4000): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).replace(/\r\n/g, '\n').trim()
  return s ? s.slice(0, max) : null
}

// Código/SKU: maiúsculas, sem acento, só letras, números, "-", "_" e "."
export function normalizeCode(v: unknown): string | null {
  const s = cleanText(v, 60)
  if (!s) return null
  const out = s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, '-').replace(/[^A-Z0-9._-]/g, '')
  return out || null
}

// SKU padrão da variação quando a planilha não traz: CODIGO-COR-TAMANHO
export function defaultSku(code: string, color: string | null, size: string | null): string {
  return [code, color, size].map(normalizeCode).filter(Boolean).join('-')
}

// Dinheiro digitado no padrão brasileiro ("157,90", "R$ 1.234,50") ou número
export function parseMoney(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null
  let s = String(v).replace(/[R$\s]/g, '')
  if (!s) return null
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null
}

export function parseStock(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(String(v).replace(',', '.'))
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null
}

// Preço que vale na venda: promocional quando houver e for menor
export function effectivePrice(p: { price: number; promo_price: number | null }): number {
  return p.promo_price !== null && p.promo_price < p.price ? p.promo_price : p.price
}

// Preço da cor: a cor pode ter preço e/ou promoção próprios; vazio segue a peça.
// Cor com preço próprio e sem promoção própria não herda a promoção da peça.
export function variantPrice(p: { price: number | null; promo_price: number | null }, v: { price?: number | null; promo_price?: number | null }): { price: number | null; promo_price: number | null; final: number | null } {
  const own = v.price !== null && v.price !== undefined
  const price = own ? Number(v.price) : p.price === null ? null : Number(p.price)
  const promo = v.promo_price !== null && v.promo_price !== undefined ? Number(v.promo_price) : own ? null : p.promo_price === null ? null : Number(p.promo_price)
  return { price, promo_price: promo, final: price === null ? null : effectivePrice({ price, promo_price: promo }) }
}

export function totalStock(variants: { stock: number; active: boolean }[]): number {
  return variants.filter(v => v.active).reduce((s, v) => s + v.stock, 0)
}

// Endereço público da foto (bucket público retail-media)
export function retailPhotoUrl(path: string): string {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '')
  return `${base}/storage/v1/object/public/${RETAIL_MEDIA_BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`
}
