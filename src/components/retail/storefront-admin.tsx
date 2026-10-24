'use client'

// Varejo → Vitrine: configuração da landing (endereço, domínio, WhatsApp, textos,
// ocasiões e cores) e os looks (combinações de peças por ocasião).

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { saveRetailStorefront, saveRetailLook, deleteRetailLook, moveRetailLook, type StorefrontInput } from '@/lib/actions/retail-storefront'
import type { Occasion } from '@/lib/retail/storefront'

export type ProductOption = { id: string; code: string; name: string; published: boolean; photo: string | null; occasions: string[] }
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
        <div>
          <label className={lbl}>Foto de capa</label>
          {photos.length === 0 ? <p className={hint}>Cadastre peças com fotos para escolher a capa. Sem escolha, usa a foto da peça mais nova.</p> : (
            <div className="flex gap-2 overflow-x-auto pb-1">
              <button type="button" disabled={ro} onClick={() => set('hero_photo', null)} className={`flex h-20 w-16 shrink-0 items-center justify-center rounded-lg border text-center text-[11px] ${!f.hero_photo ? 'border-brand-700 text-brand-800' : 'border-gray-300 text-gray-500'}`}>Peça mais nova</button>
              {photos.slice(0, 40).map(p => (
                <button key={p.url} type="button" disabled={ro} onClick={() => set('hero_photo', p.url)} title={p.name} className={`h-20 w-16 shrink-0 overflow-hidden rounded-lg border-2 ${f.hero_photo === p.url ? 'border-brand-700' : 'border-transparent'}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={p.name} className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
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

      <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">2. Ocasiões</h2>
          <p className="text-sm text-gray-600">Como a cliente filtra a vitrine. Marque as ocasiões em cada peça (passo 4 do cadastro) e nos looks.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {f.occasions.map((o, i) => (
            <span key={`${o.id}-${i}`} className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-3 py-1 text-sm text-brand-800">
              {o.name}
              {!ro && <button type="button" aria-label={`Tirar ${o.name}`} onClick={() => set('occasions', f.occasions.filter((_, j) => j !== i))} className="hover:text-negative-700">×</button>}
            </span>
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
