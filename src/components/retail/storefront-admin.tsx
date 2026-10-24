'use client'

// Varejo → Vitrine: configuração da landing (endereço, domínio, WhatsApp, textos,
// ocasiões e cores) e os looks (combinações de peças por ocasião).

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { saveRetailStorefront, saveRetailLook, deleteRetailLook, moveRetailLook, createRetailStorefrontUpload, type StorefrontInput } from '@/lib/actions/retail-storefront'
import { createClient } from '@/lib/supabase/client'
import { RETAIL_MEDIA_BUCKET } from '@/lib/retail/products'
import { DEFAULT_FAQ, DEFAULT_POLICIES, type Occasion, type StorefrontContent } from '@/lib/retail/storefront'

export type ProductOption = { id: string; code: string; name: string; category?: string | null; published: boolean; photo: string | null; occasions: string[] }
export type LookRow = { id: string; name: string; occasion: string | null; description: string | null; product_ids: string[]; cover_photo: string | null; active: boolean; position: number }

const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-700 focus:outline-none disabled:bg-gray-50'
const lbl = 'mb-1 block text-sm font-medium text-gray-800'
const hint = 'mt-1 text-xs text-gray-500'
const SUGGESTED = ['Trabalho', 'Igreja', 'Festa', 'Dia a dia', 'Viagem', 'Encontro']

