'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  saveRetailProduct, deleteRetailProduct, createRetailPhotoUpload, attachRetailPhoto, removeRetailPhoto, moveRetailPhoto,
} from '@/lib/actions/retail-products'
import { PRODUCT_STATUSES, MAX_PHOTOS, RETAIL_MEDIA_BUCKET, retailPhotoUrl, type ProductStatus, type RetailProduct } from '@/lib/retail/products'

type VariantRow = { key: string; id?: string; sku: string; color: string; size: string; stock: string; active: boolean }

const money = (n: number | null | undefined) => (n === null || n === undefined ? '' : n.toFixed(2).replace('.', ','))
let seq = 0
const newKey = () => `n${++seq}`

const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-700 focus:outline-none'
const lbl = 'mb-1 block text-xs font-medium text-gray-600'

// Reduz a foto no próprio aparelho (lado maior 1600 px, JPEG) para a vitrine abrir rápido
async function shrinkImage(file: File): Promise<File> {
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale)
    canvas.getContext('2d')?.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    const blob: Blob | null = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.85))
    if (!blob) return file
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch {
    return file // navegador não abriu o formato: envia o original
  }
}

export function ProductForm({ product, categories }: { product: RetailProduct | null; categories: string[] }) {
  const router = useRouter()
  const [f, setF] = useState({
    code: product?.code ?? '', name: product?.name ?? '', category: product?.category ?? '',
    price: money(product?.price), promo_price: money(product?.promo_price),
    status: (product?.status ?? 'rascunho') as ProductStatus,
    description: product?.description ?? '', composition: product?.composition ?? '', care: product?.care ?? '',
    measures: product?.measures ?? '', weight_g: product?.weight_g?.toString() ?? '',
  })
  const [variants, setVariants] = useState<VariantRow[]>(
    (product?.variants ?? []).map(v => ({ key: v.id ?? newKey(), id: v.id, sku: v.sku, color: v.color ?? '', size: v.size ?? '', stock: String(v.stock), active: v.active })),
  )
  const [photos, setPhotos] = useState<string[]>(product?.photos ?? [])
  const [colorsText, setColorsText] = useState('')
  const [sizesText, setSizesText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF(prev => ({ ...prev, [k]: e.target.value }))
  const setVar = (key: string, patch: Partial<VariantRow>) => setVariants(prev => prev.map(v => (v.key === key ? { ...v, ...patch } : v)))

  // Gera as combinações cor × tamanho que ainda não existem
  function generateVariants() {
    const colors = colorsText.split(/[,;\n]/).map(s => s.trim()).filter(Boolean)
    const sizes = sizesText.split(/[,;\n]/).map(s => s.trim()).filter(Boolean)
    const cs = colors.length ? colors : ['']
    const ss = sizes.length ? sizes : ['']
    const has = new Set(variants.map(v => `${v.color.toLowerCase()}|${v.size.toLowerCase()}`))
    const add: VariantRow[] = []
    for (const c of cs) for (const s of ss) {
      if (!c && !s) continue
      const k = `${c.toLowerCase()}|${s.toLowerCase()}`
      if (has.has(k)) continue
      has.add(k)
      add.push({ key: newKey(), sku: '', color: c, size: s, stock: '0', active: true })
    }
    setVariants(prev => [...prev, ...add])
    setColorsText(''); setSizesText('')
  }

  async function save() {
    setBusy(true); setError(null); setSaved(null)
    const r = await saveRetailProduct({
      id: product?.id ?? null, ...f,
      variants: variants.map(v => ({ id: v.id ?? null, sku: v.sku, color: v.color, size: v.size, stock: v.stock, active: v.active })),
    })
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    if (!product) { router.replace(`/varejo/produtos/${r.id}`); return }
    setVariants([...r.variants]
      .sort((a, b) => `${a.color ?? ''}${a.size ?? ''}`.localeCompare(`${b.color ?? ''}${b.size ?? ''}`, 'pt-BR'))
      .map(v => ({ key: v.id ?? newKey(), id: v.id, sku: v.sku, color: v.color ?? '', size: v.size ?? '', stock: String(v.stock), active: v.active })))
    setSaved('Salvo.')
    router.refresh()
  }

  async function remove() {
    if (!product || !confirm(`Excluir a peça ${product.code}? As fotos e o estoque dela também são apagados.`)) return
    setBusy(true)
    const r = await deleteRetailProduct(product.id)
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    router.replace('/varejo/produtos')
  }

  async function uploadPhotos(files: FileList | null) {
    if (!product || !files?.length) return
    setBusy(true); setError(null)
    const sb = createClient()
    let current = photos
    for (const original of Array.from(files)) {
      if (current.length >= MAX_PHOTOS) { setError(`Máximo de ${MAX_PHOTOS} fotos por peça.`); break }
      const file = await shrinkImage(original)
      const prep = await createRetailPhotoUpload(product.id, file.name, file.type || 'image/jpeg')
      if (!prep.ok) { setError(prep.error); break }
      const up = await sb.storage.from(RETAIL_MEDIA_BUCKET).uploadToSignedUrl(prep.path, prep.token, file, { contentType: file.type || 'image/jpeg' })
      if (up.error) { setError(`Falha ao enviar a foto: ${up.error.message}`); break }
      const att = await attachRetailPhoto(product.id, prep.path)
      if (!att.ok) { setError(att.error); break }
      current = att.photos
      setPhotos(current)
    }
    setBusy(false)
  }

  async function photoAction(fn: () => Promise<{ ok: true; photos: string[] } | { ok: false; error: string }>) {
    setBusy(true); setError(null)
    const r = await fn()
    setBusy(false)
    if (!r.ok) setError(r.error); else setPhotos(r.photos)
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">Dados da peça</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label className={lbl}>Código *</label><input className={inp} value={f.code} onChange={set('code')} placeholder="ex.: PC682" /></div>
          <div><label className={lbl}>Nome *</label><input className={inp} value={f.name} onChange={set('name')} placeholder="ex.: Calça Paris" /></div>
          <div>
            <label className={lbl}>Categoria</label>
            <input className={inp} value={f.category} onChange={set('category')} list="retail-categories" placeholder="ex.: Calças" />
            <datalist id="retail-categories">{categories.map(c => <option key={c} value={c} />)}</datalist>
          </div>
          <div>
            <label className={lbl}>Situação</label>
            <select className={inp} value={f.status} onChange={set('status')}>
              {PRODUCT_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          <div><label className={lbl}>Preço (R$) *</label><input className={inp} inputMode="decimal" value={f.price} onChange={set('price')} placeholder="157,90" /></div>
          <div><label className={lbl}>Preço promocional (R$)</label><input className={inp} inputMode="decimal" value={f.promo_price} onChange={set('promo_price')} placeholder="em branco = sem promoção" /></div>
        </div>
        <div><label className={lbl}>Descrição</label><textarea className={inp} rows={3} value={f.description} onChange={set('description')} /></div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label className={lbl}>Composição / tecido</label><input className={inp} value={f.composition} onChange={set('composition')} /></div>
          <div><label className={lbl}>Peso (g), para frete</label><input className={inp} inputMode="numeric" value={f.weight_g} onChange={set('weight_g')} /></div>
        </div>
        <div><label className={lbl}>Medidas e caimento</label><textarea className={inp} rows={2} value={f.measures} onChange={set('measures')} /></div>
        <div><label className={lbl}>Cuidados de conservação</label><textarea className={inp} rows={2} value={f.care} onChange={set('care')} /></div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Variações e estoque</h2>
          <p className="text-xs text-gray-500">Cada cor e tamanho tem estoque próprio. SKU em branco = o CRM monta CÓDIGO-COR-TAMANHO.</p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input className={inp} value={colorsText} onChange={e => setColorsText(e.target.value)} placeholder="Cores: Preto, Areia, Verde oliva" />
          <input className={inp} value={sizesText} onChange={e => setSizesText(e.target.value)} placeholder="Tamanhos: P, M, G, GG" />
          <button type="button" onClick={generateVariants} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">Gerar combinações</button>
        </div>
        {variants.length === 0 ? (
          <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">Nenhuma variação. Gere as combinações acima ou adicione uma linha.</p>
        ) : (
          <div className="space-y-2">
            {variants.map(v => (
              <div key={v.key} className="grid grid-cols-2 gap-2 rounded-lg border border-gray-100 p-2 sm:grid-cols-[1fr_0.7fr_1fr_0.6fr_auto_auto] sm:items-center">
                <input className={inp} value={v.color} onChange={e => setVar(v.key, { color: e.target.value })} placeholder="Cor" />
                <input className={inp} value={v.size} onChange={e => setVar(v.key, { size: e.target.value })} placeholder="Tamanho" />
                <input className={inp} value={v.sku} onChange={e => setVar(v.key, { sku: e.target.value })} placeholder="SKU (opcional)" />
                <input className={inp} inputMode="numeric" value={v.stock} onChange={e => setVar(v.key, { stock: e.target.value })} placeholder="Estoque" aria-label="Estoque" />
                <label className="flex items-center gap-1 text-xs text-gray-600"><input type="checkbox" checked={v.active} onChange={e => setVar(v.key, { active: e.target.checked })} /> Ativa</label>
                <button type="button" onClick={() => setVariants(prev => prev.filter(x => x.key !== v.key))} className="text-xs text-negative-700 hover:underline">Remover</button>
              </div>
            ))}
          </div>
        )}
        <button type="button" onClick={() => setVariants(prev => [...prev, { key: newKey(), sku: '', color: '', size: '', stock: '0', active: true }])} className="text-sm text-brand-700 hover:underline">+ Adicionar linha</button>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Fotos</h2>
          <p className="text-xs text-gray-500">{product ? `Até ${MAX_PHOTOS} fotos. A primeira é a capa da vitrine.` : 'Salve a peça para adicionar fotos.'}</p>
        </div>
        {product && (
          <>
            {photos.length > 0 && (
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {photos.map((p, i) => (
                  <li key={p} className="space-y-1">
                    <div className="aspect-[3/4] overflow-hidden rounded-lg bg-gray-100">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={retailPhotoUrl(p)} alt="" className="h-full w-full object-cover" />
                    </div>
                    <div className="flex justify-between text-xs">
                      <button type="button" disabled={busy || i === 0} onClick={() => photoAction(() => moveRetailPhoto(product.id, p, -1))} className="text-gray-600 disabled:opacity-30">←</button>
                      <button type="button" disabled={busy} onClick={() => photoAction(() => removeRetailPhoto(product.id, p))} className="text-negative-700">Remover</button>
                      <button type="button" disabled={busy || i === photos.length - 1} onClick={() => photoAction(() => moveRetailPhoto(product.id, p, 1))} className="text-gray-600 disabled:opacity-30">→</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <label className={`inline-block cursor-pointer rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 ${busy || photos.length >= MAX_PHOTOS ? 'pointer-events-none opacity-50' : ''}`}>
              Adicionar fotos
              <input type="file" accept="image/*" multiple className="hidden" onChange={e => { void uploadPhotos(e.target.files); e.target.value = '' }} />
            </label>
          </>
        )}
      </section>

      {error && <p role="alert" className="rounded-lg bg-negative-100 px-3 py-2 text-sm text-negative-700">{error}</p>}
      {saved && <p role="status" className="rounded-lg bg-positive-100 px-3 py-2 text-sm text-positive-700">{saved}</p>}

      <div className="sticky bottom-0 flex items-center justify-between gap-2 border-t border-gray-200 bg-white/95 py-3">
        {product ? <button type="button" onClick={remove} disabled={busy} className="text-sm text-negative-700 hover:underline disabled:opacity-50">Excluir peça</button> : <span />}
        <button type="button" onClick={save} disabled={busy} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">{busy ? 'Salvando…' : product ? 'Salvar' : 'Criar peça'}</button>
      </div>
    </div>
  )
}
