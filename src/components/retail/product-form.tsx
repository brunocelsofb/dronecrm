'use client'

// Cadastro da peça em passos, pensado para quem não é técnico:
// 1. Dados da peça · 2. Cores, tamanhos e quantidades (grade) · 3. Fotos · 4. Vitrine.
// A grade cor × tamanho é o estoque: cada quadradinho é uma variação (SKU) com saldo próprio.

import { useMemo, useState } from 'react'
import { fitPhoto, PHOTO_FRAMES } from '@/lib/retail/image-fit'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  saveRetailProduct, deleteRetailProduct, createRetailPhotoUpload, attachRetailPhoto, removeRetailPhoto, moveRetailPhoto, setRetailPhotoMeta,
} from '@/lib/actions/retail-products'
import { isAiPhotoPath, missingModelColors, type PhotoMeta } from '@/lib/retail/photo-colors'
import { MAX_PHOTOS, RETAIL_MEDIA_BUCKET, effectivePrice, parseMoney, retailPhotoUrl, type ProductStatus, type RetailProduct } from '@/lib/retail/products'
import { analyzePrice, priceMemory, referencePrice, requiredMarginPct, type LoyaltySettings, type PricingSettings } from '@/lib/retail/margin'
import { fmtBRL, fmtNum1, fmtPct } from '@/lib/format'
import Link from 'next/link'

type Cell = { id?: string; sku: string; stock: string; active: boolean }

const money = (n: number | null | undefined) => (n === null || n === undefined ? '' : n.toFixed(2).replace('.', ','))
const keyOf = (color: string, size: string) => `${color}\u0000${size}`
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-700 focus:outline-none'
const lbl = 'mb-1 block text-sm font-medium text-gray-800'
const hint = 'mt-1 text-xs text-gray-500'

const SIZE_PRESETS: { label: string; sizes: string[] }[] = [
  { label: 'PP ao GG', sizes: ['PP', 'P', 'M', 'G', 'GG'] },
  { label: '36 ao 46', sizes: ['36', '38', '40', '42', '44', '46'] },
  { label: 'Tamanho único', sizes: [''] },
]

const VISIBILITY: { id: ProductStatus; title: string; text: string }[] = [
  { id: 'rascunho', title: 'Rascunho', text: 'Ainda estou montando. Não aparece para as clientes.' },
  { id: 'publicado', title: 'Publicada', text: 'Aparece na vitrine e pode ser vendida.' },
  { id: 'arquivado', title: 'Arquivada', text: 'Saiu de linha. Fica só no histórico de pedidos.' },
]

function initialGrid(product: RetailProduct | null) {
  const colors: string[] = [], sizes: string[] = []
  const cells: Record<string, Cell> = {}
  for (const v of product?.variants ?? []) {
    const c = v.color ?? '', s = v.size ?? ''
    if (!colors.includes(c)) colors.push(c)
    if (!sizes.includes(s)) sizes.push(s)
    cells[keyOf(c, s)] = { id: v.id, sku: v.sku, stock: String(v.stock), active: v.active }
  }
  return { colors, sizes, cells }
}

function Step({ n, title, done, children, id }: { n: number; title: string; done?: boolean; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="scroll-mt-20 space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${done ? 'bg-positive-600 text-white' : 'bg-brand-100 text-brand-800'}`}>{done ? '✓' : n}</span>
        {title}
      </h2>
      {children}
    </section>
  )
}