export function StorefrontAdmin({ initial, saved, products, looks, storefrontBase, isAdmin, canEdit }: {
  initial: StorefrontInput; saved: boolean; products: ProductOption[]; looks: LookRow[]
  storefrontBase: string | null; isAdmin: boolean; canEdit: boolean
}) {
  const router = useRouter()
  const [f, setF] = useState<StorefrontInput>(initial)
  const [domainsText, setDomainsText] = useState(initial.domains.join('\n'))
  const [newOcc, setNewOcc] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const ro = !isAdmin
  const set = <K extends keyof StorefrontInput>(k: K, v: StorefrontInput[K]) => setF(p => ({ ...p, [k]: v }))
  const photos = useMemo(() => products.filter(p => p.photo).map(p => ({ url: p.photo!, name: p.name })), [products])
  const categories = useMemo(() => [...new Set(products.map(p => p.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [products])
  const testUrl = storefrontBase && f.slug ? `${storefrontBase}/?loja=${f.slug}` : null

  function addOccasion(name: string) {
    const n = name.replace(/\s+/g, ' ').trim()
    if (!n || f.occasions.some(o => o.name.toLowerCase() === n.toLowerCase())) return
    set('occasions', [...f.occasions, { id: '', name: n }])
    setNewOcc('')
  }

  async function save() {
    setBusy(true); setMsg(null)
    const r = await saveRetailStorefront({ ...f, domains: domainsText.split(/[\n,;\s]+/).filter(Boolean) })
    setBusy(false)
    setMsg(r.ok ? { ok: true, text: 'Vitrine salva.' } : { ok: false, text: r.error })
    if (r.ok) router.refresh()
  }

  return (
    <div className="space-y-4">
      {ro && <p className="rounded-lg bg-warn-100 px-3 py-2 text-sm text-warn-700">Só o administrador muda a configuração da vitrine. Os looks qualquer pessoa da equipe monta.</p>}

      <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">1. Sua vitrine</h2>
            <p className="text-sm text-gray-600">Nome, frase, WhatsApp e onde ela abre.</p>
          </div>
          <label className="flex cursor-pointer items-center gap-2 rounded-full border border-gray-300 px-3 py-1.5 text-sm">
            <input type="checkbox" checked={f.enabled} disabled={ro} onChange={e => set('enabled', e.target.checked)} />
            {f.enabled ? 'No ar' : 'Desligada'}
          </label>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div><label className={lbl}>Nome na vitrine</label><input className={inp} value={f.title} disabled={ro} onChange={e => set('title', e.target.value)} maxLength={80} /></div>
          <div>
            <label className={lbl}>WhatsApp da loja *</label>
            <input className={inp} value={f.whatsapp} disabled={ro} inputMode="tel" placeholder="(31) 99999-0000" onChange={e => set('whatsapp', e.target.value)} />
            <p className={hint}>Depois do pedido, a cliente cai aqui com a mensagem pronta.</p>
          </div>
          <div className="sm:col-span-2"><label className={lbl}>Frase de destaque</label><input className={inp} value={f.tagline} disabled={ro} maxLength={160} placeholder="ex.: Moda feminina para cada momento da sua semana" onChange={e => set('tagline', e.target.value)} /></div>
          <div className="sm:col-span-2"><label className={lbl}>Sobre a loja</label><textarea className={inp} rows={3} value={f.about} disabled={ro} maxLength={1500} onChange={e => set('about', e.target.value)} /></div>
        </div>
        <div className="space-y-3">
          <div>
            <p className={lbl}>Foto de capa</p>
            <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
              <p className="font-medium text-gray-800">Como deve ser a foto</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                <li><strong>Computador:</strong> foto em pé, <strong>1600 × 2000 px</strong> (4 : 5; mínimo 1200 × 1500). Fica à direita do título. Em telas largas corta um pouco em cima e embaixo: deixe a pessoa no centro, com a cabeça no terço de cima e folga nas bordas. Sem texto ou logo na foto.</li>
                <li><strong>Celular:</strong> quase quadrada, <strong>1200 × 1260 px</strong>. Fica no topo, acima do título. Sem ela, o celular usa a do computador cortada.</li>
                <li>O nome da loja, a frase e o botão ficam <strong>embaixo, à esquerda</strong>, sobre uma sombra: deixe essa área mais limpa e a peça ou o rosto no centro ou à direita.</li>
                <li>JPG, PNG ou WEBP. O Drone reduz o arquivo sozinho para a vitrine abrir rápido.</li>
              </ul>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <CoverSlot label="Computador (vertical 4:5)" ratio="aspect-[4/5] max-w-[14rem]" url={f.hero_photo} disabled={ro} maxSide={2400} onChange={u => set('hero_photo', u)} fallback="Sem foto: usa a peça mais nova" />
            <CoverSlot label="Celular (quase quadrada)" ratio="aspect-[20/21] max-w-[14rem]" url={f.hero_photo_mobile} disabled={ro} maxSide={1600} onChange={u => set('hero_photo_mobile', u)} fallback="Sem foto: usa a do computador" />
          </div>
          {photos.length > 0 && !ro && (
            <div>
              <p className={hint}>Ou use a foto de uma peça na capa do computador:</p>
              <div className="mt-1 flex gap-2 overflow-x-auto pb-1">
                {photos.slice(0, 40).map(p => (
                  <button key={p.url} type="button" onClick={() => set('hero_photo', p.url)} title={p.name} className={`h-16 w-12 shrink-0 overflow-hidden rounded-lg border-2 ${f.hero_photo === p.url ? 'border-brand-700' : 'border-transparent'}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt={p.name} className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
              <p className={hint}>Fotos de peça são verticais: no computador, a capa corta em cima e embaixo.</p>
            </div>
          )}
          <p className={hint}>Depois de trocar a foto, toque em <strong>Salvar vitrine</strong>.</p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={lbl}>Cor principal</label>
            <div className="flex items-center gap-2"><input type="color" value={f.theme.primary} disabled={ro} onChange={e => set('theme', { ...f.theme, primary: e.target.value })} className="h-9 w-12 rounded border border-gray-300" /><span className="text-sm text-gray-600">{f.theme.primary}</span></div>
          </div>
          <div>
            <label className={lbl}>Cor de destaque</label>
            <div className="flex items-center gap-2"><input type="color" value={f.theme.accent} disabled={ro} onChange={e => set('theme', { ...f.theme, accent: e.target.value })} className="h-9 w-12 rounded border border-gray-300" /><span className="text-sm text-gray-600">{f.theme.accent}</span></div>
          </div>
        </div>
      </section>

      <ContentEditor content={f.content} onChange={c => set('content', c)} categories={categories} disabled={ro} />

      <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">2. Ocasiões</h2>
          <p className="text-sm text-gray-600">Como a cliente filtra a vitrine. Marque as ocasiões em cada peça (passo 4 do cadastro) e nos looks.</p>
        </div>
        <div className="space-y-2">
          {f.occasions.map((o, i) => (
            <div key={`${o.id}-${i}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 p-2">
              <span className="rounded-full bg-brand-100 px-3 py-1 text-sm font-medium text-brand-800">{o.name}</span>
              <input className={`${inp} min-w-0 flex-1`} value={o.text ?? ''} maxLength={120} disabled={ro} placeholder="Frase curta (ex.: Elegante sem esforço, das 8h às 18h.)"
                onChange={e => set('occasions', f.occasions.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
              {!ro && <button type="button" aria-label={`Tirar ${o.name}`} onClick={() => set('occasions', f.occasions.filter((_, j) => j !== i))} className="px-1 text-sm text-gray-500 hover:text-negative-700">×</button>}
            </div>
          ))}
          {f.occasions.length === 0 && <span className="text-sm text-gray-500">Nenhuma ainda.</span>}
        </div>
        {!ro && (
          <>
            <div className="flex gap-2">
              <input className={inp} value={newOcc} maxLength={30} placeholder="Nova ocasião" onChange={e => setNewOcc(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addOccasion(newOcc) } }} />
              <button type="button" onClick={() => addOccasion(newOcc)} className="shrink-0 rounded-lg border border-gray-300 px-3 text-sm text-gray-700">Incluir</button>
            </div>
            <div className="flex flex-wrap gap-1 text-xs">
              {SUGGESTED.filter(s => !f.occasions.some(o => o.name.toLowerCase() === s.toLowerCase())).map(s => (
                <button key={s} type="button" onClick={() => addOccasion(s)} className="rounded-full border border-gray-300 px-2 py-0.5 text-gray-600">+ {s}</button>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">3. Endereço e domínio</h2>
          <p className="text-sm text-gray-600">O endereço serve para testar antes de ligar o domínio. O domínio é da loja e continua dela.</p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={lbl}>Endereço de teste</label>
            <input className={inp} value={f.slug} disabled={ro} onChange={e => set('slug', e.target.value.toLowerCase())} placeholder="minhaloja" autoCapitalize="none" />
            {testUrl ? <p className={hint}>Teste: <a href={testUrl} target="_blank" rel="noopener noreferrer" className="break-all text-brand-700 underline">{testUrl}</a>{saved ? '' : ' (salve antes)'}</p>
              : <p className={hint}>O link de teste aparece aqui quando a vitrine estiver publicada na Cloudflare.</p>}
          </div>
          <div>
            <label className={lbl}>Domínio da loja</label>
            <textarea className={inp} rows={2} value={domainsText} disabled={ro} onChange={e => setDomainsText(e.target.value)} placeholder="minhaloja.com.br" autoCapitalize="none" />
            <p className={hint}>Um por linha, sem https://. O domínio também precisa ser ligado na Cloudflare (o suporte da plataforma faz).</p>
          </div>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 pt-3">
            <button type="button" onClick={save} disabled={busy} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">{busy ? 'Salvando…' : 'Salvar vitrine'}</button>
            {msg && <p role={msg.ok ? 'status' : 'alert'} className={`text-sm ${msg.ok ? 'text-positive-700' : 'text-negative-700'}`}>{msg.text}</p>}
          </div>
        )}
      </section>

      <LooksManager looks={looks} products={products} occasions={f.occasions} canEdit={canEdit} />

      <section className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-600">
        <h2 className="text-base font-semibold text-gray-900">O que aparece na vitrine</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Só peças <strong>Publicadas</strong> e com estoque. Esgotou, some sozinha.</li>
          <li>Preço e promoção de cada peça. Custo e quantidade exata nunca aparecem (só &quot;últimas unidades&quot;).</li>
          <li>O pedido entra em <Link href="/varejo/funil" className="text-brand-700 underline">Funil da loja</Link> como &quot;Novo pedido&quot;, com a cliente cadastrada pelo WhatsApp. O estoque só baixa quando o pedido fica Pago.</li>
        </ul>
      </section>
    </div>
  )
}

function LooksManager({ looks, products, occasions, canEdit }: { looks: LookRow[]; products: ProductOption[]; occasions: Occasion[]; canEdit: boolean }) {
  const router = useRouter()
  const [editing, setEditing] = useState<LookRow | null>(null)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const byId = useMemo(() => new Map(products.map(p => [p.id, p])), [products])
  const occName = (id: string | null) => occasions.find(o => o.id === id)?.name ?? null
  const blank: LookRow = { id: '', name: '', occasion: occasions[0]?.id ?? null, description: '', product_ids: [], cover_photo: null, active: true, position: 0 }

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, close = false) {
    setBusy(true); setErr(null)
    const r = await fn()
    setBusy(false)
    if (!r.ok) { setErr(r.error ?? 'Não foi possível.'); return }
    if (close) setEditing(null)
    router.refresh()
  }

  const filtered = products.filter(p => !q.trim() || `${p.name} ${p.code}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 60)

  return (
    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-gray-900">4. Looks</h2>
          <p className="text-sm text-gray-600">Combinações prontas por ocasião. A cliente vê o look e leva as peças juntas para a sacola.</p>
        </div>
        {canEdit && !editing && <button type="button" onClick={() => { setEditing(blank); setQ('') }} className="rounded-lg bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800">Novo look</button>}
      </div>

      {editing && (
        <div className="space-y-3 rounded-lg border border-brand-700/40 bg-brand-100/30 p-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><label className={lbl}>Nome do look</label><input className={inp} value={editing.name} maxLength={80} placeholder="ex.: Reunião de segunda" onChange={e => setEditing({ ...editing, name: e.target.value })} /></div>
            <div>
              <label className={lbl}>Ocasião</label>
              <select className={inp} value={editing.occasion ?? ''} onChange={e => setEditing({ ...editing, occasion: e.target.value || null })}>
                <option value="">Sem ocasião</option>
                {occasions.filter(o => o.id).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2"><label className={lbl}>Descrição (opcional)</label><input className={inp} value={editing.description ?? ''} maxLength={600} onChange={e => setEditing({ ...editing, description: e.target.value })} /></div>
          </div>
          <div>
            <label className={lbl}>Peças do look ({editing.product_ids.length})</label>
            <div className="mb-2 flex flex-wrap gap-2">
              {editing.product_ids.map(id => (
                <span key={id} className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-xs text-gray-800 ring-1 ring-gray-200">
                  {byId.get(id)?.name ?? 'Peça removida'}
                  <button type="button" aria-label="Tirar" onClick={() => setEditing({ ...editing, product_ids: editing.product_ids.filter(x => x !== id) })} className="hover:text-negative-700">×</button>
                </span>
              ))}
            </div>
            <input className={inp} value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar peça por nome ou código" />
            <ul className="mt-2 max-h-60 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200 bg-white">
              {filtered.map(p => {
                const on = editing.product_ids.includes(p.id)
                return (
                  <li key={p.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                      <input type="checkbox" checked={on} onChange={e => setEditing({ ...editing, product_ids: e.target.checked ? [...editing.product_ids, p.id].slice(0, 12) : editing.product_ids.filter(x => x !== p.id) })} />
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {p.photo ? <img src={p.photo} alt="" className="h-10 w-8 rounded object-cover" /> : <span className="h-10 w-8 rounded bg-gray-100" />}
                      <span className="min-w-0 flex-1 truncate">{p.name} <span className="text-xs text-gray-500">{p.code}</span></span>
                      {!p.published && <span className="text-[11px] text-warn-700">não publicada</span>}
                    </label>
                  </li>
                )
              })}
              {filtered.length === 0 && <li className="px-3 py-2 text-sm text-gray-500">Nenhuma peça encontrada.</li>}
            </ul>
            <p className={hint}>Até 12 peças. Peça não publicada ou esgotada não aparece no look da vitrine.</p>
          </div>
          {err && <p role="alert" className="text-sm text-negative-700">{err}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => run(() => saveRetailLook({ id: editing.id || null, name: editing.name, occasion: editing.occasion, description: editing.description ?? '', product_ids: editing.product_ids, cover_photo: editing.cover_photo, active: editing.active }), true)}
              className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Salvando…' : 'Salvar look'}</button>
            <button type="button" disabled={busy} onClick={() => { setEditing(null); setErr(null) }} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700">Cancelar</button>
          </div>
        </div>
      )}

      {looks.length === 0 && !editing && <p className="text-sm text-gray-500">Nenhum look ainda. Monte o primeiro com 2 ou 3 peças que combinam.</p>}
      <ul className="space-y-2">
        {looks.map((l, i) => {
          const first = l.product_ids.map(id => byId.get(id)).find(p => p?.photo)
          return (
            <li key={l.id} className="flex items-center gap-3 rounded-lg border border-gray-200 p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {first?.photo ? <img src={first.photo} alt="" className="h-14 w-11 rounded object-cover" /> : <span className="h-14 w-11 rounded bg-gray-100" />}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-900">{l.name}</p>
                <p className="text-xs text-gray-500">{occName(l.occasion) ?? 'Sem ocasião'} · {l.product_ids.length} peça{l.product_ids.length === 1 ? '' : 's'}</p>
              </div>
              {canEdit && (
                <div className="flex shrink-0 items-center gap-1 text-xs">
                  <button type="button" aria-label="Subir" disabled={busy || i === 0} onClick={() => run(() => moveRetailLook(l.id, -1))} className="px-1.5 py-1 text-gray-600 disabled:opacity-30">↑</button>
                  <button type="button" aria-label="Descer" disabled={busy || i === looks.length - 1} onClick={() => run(() => moveRetailLook(l.id, 1))} className="px-1.5 py-1 text-gray-600 disabled:opacity-30">↓</button>
                  <button type="button" onClick={() => { setEditing(l); setQ('') }} className="px-1.5 py-1 text-brand-700 underline">Editar</button>
                  <button type="button" disabled={busy} onClick={() => { if (confirm(`Excluir o look "${l.name}"?`)) run(() => deleteRetailLook(l.id)) }} className="px-1.5 py-1 text-negative-700 underline">Excluir</button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// Reduz a foto no aparelho (lado maior até maxSide, JPEG 85%) antes de enviar
async function shrink(file: File, maxSide: number): Promise<File> {
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale)
    canvas.getContext('2d')?.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    const blob: Blob | null = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.85))
    return blob ? new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }) : file
  } catch { return file }
}

function CoverSlot({ label, ratio, url, disabled, maxSide, onChange, fallback }: { label: string; ratio: string; url: string | null; disabled: boolean; maxSide: number; onChange: (u: string | null) => void; fallback: string }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [dims, setDims] = useState<string | null>(null)
  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const original = e.target.files?.[0]
    e.target.value = ''
    if (!original) return
    setBusy(true); setErr(null)
    try {
      const bmp = await createImageBitmap(original).catch(() => null)
      if (bmp) setDims(`${bmp.width} × ${bmp.height} px`)
      const file = await shrink(original, maxSide)
      const prep = await createRetailStorefrontUpload(file.name, file.type || 'image/jpeg')
      if (!prep.ok) { setErr(prep.error); return }
      const up = await createClient().storage.from(RETAIL_MEDIA_BUCKET).uploadToSignedUrl(prep.path, prep.token, file, { contentType: file.type || 'image/jpeg' })
      if (up.error) { setErr(`Falha ao enviar: ${up.error.message}`); return }
      onChange(prep.url)
    } finally { setBusy(false) }
  }
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-gray-700">{label}</p>
      <div className={`relative w-full overflow-hidden rounded-lg border border-gray-200 bg-gray-50 ${ratio}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : <span className="absolute inset-0 flex items-center justify-center p-2 text-center text-xs text-gray-400">{fallback}</span>}
      </div>
      {!disabled && (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <label className={`cursor-pointer rounded-lg border border-brand-700 px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-100 ${busy ? 'pointer-events-none opacity-50' : ''}`}>
            {busy ? 'Enviando…' : url ? 'Trocar foto' : 'Enviar foto'}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={pick} />
          </label>
          {url && <button type="button" onClick={() => onChange(null)} className="text-xs text-gray-500 underline">Tirar</button>}
        </div>
      )}
      {dims && <p className="mt-1 text-[11px] text-gray-500">Foto enviada: {dims}</p>}
      {err && <p role="alert" className="mt-1 text-xs text-negative-700">{err}</p>}
    </div>
  )
}

// Textos da vitrine: abertura, destaque, sobre, contato e perguntas frequentes
function ContentEditor({ content, onChange, categories, disabled }: { content: StorefrontContent; onChange: (c: StorefrontContent) => void; categories: string[]; disabled: boolean }) {
  const set = <K extends keyof StorefrontContent>(k: K, v: StorefrontContent[K]) => onChange({ ...content, [k]: v })
  const txt = (k: keyof StorefrontContent) => (content[k] as string | null) ?? ''
  return (
    <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Textos da vitrine</h2>
        <p className="text-sm text-gray-600">O que a cliente lê em cada parte. Campo vazio usa um texto padrão ou esconde o bloco.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><label className={lbl}>Título da abertura</label><input className={inp} value={txt('hero_title')} disabled={disabled} maxLength={80} placeholder="ex.: Elegância para a vida real" onChange={e => set('hero_title', e.target.value)} /><p className={hint}>Vazio: usa a frase de destaque.</p></div>
        <div className="sm:col-span-2"><label className={lbl}>Texto da abertura</label><textarea className={inp} rows={2} value={txt('hero_text')} disabled={disabled} maxLength={300} placeholder="ex.: Moda feminina versátil e atemporal, para o trabalho, a igreja e o dia a dia." onChange={e => set('hero_text', e.target.value)} /></div>
        <div className="sm:col-span-2"><label className={lbl}>Frase do “Sobre”</label><input className={inp} value={txt('about_quote')} disabled={disabled} maxLength={200} placeholder="ex.: uma frase que representa a loja" onChange={e => set('about_quote', e.target.value)} /></div>
        <div><label className={lbl}>Destaque: título</label><input className={inp} value={txt('feature_title')} disabled={disabled} maxLength={80} placeholder="ex.: Tons da estação" onChange={e => set('feature_title', e.target.value)} /><p className={hint}>Vazio: o bloco de destaque não aparece.</p></div>
        <div>
          <label className={lbl}>Destaque: leva para a categoria</label>
          <select className={inp} value={txt('feature_category')} disabled={disabled} onChange={e => set('feature_category', e.target.value || null)}>
            <option value="">Todas as peças</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2"><label className={lbl}>Destaque: texto</label><textarea className={inp} rows={2} value={txt('feature_text')} disabled={disabled} maxLength={400} onChange={e => set('feature_text', e.target.value)} /></div>
        <div><label className={lbl}>Instagram (link)</label><input className={inp} value={txt('instagram')} disabled={disabled} placeholder="https://www.instagram.com/sualoja/" autoCapitalize="none" onChange={e => set('instagram', e.target.value)} /></div>
        <div><label className={lbl}>Cidade e alcance</label><input className={inp} value={txt('city')} disabled={disabled} maxLength={120} placeholder="ex.: Goiânia, GO · vendas para todo o Brasil" onChange={e => set('city', e.target.value)} /></div>
        <div><label className={lbl}>Retirada e entrega local em</label><input className={inp} value={txt('local_delivery')} disabled={disabled} maxLength={60} placeholder="ex.: Goiânia" onChange={e => set('local_delivery', e.target.value)} /><p className={hint}>Vazio: a cliente só escolhe envio pelo CEP.</p></div>
        <div><label className={lbl}>Texto do contato</label><input className={inp} value={txt('contact_text')} disabled={disabled} maxLength={200} placeholder="ex.: Ajudamos a escolher tamanho, cor e composição." onChange={e => set('contact_text', e.target.value)} /></div>
      </div>
      <div>
        <p className={lbl}>Perguntas frequentes</p>
        <div className="space-y-2">
          {content.faq.map((f, i) => (
            <div key={i} className="space-y-1 rounded-lg border border-gray-200 p-2">
              <input className={inp} value={f.q} disabled={disabled} maxLength={160} placeholder="Pergunta" onChange={e => set('faq', content.faq.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)))} />
              <textarea className={inp} rows={2} value={f.a} disabled={disabled} maxLength={600} placeholder="Resposta" onChange={e => set('faq', content.faq.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)))} />
              {!disabled && <button type="button" onClick={() => set('faq', content.faq.filter((_, j) => j !== i))} className="text-xs text-gray-500 underline">Tirar</button>}
            </div>
          ))}
        </div>
        {!disabled && (
          <div className="mt-2 flex flex-wrap gap-3 text-sm">
            {content.faq.length < 10 && <button type="button" onClick={() => set('faq', [...content.faq, { q: '', a: '' }])} className="text-brand-700 hover:underline">+ Pergunta</button>}
            <button type="button" onClick={() => set('faq', DEFAULT_FAQ)} className="text-gray-500 underline">Voltar às perguntas padrão</button>
          </div>
        )}
      </div>
      <div>
        <p className={lbl}>Políticas (rodapé da vitrine)</p>
        <p className={hint}>Ex.: trocas e devoluções, entregas. Sem texto, a vitrine mostra “Em breve” e indica o WhatsApp.</p>
        <div className="mt-2 space-y-2">
          {content.policies.map((pol, i) => (
            <div key={i} className="space-y-1 rounded-lg border border-gray-200 p-2">
              <input className={inp} value={pol.title} disabled={disabled} maxLength={60} placeholder="Título (ex.: Trocas e devoluções)" onChange={e => set('policies', content.policies.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
              <textarea className={inp} rows={4} value={pol.text} disabled={disabled} maxLength={4000} placeholder="Texto da política (prazo, condições, como pedir)" onChange={e => set('policies', content.policies.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
              {!disabled && <button type="button" onClick={() => set('policies', content.policies.filter((_, j) => j !== i))} className="text-xs text-gray-500 underline">Tirar</button>}
            </div>
          ))}
        </div>
        {!disabled && (
          <div className="mt-2 flex flex-wrap gap-3 text-sm">
            {content.policies.length < 6 && <button type="button" onClick={() => set('policies', [...content.policies, { title: '', text: '' }])} className="text-brand-700 hover:underline">+ Política</button>}
            {content.policies.length === 0 && <button type="button" onClick={() => set('policies', DEFAULT_POLICIES)} className="text-gray-500 underline">Voltar às políticas padrão</button>}
          </div>
        )}
      </div>
      <p className={hint}>Depois de mudar, toque em <strong>Salvar vitrine</strong>.</p>
    </section>
  )
}