export function ProductForm({ product, categories, justCreated, pricing, loyalty, occasions = [] }: { product: RetailProduct | null; categories: string[]; justCreated?: boolean; pricing: PricingSettings; loyalty: LoyaltySettings; occasions?: { id: string; name: string }[] }) {
  const router = useRouter()
  const [f, setF] = useState({
    code: product?.code ?? '', name: product?.name ?? '', category: product?.category ?? '',
    price: money(product?.price), promo_price: money(product?.promo_price), cost_price: money(product?.cost_price),
    status: (product?.status ?? 'rascunho') as ProductStatus,
    description: product?.description ?? '', composition: product?.composition ?? '', care: product?.care ?? '',
    measures: product?.measures ?? '', weight_g: product?.weight_g?.toString() ?? '',
  })
  const [occ, setOcc] = useState<string[]>(product?.occasions ?? [])
  const init = useMemo(() => initialGrid(product), [product])
  const [colors, setColors] = useState<string[]>(init.colors)
  const [sizes, setSizes] = useState<string[]>(init.sizes)
  const [cells, setCells] = useState<Record<string, Cell>>(init.cells)
  const [colorText, setColorText] = useState('')
  const [sizeText, setSizeText] = useState('')
  const [photos, setPhotos] = useState<string[]>(product?.photos ?? [])
  const [meta, setMeta] = useState<PhotoMeta>(product?.photo_meta ?? {})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF(prev => ({ ...prev, [k]: e.target.value }))

  const hasGrid = colors.length > 0 || sizes.length > 0
  const rowList = colors.length ? colors : ['']
  const colList = sizes.length ? sizes : ['']
  const totalUnits = Object.values(cells).reduce((s, c) => s + (c.active ? Math.max(0, Math.floor(Number(c.stock.replace(',', '.')) || 0)) : 0), 0)

  // Acrescenta cores (ou tamanhos) e cria os quadradinhos que faltam, com quantidade 0
  function addValues(kind: 'color' | 'size', raw: string[]) {
    const list = kind === 'color' ? colors : sizes
    const other = kind === 'color' ? colList : rowList
    const values = raw.map(v => v.trim().slice(0, kind === 'color' ? 60 : 20))
    const fresh = values.filter((v, i) => values.findIndex(x => same(x, v)) === i && !list.some(x => same(x, v)))
    if (!fresh.length) return
    let next = [...list]
    const nextCells = { ...cells }
    // "Única" ('') vira o primeiro valor de verdade, levando as quantidades já digitadas
    if (next.length === 1 && next[0] === '' && fresh[0] !== '') {
      const first = fresh.shift()!
      for (const o of other) {
        const from = kind === 'color' ? keyOf('', o) : keyOf(o, '')
        const to = kind === 'color' ? keyOf(first, o) : keyOf(o, first)
        if (nextCells[from]) { nextCells[to] = nextCells[from]; delete nextCells[from] }
      }
      next = [first]
    }
    for (const v of fresh) {
      if (v === '' && next.length) continue
      next.push(v)
      for (const o of other) {
        const k = kind === 'color' ? keyOf(v, o) : keyOf(o, v)
        if (!nextCells[k]) nextCells[k] = { sku: '', stock: '0', active: true }
      }
    }
    if (kind === 'color') { setColors(next); if (!sizes.length) setSizes(['']) } else { setSizes(next); if (!colors.length) setColors(['']) }
    // Primeiro valor da outra dimensão ainda não existe: cria a linha/coluna "única"
    if ((kind === 'color' && !sizes.length) || (kind === 'size' && !colors.length)) {
      for (const v of next) {
        const k = kind === 'color' ? keyOf(v, '') : keyOf('', v)
        if (!nextCells[k]) nextCells[k] = { sku: '', stock: '0', active: true }
      }
    }
    setCells(nextCells)
  }

  function removeValue(kind: 'color' | 'size', value: string) {
    const list = kind === 'color' ? colors : sizes
    const label = value || (kind === 'color' ? 'Cor única' : 'Tamanho único')
    if (!confirm(`Tirar "${label}" desta peça? As quantidades dela saem do estoque.`)) return
    const nextCells = { ...cells }
    for (const k of Object.keys(nextCells)) {
      const [c, s] = k.split('\u0000')
      if ((kind === 'color' ? c : s) === value) delete nextCells[k]
    }
    const next = list.filter(v => v !== value)
    if (kind === 'color') setColors(next); else setSizes(next)
    setCells(nextCells)
  }

  const setCell = (k: string, patch: Partial<Cell>) => setCells(prev => ({ ...prev, [k]: { ...(prev[k] ?? { sku: '', stock: '0', active: true }), ...patch } }))

  function suggestCode() {
    const base = f.name.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) || 'PC'
    setF(prev => ({ ...prev, code: `${base}${String(Math.floor(Math.random() * 900) + 100)}` }))
  }

  async function save() {
    setBusy(true); setError(null); setSaved(null)
    const variants = Object.entries(cells).map(([k, c]) => {
      const [color, size] = k.split('\u0000')
      return { id: c.id ?? null, sku: c.sku, color, size, stock: c.stock, active: c.active }
    })
    if (!variants.length) {
      setBusy(false)
      setError('Falta o passo 2: diga as cores e os tamanhos da peça e quantas unidades você tem de cada um.')
      document.getElementById('estoque')?.scrollIntoView({ behavior: 'smooth' })
      return
    }
    const r = await saveRetailProduct({ id: product?.id ?? null, ...f, occasions: occ, variants })
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    if (!product) { router.replace(`/varejo/produtos/${r.id}?criada=1#fotos`); return }
    const g = initialGrid({ ...product, variants: r.variants })
    // mantém a ordem que a pessoa montou
    setCells(g.cells)
    setColors(prev => [...prev.filter(c => g.colors.includes(c)), ...g.colors.filter(c => !prev.includes(c))])
    setSizes(prev => [...prev.filter(s => g.sizes.includes(s)), ...g.sizes.filter(s => !prev.includes(s))])
    setSaved('Alterações salvas.')
    router.refresh()
  }

  async function remove() {
    if (!product || !confirm(`Excluir a peça ${product.code}? As fotos e o estoque dela também são apagados. Pedidos antigos continuam no histórico.`)) return
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
      const file = await fitPhoto(original, PHOTO_FRAMES.produto)
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

  async function setPhotoInfo(path: string, info: { color: string | null; model: boolean }) {
    if (!product) return
    setBusy(true); setError(null)
    const r = await setRetailPhotoMeta(product.id, path, info)
    setBusy(false)
    if (!r.ok) setError(r.error); else setMeta(r.meta)
  }
  const realColors = colors.filter(Boolean)
  const infoOf = (p: string) => meta[p] ?? { color: null, model: isAiPhotoPath(p) }
  const missingModel = missingModelColors(photos, Object.fromEntries(photos.map(p => [p, infoOf(p)])), realColors)

  const dataDone = !!f.code.trim() && !!f.name.trim() && !!f.price.trim()
  const stockDone = hasGrid && totalUnits > 0
  const photosDone = photos.length > 0
  const missing = [!dataDone && 'nome, código e preço (passo 1)', !stockDone && 'quantidades (passo 2)', !photosDone && 'fotos (passo 3)'].filter(Boolean) as string[]

  return (
    <div className="space-y-4">
      {justCreated && (
        <p role="status" className="rounded-lg bg-positive-100 px-4 py-3 text-sm text-positive-700">
          Peça criada. Agora adicione as fotos no passo 3 e, quando estiver tudo certo, escolha <strong>Publicada</strong> no passo 4.
        </p>
      )}

      <Step n={1} title="Dados da peça" done={dataDone}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={lbl} htmlFor="p-name">Nome da peça *</label>
            <input id="p-name" className={inp} value={f.name} onChange={set('name')} placeholder="ex.: Calça Paris" />
            <p className={hint}>Como a cliente vai ver na vitrine.</p>
          </div>
          <div>
            <label className={lbl} htmlFor="p-code">Código *</label>
            <div className="flex gap-2">
              <input id="p-code" className={inp} value={f.code} onChange={set('code')} placeholder="ex.: PC682" />
              <button type="button" onClick={suggestCode} className="shrink-0 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-700 hover:bg-gray-50">Criar um</button>
            </div>
            <p className={hint}>O código da etiqueta, se você já usa. Não usa? Toque em &quot;Criar um&quot;.</p>
          </div>
          <div className="sm:col-span-2">
            <label className={lbl} htmlFor="p-cat">Categoria</label>
            <input id="p-cat" className={inp} value={f.category} onChange={set('category')} list="retail-categories" placeholder="ex.: Calças, Vestidos, Blusas" />
            <datalist id="retail-categories">{categories.map(c => <option key={c} value={c} />)}</datalist>
            <p className={hint}>Agrupa as peças na vitrine. Comece a digitar para reaproveitar uma que já existe.</p>
          </div>
        </div>
        <PricePanel f={f} setPrice={v => setF(prev => ({ ...prev, price: v }))} setPromo={v => setF(prev => ({ ...prev, promo_price: v }))} setCost={v => setF(prev => ({ ...prev, cost_price: v }))} pricing={pricing} loyalty={loyalty} />
        <details className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium text-brand-700">Detalhes para a vitrine (opcional, ajuda a vender)</summary>
          <div className="mt-3 space-y-3">
            <div><label className={lbl}>Descrição</label><textarea className={inp} rows={3} value={f.description} onChange={set('description')} placeholder="ex.: Calça de alfaiataria com cintura alta e caimento reto. Vai do trabalho ao jantar." /></div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div><label className={lbl}>Tecido / composição</label><input className={inp} value={f.composition} onChange={set('composition')} placeholder="ex.: 96% poliéster, 4% elastano" /></div>
              <div><label className={lbl}>Peso em gramas</label><input className={inp} inputMode="numeric" value={f.weight_g} onChange={set('weight_g')} placeholder="ex.: 350" /><p className={hint}>Usado para calcular frete.</p></div>
            </div>
            <div><label className={lbl}>Medidas e caimento</label><textarea className={inp} rows={2} value={f.measures} onChange={set('measures')} placeholder="ex.: P: cintura 68 cm, quadril 96 cm. A modelo veste P e tem 1,68 m." /></div>
            <div><label className={lbl}>Cuidados de lavagem</label><textarea className={inp} rows={2} value={f.care} onChange={set('care')} placeholder="ex.: Lavar à mão, não usar alvejante, passar em temperatura baixa." /></div>
          </div>
        </details>
      </Step>

      <Step n={2} id="estoque" title="Cores, tamanhos e quantidades" done={stockDone}>
        <p className="text-sm text-gray-600">Diga quais cores e tamanhos esta peça tem. Depois, na grade, escreva <strong>quantas unidades você tem</strong> de cada combinação.</p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <p className={lbl}>Cores</p>
            <div className="flex gap-2">
              <input className={inp} value={colorText} onChange={e => setColorText(e.target.value)} placeholder="ex.: Preto"
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addValues('color', colorText.split(/[,;]/)); setColorText('') } }} />
              <button type="button" onClick={() => { addValues('color', colorText.split(/[,;]/).filter(s => s.trim())); setColorText('') }} disabled={!colorText.trim()}
                className="shrink-0 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40">Incluir</button>
            </div>
            <p className={hint}>Uma de cada vez, ou várias separadas por vírgula. Só uma cor? Pode pular.</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {colors.map(c => (
                <span key={`c-${c}`} className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-2.5 py-1 text-xs text-brand-800">
                  {c || 'Cor única'}
                  <button type="button" aria-label={`Tirar ${c || 'cor única'}`} onClick={() => removeValue('color', c)} className="text-brand-700 hover:text-negative-700">×</button>
                </span>
              ))}
            </div>
          </div>
          <div>
            <p className={lbl}>Tamanhos</p>
            <div className="flex gap-2">
              <input className={inp} value={sizeText} onChange={e => setSizeText(e.target.value)} placeholder="ex.: M"
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addValues('size', sizeText.split(/[,;]/)); setSizeText('') } }} />
              <button type="button" onClick={() => { addValues('size', sizeText.split(/[,;]/).filter(s => s.trim())); setSizeText('') }} disabled={!sizeText.trim()}
                className="shrink-0 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40">Incluir</button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className="text-xs text-gray-500">Atalhos:</span>
              {SIZE_PRESETS.map(p => (
                <button key={p.label} type="button" onClick={() => addValues('size', p.sizes)} className="rounded-full border border-gray-300 bg-white px-2.5 py-0.5 text-xs text-gray-700 hover:bg-gray-50">{p.label}</button>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {sizes.map(s => (
                <span key={`s-${s}`} className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-2.5 py-1 text-xs text-brand-800">
                  {s || 'Tamanho único'}
                  <button type="button" aria-label={`Tirar ${s || 'tamanho único'}`} onClick={() => removeValue('size', s)} className="text-brand-700 hover:text-negative-700">×</button>
                </span>
              ))}
            </div>
          </div>
        </div>

        {!hasGrid ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-4 text-sm text-gray-600">
            Inclua pelo menos uma cor ou um tamanho. A grade de quantidades aparece aqui.
            <button type="button" onClick={() => addValues('size', [''])} className="mt-2 block text-brand-700 hover:underline">A peça tem uma cor e um tamanho só →</button>
          </div>
        ) : (
          <div>
            <p className="mb-2 text-sm font-medium text-gray-800">Quantas unidades você tem?</p>
            <div className="overflow-x-auto">
              <table className="text-sm">
                <thead>
                  <tr>
                    <th className="px-2 py-1 text-left text-xs font-medium text-gray-500">Cor \ Tamanho</th>
                    {colList.map(s => <th key={`h-${s}`} className="px-1 py-1 text-center text-xs font-semibold text-gray-700">{s || 'Único'}</th>)}
                    <th className="px-2 py-1 text-right text-xs font-medium text-gray-500">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {rowList.map(c => {
                    const rowTotal = colList.reduce((s, sz) => { const cell = cells[keyOf(c, sz)]; return s + (cell?.active ? Math.max(0, Math.floor(Number(cell.stock.replace(',', '.')) || 0)) : 0) }, 0)
                    return (
                      <tr key={`r-${c}`} className="border-t border-gray-100">
                        <td className="whitespace-nowrap px-2 py-1.5 text-gray-800">{c || 'Cor única'}</td>
                        {colList.map(sz => {
                          const k = keyOf(c, sz)
                          const cell = cells[k]
                          if (!cell) {
                            return (
                              <td key={k} className="px-1 py-1 text-center">
                                <button type="button" onClick={() => setCell(k, {})} title="Esta combinação não existe. Toque para incluir." className="h-9 w-14 rounded-lg border border-dashed border-gray-300 text-xs text-gray-400 hover:border-brand-700 hover:text-brand-700">+ incluir</button>
                              </td>
                            )
                          }
                          return (
                            <td key={k} className="px-1 py-1 text-center">
                              <input inputMode="numeric" value={cell.stock} disabled={!cell.active}
                                onFocus={e => e.target.select()}
                                onChange={e => setCell(k, { stock: e.target.value.replace(/[^\d]/g, '') })}
                                aria-label={`Quantidade ${c || 'cor única'} ${sz || 'tamanho único'}`}
                                className={`h-9 w-14 rounded-lg border text-center text-sm focus:border-brand-700 focus:outline-none disabled:bg-gray-100 disabled:text-gray-400 ${cell.stock === '0' || cell.stock === '' ? 'border-warn-600/50 bg-warn-100/40' : 'border-gray-300'}`} />
                            </td>
                          )
                        })}
                        <td className="px-2 py-1.5 text-right font-medium text-gray-900">{rowTotal}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className={`mt-2 text-sm ${totalUnits > 0 ? 'text-gray-700' : 'text-warn-700'}`}>
              {totalUnits > 0
                ? <>Total: <strong>{totalUnits}</strong> unidade(s). O estoque baixa sozinho quando um pedido é marcado como pago.</>
                : 'Tudo está em 0: a peça aparece como esgotada. Escreva a quantidade em cada quadradinho.'}
            </p>

            <details className="mt-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium text-brand-700">Códigos (SKU) e combinações pausadas (opcional)</summary>
              <p className={hint}>SKU em branco: o sistema cria sozinho (CÓDIGO-COR-TAMANHO). Pausar tira a combinação da vitrine sem apagar.</p>
              <div className="mt-2 space-y-2">
                {rowList.flatMap(c => colList.map(sz => ({ c, sz, k: keyOf(c, sz) }))).filter(x => cells[x.k]).map(({ c, sz, k }) => (
                  <div key={`a-${k}`} className="grid grid-cols-[1fr_1.2fr_auto] items-center gap-2 text-sm">
                    <span className="text-gray-700">{c || 'Cor única'} · {sz || 'Único'}</span>
                    <input className={inp} value={cells[k].sku} onChange={e => setCell(k, { sku: e.target.value })} placeholder="SKU automático" />
                    <label className="flex items-center gap-1 whitespace-nowrap text-xs text-gray-600">
                      <input type="checkbox" checked={!cells[k].active} onChange={e => setCell(k, { active: !e.target.checked })} /> Pausada
                    </label>
                  </div>
                ))}
              </div>
            </details>
          </div>
        )}
      </Step>

      <Step n={3} id="fotos" title="Fotos" done={photosDone}>
        {!product ? (
          <p className="rounded-lg bg-gray-50 px-3 py-3 text-sm text-gray-600">As fotos entram logo depois de criar a peça. Toque em <strong>Criar peça</strong> lá embaixo; a tela volta aqui.</p>
        ) : (
          <>
            <p className="text-xs text-gray-500">Pode mandar a foto como estiver: o Drone deixa no tamanho da vitrine (<strong>1200 × 1600 px, em pé 3 : 4</strong>). Foto deitada ou quadrada entra <strong>inteira</strong>, com o fundo da própria foto desfocado, sem cortar a peça. Melhor resultado: foto em pé, peça inteira e fundo limpo.</p>
            <p className="text-sm text-gray-600">Até {MAX_PHOTOS} fotos, direto da galeria do celular. A <strong>primeira</strong> é a capa na vitrine; use as setas para mudar a ordem.</p>
            {realColors.length > 1 && (
              <div className="rounded-lg border border-brand-700/30 bg-brand-100/40 p-3 text-xs text-gray-700">
                <p><strong>Peça com {realColors.length} cores:</strong> marque a cor de cada foto. Na vitrine, a cliente toca na cor e a foto troca. Foto sem cor marcada aparece em todas as cores.</p>
                <p className="mt-1">Para a foto com modelo de cada cor, suba uma <strong>foto real da peça em cada cor</strong> e use o <Link href="/varejo/estudio" className="text-brand-700 underline">Estúdio IA</Link>.</p>
                {missingModel.length > 0 && <p className="mt-1 font-medium text-warn-700">Falta foto com modelo: {missingModel.map(m => m.color).join(', ')}.</p>}
              </div>
            )}
            {photos.length > 0 && (
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {photos.map((p, i) => (
                  <li key={p} className="space-y-1">
                    <div className="relative aspect-[3/4] overflow-hidden rounded-lg bg-gray-100">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={retailPhotoUrl(p)} alt="" className="h-full w-full object-cover" />
                      {i === 0 && <span className="absolute left-1 top-1 rounded bg-white/90 px-1.5 py-0.5 text-[10px] font-medium text-gray-800">Capa</span>}
                      {infoOf(p).model && <span className="absolute bottom-1 left-1 rounded bg-white/90 px-1.5 py-0.5 text-[10px] text-gray-800">{isAiPhotoPath(p) ? 'Com modelo (IA)' : 'Com modelo'}</span>}
                    </div>
                    {realColors.length > 0 && (
                      <select className="w-full rounded border border-gray-300 px-1 py-0.5 text-[11px]" aria-label={`Cor da foto ${i + 1}`} disabled={busy}
                        value={infoOf(p).color ?? ''} onChange={e => setPhotoInfo(p, { color: e.target.value || null, model: infoOf(p).model })}>
                        <option value="">Todas as cores</option>
                        {realColors.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    )}
                    {!isAiPhotoPath(p) && (
                      <label className="flex items-center gap-1 text-[11px] text-gray-600"><input type="checkbox" className="h-3 w-3" disabled={busy} checked={infoOf(p).model} onChange={e => setPhotoInfo(p, { color: infoOf(p).color, model: e.target.checked })} />Com modelo</label>
                    )}
                    <div className="flex justify-between text-xs">
                      <button type="button" aria-label="Mover para a esquerda" disabled={busy || i === 0} onClick={() => photoAction(() => moveRetailPhoto(product.id, p, -1))} className="px-1 text-gray-600 disabled:opacity-30">←</button>
                      <button type="button" disabled={busy} onClick={() => photoAction(() => removeRetailPhoto(product.id, p))} className="text-negative-700">Remover</button>
                      <button type="button" aria-label="Mover para a direita" disabled={busy || i === photos.length - 1} onClick={() => photoAction(() => moveRetailPhoto(product.id, p, 1))} className="px-1 text-gray-600 disabled:opacity-30">→</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <label className={`inline-block cursor-pointer rounded-lg border border-brand-700 bg-white px-4 py-2 text-sm font-medium text-brand-700 hover:bg-brand-100 ${busy || photos.length >= MAX_PHOTOS ? 'pointer-events-none opacity-50' : ''}`}>
              {busy ? 'Enviando…' : photos.length ? 'Adicionar mais fotos' : 'Escolher fotos'}
              <input type="file" accept="image/*" multiple className="hidden" onChange={e => { void uploadPhotos(e.target.files); e.target.value = '' }} />
            </label>
            <p className={hint}>Dica: fundo claro, luz natural e a peça inteira aparecendo vendem mais.</p>
          </>
        )}
      </Step>

      <Step n={4} title="Mostrar na vitrine?" done={f.status === 'publicado'}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {VISIBILITY.map(v => (
            <label key={v.id} className={`cursor-pointer rounded-lg border p-3 ${f.status === v.id ? 'border-brand-700 bg-brand-100/50' : 'border-gray-200 hover:border-gray-300'}`}>
              <span className="flex items-center gap-2 text-sm font-medium text-gray-900">
                <input type="radio" name="status" checked={f.status === v.id} onChange={() => setF(prev => ({ ...prev, status: v.id }))} />
                {v.title}
              </span>
              <span className="mt-1 block text-xs text-gray-500">{v.text}</span>
            </label>
          ))}
        </div>
        <div className="rounded-lg border border-gray-200 p-3">
          <p className="text-sm font-medium text-gray-900">Para quais ocasiões? <span className="font-normal text-gray-500">(a cliente filtra a vitrine por ocasião)</span></p>
          {occasions.length === 0 ? (
            <p className="mt-1 text-xs text-gray-500">Nenhuma ocasião cadastrada. Crie em <Link href="/varejo/vitrine" className="text-brand-700 hover:underline">Varejo → Vitrine</Link> (ex.: Trabalho, Igreja, Festa).</p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              {occasions.map(o => (
                <label key={o.id} className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${occ.includes(o.id) ? 'border-brand-700 bg-brand-100/50 text-brand-800' : 'border-gray-300 text-gray-700'}`}>
                  <input type="checkbox" className="h-3.5 w-3.5" checked={occ.includes(o.id)} onChange={e => setOcc(prev => e.target.checked ? [...prev, o.id] : prev.filter(x => x !== o.id))} />
                  {o.name}
                </label>
              ))}
            </div>
          )}
        </div>
        {f.status === 'publicado' && missing.length > 0 && (
          <p className="rounded-lg bg-warn-100 px-3 py-2 text-sm text-warn-700">Pode publicar assim, mas ainda falta: {missing.join(', ')}.</p>
        )}
      </Step>

      {error && <p role="alert" className="rounded-lg bg-negative-100 px-3 py-2 text-sm text-negative-700">{error}</p>}
      {saved && <p role="status" className="rounded-lg bg-positive-100 px-3 py-2 text-sm text-positive-700">{saved}</p>}

      <div className="sticky bottom-0 flex items-center justify-between gap-2 border-t border-gray-200 bg-white/95 py-3">
        {product ? <button type="button" onClick={remove} disabled={busy} className="text-sm text-negative-700 hover:underline disabled:opacity-50">Excluir peça</button> : <span />}
        <button type="button" onClick={save} disabled={busy} className="rounded-lg bg-brand-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">
          {busy ? 'Salvando…' : product ? 'Salvar alterações' : 'Criar peça'}
        </button>
      </div>
    </div>
  )
}

// Custo da peça e o que o preço deixa de ganho (só no CRM; nunca vai para a vitrine)
function PricePanel({ f, setPrice, setPromo, setCost, pricing, loyalty }: {
  f: { price: string; promo_price: string; cost_price: string }; setPrice: (v: string) => void; setPromo: (v: string) => void; setCost: (v: string) => void
  pricing: PricingSettings; loyalty: LoyaltySettings
}) {
  const cost = parseMoney(f.cost_price) ?? 0
  const price = parseMoney(f.price)
  const promo = parseMoney(f.promo_price)
  const selling = price !== null ? effectivePrice({ price, promo_price: promo }) : null
  const ref = referencePrice(cost, pricing, loyalty)
  const a = selling !== null && cost > 0 ? analyzePrice(selling, cost, pricing, loyalty) : null
  const configured = pricing.tax_pct + pricing.card_pct + pricing.other_pct + pricing.per_piece + pricing.fixed_monthly > 0
  const tone = !a ? '' : a.contribution < 0 ? 'border-negative-600/40 bg-negative-100/50' : a.marginPct + 1e-9 < requiredMarginPct(pricing) ? 'border-warn-600/40 bg-warn-100/50' : 'border-positive-600/40 bg-positive-100/50'
  const refText = ref.ok && cost > 0 ? ref.price.toFixed(2).replace('.', ',') : ''
  // Custo primeiro: com o preço vazio, o preço de referência entra sozinho (dá para ajustar)
  const fillFromCost = () => { if (!f.price.trim() && refText) setPrice(refText) }
  return (
    <div className="space-y-3 rounded-lg border border-gray-200 p-3">
      <p className="text-sm font-semibold text-gray-900">Custo e preço</p>
      <div className="max-w-xs">
        <label className={lbl} htmlFor="p-cost">1. Custo da peça</label>
        <div className="flex items-center rounded-lg border border-gray-300 focus-within:border-brand-700">
          <span className="pl-3 text-sm text-gray-500">R$</span>
          <input id="p-cost" className="w-full rounded-lg px-2 py-2 text-sm focus:outline-none" inputMode="decimal" value={f.cost_price} onChange={e => setCost(e.target.value)} onBlur={fillFromCost} placeholder="quanto você pagou" />
        </div>
        <p className={hint}>Só você vê. Nunca aparece na vitrine. Com o custo, o Drone sugere o preço pelo seu markup e margem.</p>
      </div>
      {cost > 0 && (ref.ok ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-brand-100/60 px-3 py-2 text-sm text-brand-800">
          <span>Preço de referência (todos os custos + {fmtPct(pricing.target_margin_pct)} de lucro): <strong>{fmtBRL(ref.price)}</strong> (markup {fmtNum1(ref.markup)})</span>
          <button type="button" onClick={() => setPrice(refText)} className="rounded-lg border border-brand-700 bg-white px-3 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100">Usar este preço</button>
        </div>
      ) : <p className="rounded-lg bg-warn-100 px-3 py-2 text-sm text-warn-700">{ref.reason}</p>)}
      {cost > 0 && <PriceMemoryBox cost={cost} pricing={pricing} loyalty={loyalty} selling={selling} />}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={lbl} htmlFor="p-price">2. Preço de venda *</label>
          <div className="flex items-center rounded-lg border border-gray-300 focus-within:border-brand-700">
            <span className="pl-3 text-sm text-gray-500">R$</span>
            <input id="p-price" className="w-full rounded-lg px-2 py-2 text-sm focus:outline-none" inputMode="decimal" value={f.price} onChange={e => setPrice(e.target.value)} placeholder={refText || '157,90'} />
          </div>
          {cost > 0 && refText && f.price.trim() === refText && <p className={hint}>Preço de referência. Ajuste se quiser.</p>}
        </div>
        <div>
          <label className={lbl} htmlFor="p-promo">Preço de promoção</label>
          <div className="flex items-center rounded-lg border border-gray-300 focus-within:border-brand-700">
            <span className="pl-3 text-sm text-gray-500">R$</span>
            <input id="p-promo" className="w-full rounded-lg px-2 py-2 text-sm focus:outline-none" inputMode="decimal" value={f.promo_price} onChange={e => setPromo(e.target.value)} placeholder="vazio se não estiver em promoção" />
          </div>
          <p className={hint}>Na vitrine aparece o preço normal riscado ao lado.</p>
        </div>
      </div>
      {cost <= 0 ? (
        <p className="text-sm text-gray-500">Informe o custo para ver o preço sugerido e quanto cada venda deixa para você.</p>
      ) : (
        <>
          {a && (
            <div className={`rounded-lg border px-3 py-2 text-sm ${tone}`}>
              <p className="font-medium text-gray-900">Vendendo a {fmtBRL(a.price)}{promo !== null && price !== null && promo < price ? ' (preço de promoção)' : ''}:</p>
              <ul className="mt-1 space-y-0.5 text-gray-700">
                <li>Lucro de <strong>{fmtBRL(a.profit)}</strong> por peça ({fmtPct(a.profitPct)} do preço), depois da peça, impostos, taxas e custos fixos</li>
                <li>Sobra {fmtBRL(a.contribution)} antes dos fixos (margem {fmtPct(a.marginPct)}) · markup {fmtNum1(a.markup)}</li>
                <li>Abaixo de {fmtBRL(a.minPrice)} a venda dá prejuízo</li>
                {a.breakEvenUnits !== null && <li>{a.breakEvenUnits} peças como esta pagam os custos fixos do mês</li>}
                {a.contribution < 0 && <li className="font-medium text-negative-700">Este preço não cobre o custo e as despesas da venda.</li>}
                {a.contribution >= 0 && a.marginPct + 1e-9 < requiredMarginPct(pricing) && <li className="text-warn-700">Abaixo do seu lucro desejado de {fmtPct(pricing.target_margin_pct)} (depois dos custos fixos).</li>}
              </ul>
            </div>
          )}
        </>
      )}
      {!configured && <p className="text-xs text-gray-500">Para a conta ficar completa, informe impostos, taxas e custos fixos em <Link href="/varejo/precificacao" className="text-brand-700 hover:underline">Custos e preço</Link>.</p>}
    </div>
  )
}

// Memória de cálculo: de onde sai o preço de referência e para onde vai o dinheiro da venda
function PriceMemoryBox({ cost, pricing, loyalty, selling }: { cost: number; pricing: PricingSettings; loyalty: LoyaltySettings; selling: number | null }) {
  const m = priceMemory(cost, pricing, loyalty)
  const base = selling ?? m.price
  const pct = (v: number) => fmtPct(v)
  return (
    <details className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm" open>
      <summary className="cursor-pointer font-medium text-gray-900">Memória de cálculo</summary>
      <div className="mt-2 space-y-3 text-gray-700">
        <table className="w-full text-sm">
          <tbody>
            <tr><td className="py-0.5">Custo da peça</td><td className="py-0.5 text-right">{fmtBRL(m.cost)}</td></tr>
            <tr><td className="py-0.5">+ Custo por peça (embalagem, etiqueta)</td><td className="py-0.5 text-right">{fmtBRL(m.perPiece)}</td></tr>
            <tr className="border-t border-gray-200 font-medium"><td className="py-0.5">= Custo direto</td><td className="py-0.5 text-right">{fmtBRL(m.direct)}</td></tr>
          </tbody>
        </table>
        <div>
          <p className="text-xs font-medium uppercase text-gray-500">Sai de cada venda (% do preço)</p>
          <table className="mt-1 w-full text-sm">
            <tbody>
              {m.pcts.map(x => (
                <tr key={x.key}>
                  <td className="py-0.5">{x.label}{x.key === 'fixed' && x.pct > 0 ? <span className="text-xs text-gray-500"> ({fmtBRL(pricing.fixed_monthly)} ÷ {fmtBRL(pricing.expected_revenue)})</span> : null}</td>
                  <td className="py-0.5 text-right">{pct(x.pct)}</td>
                  {base ? <td className="py-0.5 pl-3 text-right text-gray-500">{fmtBRL(base * x.pct / 100)}</td> : null}
                </tr>
              ))}
              <tr className="border-t border-gray-200 font-medium"><td className="py-0.5">Total</td><td className="py-0.5 text-right">{pct(m.totalPct)}</td>{base ? <td className="py-0.5 pl-3 text-right">{fmtBRL(base * m.totalPct / 100)}</td> : null}</tr>
            </tbody>
          </table>
        </div>
        {m.price !== null ? (
          <p className="rounded bg-white px-2 py-1.5">
            Divisor = 1 − {pct(m.totalPct)} = <strong>{fmtNum1(m.divisor * 100)}%</strong> · Preço = {fmtBRL(m.direct)} ÷ {fmtNum1(m.divisor * 100)}% = <strong>{fmtBRL(m.price)}</strong> (arredondado para cima no centavo) · markup {fmtNum1(m.markup ?? 0)}
          </p>
        ) : <p className="text-warn-700">Os percentuais somam 100% ou mais: não existe preço que feche a conta.</p>}
        {selling !== null && m.price !== null && Math.abs(selling - m.price) > 0.009 && (
          <p className="text-xs text-gray-500">Os valores em R$ acima usam o seu preço de venda ({fmtBRL(selling)}), não o de referência.</p>
        )}
        {m.fixedMissingRevenue && <p className="text-xs text-warn-700">Os custos fixos ({fmtBRL(pricing.fixed_monthly)}) ficaram fora: informe o faturamento médio do mês em <Link href="/varejo/precificacao" className="underline">Custos e preço</Link>.</p>}
        {pricing.tax_pct === 0 && pricing.fixed_monthly === 0 && pricing.card_pct === 0 && <p className="text-xs text-warn-700">Impostos, taxas e custos fixos estão em zero. Preencha em <Link href="/varejo/precificacao" className="underline">Custos e preço</Link> para o preço ficar completo.</p>}
        <p className="text-xs text-gray-500">MEI: o imposto é o DAS fixo do mês, que entra nos custos fixos (0% por venda). Simples: alíquota do faturamento de 12 meses.</p>
      </div>
    </details>
  )
}
