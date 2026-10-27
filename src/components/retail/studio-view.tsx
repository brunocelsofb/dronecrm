'use client'

// Estúdio IA: conta de IA da administradora, modelos virtuais, cenários, foto do look
// (modelo + peças + cenário) e o banco de imagens para publicar na vitrine.

import { createContext, useContext, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createLookFromAiImage, deleteAiImage, publishAiImage, publishAiImageToProduct, removeAiConnection, saveAiConnection, setAiModel } from '@/lib/actions/retail-ai-studio'
import { colorCoverage, missingModelColors, type PhotoMeta } from '@/lib/retail/photo-colors'
import { setRetailPhotoMeta } from '@/lib/actions/retail-products'
import { AI_PROVIDERS, IMAGE_FORMAT, type LookCopy, MAX_LOOK_PIECES, POSES, SCENE_PLACES, lookPrompt, modelPrompt, scenePrompt, type AiProvider, type ModelSpec } from '@/lib/retail/ai-studio'

type Target = { product_id: string; color: string | null }
export type StudioImage = { id: string; kind: 'modelo' | 'cenario' | 'look'; title: string | null; url: string; provider: string; created_at: string; copy?: LookCopy | null; pieces?: string[]; target?: Target | null }
// photos = endereço para mostrar; paths = como está gravado (chave do meta); meta = cor e "com modelo" de cada foto
export type StudioProduct = { id: string; code: string; name: string; status: string; colors: string[]; meta: PhotoMeta; paths: string[]; photos: string[] }
const ProductsCtx = createContext<StudioProduct[]>([])

// Baixar a imagem no tamanho original (se o navegador bloquear, abre em outra aba)
async function downloadImage(url: string, name: string) {
  try {
    const r = await fetch(url)
    if (!r.ok) throw new Error()
    const blob = await r.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${name.replace(/[^\p{L}\p{N} _-]+/gu, '').trim().replace(/\s+/g, '-') || 'imagem'}.${blob.type.includes('png') ? 'png' : blob.type.includes('webp') ? 'webp' : 'jpg'}`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  } catch { window.open(url, '_blank', 'noopener') }
}
type Conn = { provider: AiProvider; last4: string | null; model: string | null }
type Opt = { id: string; name: string }

const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-700 focus:outline-none'
const lbl = 'mb-1 block text-xs font-medium text-gray-600'
const btn = 'rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50'
const btnLine = 'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50'
type Tab = 'look' | 'modelo' | 'cenario' | 'banco'

export function StudioView({ connections, images, products, looks, occasions }: { connections: Conn[]; images: StudioImage[]; products: StudioProduct[]; looks: Opt[]; occasions: Opt[] }) {
  const [tab, setTab] = useState<Tab>('look')
  const connected = connections.map(c => c.provider)
  return (
    <ProductsCtx.Provider value={products}>
    <div className="space-y-4">
      <AccountSection connections={connections} />
      <p className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">Na vitrine, toda foto criada aqui leva um selo discreto <strong>&quot;Imagem criada por IA&quot;</strong>. A IA pode mudar um pouco o tom ou o caimento da roupa: as fotos reais continuam na página de cada peça.</p>
      <div className="flex flex-wrap gap-2" role="tablist">
        {([['look', 'Foto do look'], ['modelo', `Modelos (${images.filter(i => i.kind === 'modelo').length})`], ['cenario', `Cenários (${images.filter(i => i.kind === 'cenario').length})`], ['banco', `Banco de imagens (${images.length})`]] as [Tab, string][]).map(([t, l]) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`rounded-full px-4 py-1.5 text-sm ${tab === t ? 'bg-brand-700 text-white' : 'border border-gray-300 bg-white text-gray-700'}`}>{l}</button>
        ))}
      </div>
      {tab === 'look' && <LookTab images={images} products={products} connected={connected} goTo={setTab} looks={looks} occasions={occasions} />}
      {tab === 'modelo' && <ModelTab images={images.filter(i => i.kind === 'modelo')} connected={connected} />}
      {tab === 'cenario' && <SceneTab images={images.filter(i => i.kind === 'cenario')} connected={connected} />}
      {tab === 'banco' && <BankTab images={images} looks={looks} occasions={occasions} />}
    </div>
    </ProductsCtx.Provider>
  )
}

// ── Conta de IA (da própria administradora) ───────────────────────────────────
function AccountSection({ connections }: { connections: Conn[] }) {
  const router = useRouter()
  const [editing, setEditing] = useState<AiProvider | null>(null)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  async function save(p: AiProvider) {
    setBusy(true); setMsg(null)
    const r = await saveAiConnection(p, key, AI_PROVIDERS.find(x => x.id === p)!.models[0].id)
    setBusy(false)
    if (!r.ok) { setMsg({ ok: false, text: r.error }); return }
    setKey(''); setEditing(null); setMsg({ ok: true, text: 'Conta conectada.' }); router.refresh()
  }
  async function remove(p: AiProvider) {
    if (!confirm('Desconectar esta conta de IA? A chave é apagada do Drone.')) return
    await removeAiConnection(p); router.refresh()
  }
  return (
    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Sua conta de IA</h2>
        <p className="text-xs text-gray-500">A chave é sua: fica guardada criptografada e só você usa. Ninguém mais da loja vê, nem o suporte. Cada imagem gerada é cobrada na sua conta do Google ou da OpenAI.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {AI_PROVIDERS.map(p => {
          const c = connections.find(x => x.provider === p.id)
          return (
            <div key={p.id} className="space-y-2 rounded-lg border border-gray-200 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-gray-900">{p.label}</p>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${c ? 'bg-positive-100 text-positive-700' : 'bg-gray-100 text-gray-600'}`}>{c ? `Conectada ••••${c.last4 ?? ''}` : 'Não conectada'}</span>
              </div>
              {c && editing !== p.id ? (
                <>
                  <label className={lbl} htmlFor={`m-${p.id}`}>Modelo de imagem</label>
                  <select id={`m-${p.id}`} className={inp} defaultValue={c.model ?? p.models[0].id} onChange={async e => { await setAiModel(p.id, e.target.value); router.refresh() }}>
                    {p.models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                  <div className="flex gap-2"><button type="button" className={btnLine} onClick={() => { setEditing(p.id); setKey('') }}>Trocar chave</button><button type="button" className="px-2 text-sm text-negative-700" onClick={() => remove(p.id)}>Desconectar</button></div>
                </>
              ) : editing === p.id || !c ? (
                <>
                  <p className="text-xs text-gray-600">{p.keyHelp} <a href={p.keyUrl} target="_blank" rel="noopener noreferrer" className="text-brand-700 underline">Criar a chave</a></p>
                  <input className={inp} type="password" autoComplete="off" value={editing === p.id ? key : ''} onFocus={() => setEditing(p.id)} onChange={e => { setEditing(p.id); setKey(e.target.value) }} placeholder="Cole a chave (API key) aqui" aria-label={`Chave ${p.label}`} />
                  {editing === p.id && <div className="flex gap-2"><button type="button" className={btn} disabled={busy || key.trim().length < 20} onClick={() => save(p.id)}>{busy ? 'Conferindo…' : 'Conectar'}</button>{c && <button type="button" className={btnLine} onClick={() => setEditing(null)}>Cancelar</button>}</div>}
                </>
              ) : null}
            </div>
          )
        })}
      </div>
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? 'bg-positive-100 text-positive-700' : 'bg-negative-100 text-negative-700'}`}>{msg.text}</p>}
    </section>
  )
}

// ── Gerar (chamada comum) ─────────────────────────────────────────────────────
type Made = { id: string; url: string; kind: StudioImage['kind']; copy?: LookCopy | null; pieces?: string[]; target?: Target | null }
function useGenerate() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [last, setLast] = useState<Made[]>([])
  const [writing, setWriting] = useState(false)
  const one = (body: Record<string, unknown>) => fetch('/api/varejo/ia/gerar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(async (r): Promise<Made | { error: string }> => { const j = await r.json().catch(() => ({})); return r.ok ? { id: j.id as string, url: j.url as string, kind: j.kind as Made['kind'], pieces: Array.isArray(body.pieces) ? [...new Set((body.pieces as { product_id: string }[]).map(x => x.product_id))] : [], target: (body.target as Target | null | undefined) ?? null } : { error: (j.error as string) ?? (r.status === 504 ? 'A IA demorou demais e o tempo acabou. Tente de novo ou use o modelo rápido.' : `Erro ${r.status}.`) } })
    .catch((): { error: string } => ({ error: 'Sem conexão. Tente de novo.' }))
  // Texto sugerido (site, rede social, ocasião) pela foto
  async function writeCopies(ok: Made[], only?: string[]) {
    const looksMade = ok.filter(m => m.kind === 'look' && (!only || only.includes(m.id)))
    if (!looksMade.length) return
    setWriting(true)
    const copies = await Promise.all(looksMade.map(m => fetch('/api/varejo/ia/texto', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image_id: m.id }) })
      .then(async x => (x.ok ? ((await x.json()).copy as LookCopy) : null)).catch(() => null)))
    setWriting(false)
    setLast(ok.map(m => { const i = looksMade.indexOf(m); return i >= 0 ? { ...m, copy: copies[i] ?? m.copy ?? null } : m }))
  }
  // Um pedido por foto (com 2 fotos, cada pedido leva uma pose diferente)
  async function run(bodies: Record<string, unknown>[]) {
    setBusy(true); setErr(null)
    const results = await Promise.all(bodies.map(one))
    setBusy(false)
    const ok = results.filter((x): x is Made => 'url' in x)
    const bad = results.find((x): x is { error: string } => 'error' in x)
    if (bad) setErr(bad.error)
    if (ok.length) setLast(ok)
    await writeCopies(ok)
    if (ok.length) router.refresh()
  }
  // Todas as cores: 1ª foto (se não houver base) e depois cada cor trocando só a peça na foto base
  async function chain(first: Record<string, unknown> | null, baseId: string | null, rest: (base: string) => Record<string, unknown>[]) {
    setBusy(true); setErr(null); setLast([])
    const made: Made[] = []
    let base = baseId
    if (first) {
      const r = await one(first)
      if ('error' in r) { setBusy(false); setErr(r.error); return }
      made.push(r); base = r.id; setLast([...made])
    }
    if (!base) { setBusy(false); setErr('Falta a foto de base.'); return }
    const results = await Promise.all(rest(base).map(one))
    setBusy(false)
    const ok = [...made, ...results.filter((x): x is Made => 'url' in x)]
    const bad = results.find((x): x is { error: string } => 'error' in x)
    if (bad) setErr(`${ok.length} foto(s) prontas; uma falhou: ${bad.error}`)
    setLast(ok)
    await writeCopies(ok, ok.slice(0, 1).map(m => m.id)) // texto só da 1ª (serve para a peça)
    if (ok.length) router.refresh()
  }
  return { busy, err, last, run, chain, writing }
}

function ProviderPick({ connected, value, onChange }: { connected: AiProvider[]; value: AiProvider | ''; onChange: (p: AiProvider) => void }) {
  if (!connected.length) return <p className="rounded-lg bg-warn-100 px-3 py-2 text-sm text-warn-700">Conecte a sua conta do Gemini ou do ChatGPT no topo da página para gerar.</p>
  return (
    <div><label className={lbl} htmlFor="prov">Gerar com</label>
      <select id="prov" className={inp} value={value} onChange={e => onChange(e.target.value as AiProvider)}>
        {connected.map(p => <option key={p} value={p}>{AI_PROVIDERS.find(x => x.id === p)!.label}</option>)}
      </select></div>
  )
}

function Results({ made, looks, occasions }: { made: Made[]; looks?: Opt[]; occasions?: Opt[] }) {
  if (!made.length) return null
  const allColors = made.length > 1 && made.every(m => m.target?.color && m.target.product_id === made[0].target?.product_id)
  return (
    <div className="space-y-2 rounded-lg bg-positive-100/50 p-3">
      {allColors && <PublishAll made={made} />}
      <p className="text-sm font-medium text-positive-700">Pronto! {made.length > 1 ? 'As fotos ficaram guardadas' : 'A foto ficou guardada'} no Banco de imagens{made[0].kind === 'look' ? '. Para colocar no site, use os botões abaixo da foto.' : '.'}</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {made.map(m => (
          <div key={m.id} className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <a href={m.url} target="_blank" rel="noopener noreferrer"><img src={m.url} alt="Imagem gerada" className="aspect-[4/5] w-full object-cover" /></a>
            {m.kind === 'look' && looks && occasions && <ImageActions key={`${m.id}-${m.copy ? 1 : 0}`} id={m.id} kind="look" url={m.url} looks={looks} occasions={occasions} copy={m.copy} pieces={m.pieces} target={m.target} />}
          </div>
        ))}
      </div>
    </div>
  )
}

// Publicar todas as cores de uma vez: cada foto vai para a sua cor; o texto da 1ª vira a descrição
function PublishAll({ made }: { made: Made[] }) {
  const router = useRouter()
  const all = useContext(ProductsCtx)
  const prod = all.find(p => p.id === made[0].target?.product_id)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  async function go() {
    setBusy(true); setMsg(null)
    const notes: string[] = []
    let onSite = false
    for (const [i, m] of made.entries()) {
      const r = await publishAiImageToProduct(m.id, { productId: m.target!.product_id, color: m.target!.color, description: i === 0 ? m.copy?.site ?? null : null, showOnSite: true })
      if (!r.ok) { setBusy(false); setMsg({ ok: false, text: `${m.target!.color}: ${r.error}` }); return }
      onSite = r.onSite; if (r.note) notes.push(r.note)
    }
    setBusy(false)
    setMsg(onSite ? { ok: true, text: `${made.length} fotos publicadas, cada uma na sua cor. A vitrine atualiza em até 1 minuto.` } : { ok: false, text: `Fotos colocadas na peça, mas ela ainda NÃO aparece no site. ${notes[notes.length - 1] ?? ''}` })
    router.refresh()
  }
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-brand-700/30 bg-white p-3">
      <div className="min-w-0 flex-1 text-sm text-gray-800"><strong>{prod?.name ?? 'Peça'}</strong>: {made.map(m => m.target?.color).join(', ')}. Confira as fotos e publique todas de uma vez.{made[0].copy?.site ? ' O texto da 1ª foto vira a descrição da peça.' : ''}</div>
      <button type="button" disabled={busy || !!msg?.ok} onClick={go} className={btn}>{busy ? 'Publicando…' : `Publicar todas (${made.length})`}</button>
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`w-full text-sm ${msg.ok ? 'text-positive-700' : 'text-negative-700'}`}>{msg.text}</p>}
    </div>
  )
}

function Waiting({ busy }: { busy: boolean }) {
  return busy ? <p className="flex items-center gap-2 text-sm text-gray-600" role="status"><span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-brand-700" />Gerando… pode levar até 1 minuto. Não feche a página.</p> : null
}

function Pickable({ url, selected, label, onClick, badge }: { url: string; selected: boolean; label: string; onClick: () => void; badge?: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={selected} className={`relative overflow-hidden rounded-lg border-2 text-left ${selected ? 'border-brand-700 ring-2 ring-brand-700/30' : 'border-transparent hover:border-gray-300'}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={label} loading="lazy" className="aspect-[3/4] w-full bg-gray-100 object-cover" />
      <span className="block truncate px-1 py-0.5 text-[11px] text-gray-700">{label}</span>
      {selected && <span className="absolute right-1 top-1 rounded-full bg-brand-700 px-1.5 text-xs font-bold text-white">{badge ?? '✓'}</span>}
    </button>
  )
}

// ── Foto do look ──────────────────────────────────────────────────────────────
function LookTab({ images, products, connected, goTo, looks, occasions }: { images: StudioImage[]; products: StudioProduct[]; connected: AiProvider[]; goTo: (t: Tab) => void; looks: Opt[]; occasions: Opt[] }) {
  const models = images.filter(i => i.kind === 'modelo'), scenes = images.filter(i => i.kind === 'cenario')
  const [model, setModel] = useState<string | null>(models[0]?.id ?? null)
  const [scene, setScene] = useState<string | null>(null)
  const [picked, setPicked] = useState<{ product_id: string; photo: number }[]>([])
  const [q, setQ] = useState('')
  const [title, setTitle] = useState('')
  const [provider, setProvider] = useState<AiProvider | ''>(connected[0] ?? '')
  const [custom, setCustom] = useState<string | null>(null)
  const [times, setTimes] = useState(1)
  const [pose, setPose] = useState<string>('auto')
  const [target, setTarget] = useState<Target | null>(null)
  // Completar o look: com 1 peça, a IA completa por padrão; com 2 ou mais, só as peças escolhidas
  const [completeChoice, setCompleteChoice] = useState<boolean | null>(null)
  const complete = completeChoice ?? picked.length === 1
  const g = useGenerate()
  // Vem do aviso: já escolhe a foto real da peça naquela cor e deixa pronto para gerar
  function startColor(p: StudioProduct, color: string, ref: number) {
    setPicked([{ product_id: p.id, photo: ref }]); setTarget({ product_id: p.id, color })
    setTitle(`${p.name} · ${color}`); setCustom(null); setQ('')
    document.getElementById('estudio-look')?.scrollIntoView({ behavior: 'smooth' })
  }
  // Todas as cores de uma peça: 1ª foto com a modelo (ou a que já existe) e as outras cores trocando só a peça
  type Batch = { product: StudioProduct; colors: { color: string; ref: number }[]; baseId: string | null; baseColor: string | null }
  const [batch, setBatch] = useState<Batch | null>(null)
  function startAll(p: StudioProduct) {
    const miss = missingModelColors(p.paths, p.meta, p.colors).filter(c => c.reference !== null).map(c => ({ color: c.color, ref: c.reference as number }))
    const bi = p.paths.findIndex(path => p.meta[path]?.model && /(^|\/)ia\//.test(path))
    const baseImg = bi >= 0 ? images.find(im => im.kind === 'look' && im.url === p.photos[bi]) : undefined
    setBatch({ product: p, colors: miss, baseId: baseImg?.id ?? null, baseColor: baseImg ? p.meta[p.paths[bi]]?.color ?? null : null })
    setTarget(null); setCustom(null); setQ('')
    if (!baseImg && miss[0]) setPicked([{ product_id: p.id, photo: miss[0].ref }])
    document.getElementById('estudio-look')?.scrollIntoView({ behavior: 'smooth' })
  }
  function generateAll(b: Batch) {
    const prov = provider || connected[0]
    const first = b.baseId ? null : {
      kind: 'look', provider: prov, prompt, title: `${b.product.name} · ${b.colors[0].color}`, model_image_id: model, scene_image_id: scene,
      pieces: [{ product_id: b.product.id, photo: b.colors[0].ref }], pose: pose === 'auto' ? POSES[0] : pose, target: { product_id: b.product.id, color: b.colors[0].color }, complete,
    }
    const rest = (b.baseId ? b.colors : b.colors.slice(1))
    void g.chain(first, b.baseId, base => rest.map(c => ({
      kind: 'look', provider: prov, prompt: 'troca de cor', title: `${b.product.name} · ${c.color}`, base_image_id: base,
      pieces: [{ product_id: b.product.id, photo: c.ref }], target: { product_id: b.product.id, color: c.color },
    })))
  }
  // A cor só vale se a peça continuar escolhida
  const liveTarget = target && picked.some(x => x.product_id === target.product_id) ? target : null
  const auto = lookPrompt(Math.max(1, picked.length), !!scene)
  const prompt = custom ?? auto
  const term = q.trim().toLowerCase()
  // Só fotos da peça sem modelo (servem de base para a IA vestir); mostra a cor da foto
  const tiles = useMemo(() => products.filter(p => !term || p.name.toLowerCase().includes(term) || p.code.toLowerCase().includes(term))
    .flatMap(p => p.photos.map((url, i) => ({ p, url, i, info: p.meta[p.paths[i]] })).filter(t => !t.info?.model)).slice(0, 120), [products, term])
  const isPicked = (pid: string, i: number) => picked.findIndex(x => x.product_id === pid && x.photo === i)
  const toggle = (pid: string, i: number) => { setBatch(null); setPicked(prev => {
    const k = prev.findIndex(x => x.product_id === pid && x.photo === i)
    if (k >= 0) return prev.filter((_, j) => j !== k)
    return prev.length >= MAX_LOOK_PIECES ? prev : [...prev, { product_id: pid, photo: i }]
  }) }
  return (
    <section className="space-y-5 rounded-xl border border-gray-200 bg-white p-4">
      <MissingColors products={products} onStart={startColor} onAll={startAll} />
      <div id="estudio-look" className="scroll-mt-4">
        {batch && (
          <div className="mb-2 space-y-1 rounded-lg bg-brand-100/60 px-3 py-2 text-sm text-brand-800">
            <p><strong>Todas as cores de {batch.product.name}:</strong> {batch.colors.map(c => c.color).join(', ')} ({batch.colors.length} foto{batch.colors.length > 1 ? 's' : ''}, cobradas na sua conta de IA).</p>
            <p className="text-xs">{batch.baseId
              ? `Usa a foto com modelo que já existe${batch.baseColor ? ` (${batch.baseColor})` : ''} como base: a IA troca só a peça, com a mesma modelo, pose e cenário.`
              : `Escolha a modelo e o cenário. A IA faz a 1ª cor (${batch.colors[0]?.color}) e, nas outras, troca só a peça na mesma foto (mesma modelo, pose e cenário).`}</p>
            <button type="button" className="text-xs underline" onClick={() => setBatch(null)}>Cancelar</button>
          </div>
        )}
        {liveTarget && <p className="mb-2 rounded-lg bg-brand-100/60 px-3 py-2 text-sm text-brand-800">Foto com modelo para <strong>{products.find(p => p.id === liveTarget.product_id)?.name}</strong> na cor <strong>{liveTarget.color}</strong>. Escolha a modelo e o cenário e gere; depois toque em <strong>Publicar na peça</strong>.</p>}
        <h3 className="text-sm font-semibold text-gray-900">1. Escolha a modelo</h3>
        {models.length === 0 ? <p className="mt-1 text-sm text-gray-600">Você ainda não tem modelo. <button type="button" className="text-brand-700 underline" onClick={() => goTo('modelo')}>Crie a primeira na aba Modelos</button>.</p> : (
          <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">{models.map(m => <Pickable key={m.id} url={m.url} label={m.title ?? 'Modelo'} selected={model === m.id} onClick={() => setModel(m.id)} />)}</div>
        )}
      </div>
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-gray-900">2. Escolha as peças <span className="font-normal text-gray-500">({picked.length} de até {MAX_LOOK_PIECES}; 1 peça = foto da peça com a modelo)</span></h3>
          {picked.length > 0 && <button type="button" className="text-xs text-gray-500 underline" onClick={() => setPicked([])}>Limpar</button>}
        </div>
        <input className={`${inp} mt-2`} value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar peça por nome ou código" />
        <p className="mt-1 text-xs text-gray-500">Para <strong>misturar peças suas</strong> (ex.: a calça e a blusa da loja), toque em mais de uma foto; o número mostra a ordem.</p>
        <PickedColors picked={picked} products={products} target={liveTarget} onColor={(pid, color) => setTarget({ product_id: pid, color })} />
        {products.length === 0 ? <p className="mt-2 text-sm text-gray-600">Nenhuma peça com foto ainda. Adicione fotos em Produtos.</p> : (
          <div className="mt-2 grid max-h-[420px] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-6">
            {tiles.map(t => { const k = isPicked(t.p.id, t.i); return <Pickable key={`${t.p.id}-${t.i}`} url={t.url} label={`${t.p.code} · ${t.info?.color ?? t.p.name}`} selected={k >= 0} badge={k >= 0 ? String(k + 1) : undefined} onClick={() => toggle(t.p.id, t.i)} /> })}
          </div>
        )}
      </div>
      {picked.length > 0 && (
        <div className="space-y-1.5 rounded-lg border border-gray-200 p-3">
          <p className="text-sm font-medium text-gray-900">O resto do look</p>
          <label className="flex items-start gap-2 text-sm text-gray-700"><input type="radio" className="mt-1" checked={complete} onChange={() => setCompleteChoice(true)} />
            <span><strong>A IA completa o look</strong> com peças simples que combinam, na essência da loja (ex.: escolheu só a calça, ela põe blusa e sapato). <span className="text-xs text-gray-500">As peças extras não são da loja; servem só para compor a foto.</span></span></label>
          <label className="flex items-start gap-2 text-sm text-gray-700"><input type="radio" className="mt-1" checked={!complete} onChange={() => setCompleteChoice(false)} />
            <span><strong>Só as peças que eu escolhi</strong>{picked.length === 1 ? ' (a IA veste só esta peça)' : ''}.</span></label>
        </div>
      )}
      <div>
        <h3 className="text-sm font-semibold text-gray-900">3. Cenário <span className="font-normal text-gray-500">(opcional)</span></h3>
        {scenes.length === 0 ? <p className="mt-1 text-sm text-gray-600">Sem cenário, a modelo sai num fundo neutro. <button type="button" className="text-brand-700 underline" onClick={() => goTo('cenario')}>Criar cenário</button></p> : (
          <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">{scenes.map(s => <Pickable key={s.id} url={s.url} label={s.title ?? 'Cenário'} selected={scene === s.id} onClick={() => setScene(scene === s.id ? null : s.id)} />)}</div>
        )}
      </div>
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-900">4. Gerar</h3>
        <div><label className={lbl} htmlFor="lk-title">Nome da foto (opcional)</label><input id="lk-title" className={inp} value={title} onChange={e => setTitle(e.target.value)} placeholder="ex.: Reunião de segunda" /></div>
        <div><div className="flex items-baseline justify-between"><label className={lbl} htmlFor="lk-prompt">Pedido para a IA</label>{custom !== null && <button type="button" className="text-xs text-gray-500 underline" onClick={() => setCustom(null)}>Voltar ao texto padrão</button>}</div>
          <textarea id="lk-prompt" className={inp} rows={8} value={prompt} onChange={e => setCustom(e.target.value)} />
          <p className="mt-1 text-xs text-gray-500">Ao gerar, o Drone acrescenta ao pedido o nome, o tipo e a cor de cada peça{complete ? ', e o pedido para completar o look na essência da loja' : ''}.</p></div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <ProviderPick connected={connected} value={provider || connected[0] || ''} onChange={setProvider} />
          <div><label className={lbl} htmlFor="lk-n">Quantas fotos</label><select id="lk-n" className={inp} value={times} onChange={e => setTimes(Number(e.target.value))}><option value={1}>1 foto</option><option value={2}>2 fotos, poses diferentes (cobra 2)</option></select></div>
          <div><label className={lbl} htmlFor="lk-pose">Pose</label><select id="lk-pose" className={inp} value={pose} onChange={e => setPose(e.target.value)} disabled={times > 1}>
            <option value="auto">{times > 1 ? 'Uma pose diferente em cada foto' : 'A IA escolhe'}</option>{POSES.map(p => <option key={p} value={p}>{p}</option>)}</select></div>
        </div>
        <p className="text-xs text-gray-500">Tamanho: {IMAGE_FORMAT.look.label}, o padrão da vitrine (cartão do look e capa do computador).</p>
        {batch ? (
          <button type="button" className={btn} disabled={g.busy || !(provider || connected[0]) || !batch.colors.length || (!batch.baseId && !model)} onClick={() => generateAll(batch)}>
            Gerar todas as cores ({batch.colors.length} foto{batch.colors.length > 1 ? 's' : ''})</button>
        ) : (
        <button type="button" className={btn} disabled={g.busy || !(provider || connected[0]) || !model || !picked.length}
          onClick={() => {
            const start = Math.floor(Math.random() * POSES.length)
            const poses = times > 1 ? [POSES[start], POSES[(start + 1 + Math.floor(Math.random() * (POSES.length - 1))) % POSES.length]] : [pose === 'auto' ? POSES[start] : pose]
            g.run(poses.map(p => ({ kind: 'look', provider: provider || connected[0], prompt, title, model_image_id: model, scene_image_id: scene, pieces: picked, pose: p, target: liveTarget, complete })))
          }}>Gerar foto do look</button>
        )}
        {!picked.length && <p className="text-xs text-gray-500">Escolha a modelo e ao menos uma peça.</p>}
        <Waiting busy={g.busy} />
        {g.err && <p role="alert" className="rounded-lg bg-negative-100 px-3 py-2 text-sm text-negative-700">{g.err}</p>}
        {g.writing && <p className="text-sm text-gray-600" role="status">Escrevendo o texto do look pela foto…</p>}
        <Results made={g.last} looks={looks} occasions={occasions} />
      </div>
      <LookGallery images={images.filter(i => i.kind === 'look')} looks={looks} occasions={occasions} />
    </section>
  )
}

// Peça escolhida com várias cores e foto sem cor marcada: pergunta a cor (e já grava na foto)
function PickedColors({ picked, products, target, onColor }: { picked: { product_id: string; photo: number }[]; products: StudioProduct[]; target: Target | null; onColor: (pid: string, color: string) => void }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const rows = picked.map(x => {
    const p = products.find(o => o.id === x.product_id)
    const path = p?.paths[x.photo] ?? ''
    return { p, path, color: p?.meta[path]?.color ?? null }
  }).filter(r => r.p && r.p.colors.length > 1 && !r.color) as { p: StudioProduct; path: string; color: null }[]
  if (!rows.length) return null
  async function save(p: StudioProduct, path: string, color: string) {
    setBusy(true); setErr(null)
    const r = await setRetailPhotoMeta(p.id, path, { color, model: false })
    setBusy(false)
    if (!r.ok) { setErr(r.error); return }
    onColor(p.id, color); router.refresh()
  }
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-warn-700/30 bg-warn-100/60 p-3">
      <p className="text-sm font-medium text-gray-900">Qual é a cor da peça nesta foto?</p>
      <p className="text-xs text-gray-700">Sem a cor, a IA pode errar o tom ou manter a roupa da modelo. A cor fica gravada na foto da peça.</p>
      {rows.map(({ p, path }) => (
        <label key={`${p.id}-${path}`} className="flex flex-wrap items-center gap-2 text-sm text-gray-800"><span><strong>{p.code}</strong> · {p.name}</span>
          <select className="rounded-lg border border-gray-300 px-2 py-1 text-sm" disabled={busy} value={target?.product_id === p.id ? target.color ?? '' : ''} onChange={e => e.target.value && save(p, path, e.target.value)}>
            <option value="">Escolha a cor…</option>{p.colors.map(c => <option key={c} value={c}>{c}</option>)}
          </select></label>
      ))}
      {err && <p role="alert" className="text-xs text-negative-700">{err}</p>}
    </div>
  )
}

// ── Aviso: peças com mais de uma cor sem foto com modelo em alguma cor ─────────
function MissingColors({ products, onStart, onAll }: { products: StudioProduct[]; onStart: (p: StudioProduct, color: string, ref: number) => void; onAll: (p: StudioProduct) => void }) {
  const [all, setAll] = useState(false)
  const rows = products.map(p => ({ p, miss: missingModelColors(p.paths, p.meta, p.colors), cov: colorCoverage(p.paths, p.meta, p.colors) })).filter(r => r.miss.length > 0)
  if (!rows.length) return null
  const total = rows.reduce((t, r) => t + r.miss.length, 0)
  const shown = all ? rows : rows.slice(0, 5)
  return (
    <div className="space-y-2 rounded-lg border border-warn-700/30 bg-warn-100/60 p-3">
      <p className="text-sm font-semibold text-gray-900">Faltam fotos com modelo: {rows.length} peça(s), {total} cor(es)</p>
      <p className="text-xs text-gray-700">Peça com mais de uma cor precisa de uma foto com a modelo <strong>em cada cor</strong>: na vitrine, a cliente toca na cor e a foto troca. A IA veste a peça a partir da <strong>foto real da peça naquela cor</strong>.</p>
      <ul className="divide-y divide-warn-700/10">
        {shown.map(({ p, cov }) => (
          <li key={p.id} className="flex flex-wrap items-center gap-2 py-2">
            <span className="min-w-0 flex-1 text-sm text-gray-900"><strong>{p.code}</strong> · {p.name}{p.status !== 'publicado' ? <span className="ml-1 text-xs text-gray-500">(não publicada)</span> : null}</span>
            <span className="flex flex-wrap gap-1.5">
              {(() => {
                const ready = cov.filter(c => !c.model && c.reference !== null).length
                const hasBase = p.paths.some(path => p.meta[path]?.model && /(^|\/)ia\//.test(path))
                return ready >= 2 || (ready >= 1 && hasBase)
                  ? <button type="button" onClick={() => onAll(p)} className="rounded-full border border-brand-700 bg-white px-2.5 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-100">Todas as cores ({ready})</button>
                  : null
              })()}
              {cov.map(c => c.model
                ? <span key={c.color} className="rounded-full bg-positive-100 px-2 py-1 text-xs text-positive-700">✓ {c.color}</span>
                : c.reference !== null
                  ? <button key={c.color} type="button" onClick={() => onStart(p, c.color, c.reference as number)} className="rounded-full bg-brand-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-800">Gerar {c.color}</button>
                  : <a key={c.color} href={`/varejo/produtos/${p.id}#fotos`} className="rounded-full border border-warn-700/40 bg-white px-2.5 py-1 text-xs text-warn-700" title="Suba uma foto real da peça nesta cor e marque a cor na foto">Falta foto real {c.color}</a>)}
            </span>
          </li>
        ))}
      </ul>
      {rows.length > 5 && <button type="button" className="text-xs text-brand-700 underline" onClick={() => setAll(!all)}>{all ? 'Mostrar menos' : `Ver todas (${rows.length})`}</button>}
    </div>
  )
}

// Publicar a foto com a modelo na peça, na cor certa, com o texto da peça
function PublishToProduct({ id, pieces, target, site, setSite }: { id: string; pieces: string[]; target: Target | null; site: string; setSite: (v: string) => void }) {
  const router = useRouter()
  const all = useContext(ProductsCtx)
  const options = all.filter(p => pieces.includes(p.id))
  const [pid, setPid] = useState(target?.product_id && options.some(o => o.id === target.product_id) ? target.product_id : options[0]?.id ?? '')
  const prod = options.find(o => o.id === pid)
  const firstMissing = prod ? missingModelColors(prod.paths, prod.meta, prod.colors)[0]?.color : undefined
  const [color, setColor] = useState<string>(target?.color ?? firstMissing ?? prod?.colors[0] ?? '')
  const [useText, setUseText] = useState(true)
  const [showOnSite, setShowOnSite] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  if (!options.length) return null
  const colorOk = !prod || prod.colors.length === 0 ? '' : prod.colors.includes(color) ? color : ''
  async function go() {
    setBusy(true); setMsg(null)
    const r = await publishAiImageToProduct(id, { productId: pid, color: colorOk || null, description: useText ? site : null, showOnSite })
    setBusy(false)
    setMsg(!r.ok ? { ok: false, text: r.error }
      : r.onSite ? { ok: true, text: `Foto colocada em ${prod?.name}${colorOk ? `, cor ${colorOk}` : ''}, e a peça está no site. A vitrine atualiza em até 1 minuto.` }
      : { ok: false, text: `Foto colocada em ${prod?.name}${colorOk ? `, cor ${colorOk}` : ''}, mas ainda NÃO aparece no site. ${r.note ?? ''}` })
    if (r.ok) router.refresh()
  }
  return (
    <div className="space-y-1.5 rounded-md bg-brand-100/40 p-2">
      <p className="text-[11px] font-medium text-gray-700">Publicar na peça (foto com a modelo)</p>
      {options.length > 1 && <select className={inp} value={pid} onChange={e => { setPid(e.target.value); const o = options.find(x => x.id === e.target.value); setColor(o ? (missingModelColors(o.paths, o.meta, o.colors)[0]?.color ?? o.colors[0] ?? '') : '') }} aria-label="Peça">{options.map(o => <option key={o.id} value={o.id}>{o.code} · {o.name}</option>)}</select>}
      {options.length === 1 && <p className="text-xs text-gray-700">{prod?.code} · {prod?.name}</p>}
      {prod && prod.colors.length > 0 && (
        <select className={inp} value={colorOk} onChange={e => setColor(e.target.value)} aria-label="Cor da peça nesta foto">
          <option value="">Vale para todas as cores</option>
          {prod.colors.map(c => <option key={c} value={c}>Cor: {c}{colorCoverage(prod.paths, prod.meta, [c])[0].model ? ' (já tem foto com modelo)' : ''}</option>)}
        </select>
      )}
      <label className="block text-[11px] text-gray-600">Texto da peça no site (descrição)
        <textarea className={`${inp} mt-0.5 text-xs`} rows={3} value={site} onChange={e => setSite(e.target.value)} placeholder="Toque em Sugerir texto acima ou escreva aqui" /></label>
      <label className="flex items-center gap-1.5 text-[11px] text-gray-600"><input type="checkbox" checked={useText && !!site.trim()} disabled={!site.trim()} onChange={e => setUseText(e.target.checked)} />Usar este texto como descrição da peça</label>
      {prod && prod.status !== 'publicado' && (
        <label className="flex items-start gap-1.5 rounded bg-warn-100 px-2 py-1 text-[11px] text-warn-700"><input type="checkbox" className="mt-0.5" checked={showOnSite} onChange={e => setShowOnSite(e.target.checked)} />
          <span>A peça está como <strong>{prod.status === 'arquivado' ? 'Arquivada' : 'Rascunho'}</strong> e não aparece no site. Marque para <strong>publicar a peça</strong> junto com a foto.</span></label>
      )}
      <button type="button" className={`${btn} w-full`} disabled={busy || !pid} onClick={go}>{busy ? 'Publicando…' : 'Publicar na peça'}</button>
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`rounded px-2 py-1 text-xs ${msg.ok ? 'bg-positive-100 text-positive-700' : 'bg-negative-100 text-negative-700'}`}>{msg.text}</p>}
    </div>
  )
}

function LookGallery({ images, looks, occasions }: { images: StudioImage[]; looks: Opt[]; occasions: Opt[] }) {
  const [open, setOpen] = useState<string | null>(null)
  if (!images.length) return null
  return (
    <div className="space-y-2 border-t border-gray-100 pt-4">
      <h3 className="text-sm font-semibold text-gray-900">Fotos de look já criadas ({images.length})</h3>
      <p className="text-xs text-gray-500">Toque na foto para colocar no site.</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {images.map(i => (
          <div key={i.id} className={`overflow-hidden rounded-lg border ${open === i.id ? 'border-brand-700' : 'border-gray-200'}`}>
            <button type="button" onClick={() => setOpen(open === i.id ? null : i.id)} className="block w-full text-left">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={i.url} alt={i.title ?? 'Look'} loading="lazy" className="aspect-[4/5] w-full bg-gray-100 object-cover" />
              <span className="block truncate px-2 py-1 text-xs text-gray-700">{i.title ?? 'Look'}</span>
            </button>
            {open === i.id && <ImageActions id={i.id} kind="look" url={i.url} looks={looks} occasions={occasions} copy={i.copy} pieces={i.pieces} target={i.target} />}
          </div>
        ))}
      </div>
    </div>
  )
}

// Publicar uma imagem: criar look na vitrine, capa de look existente, capa da vitrine, excluir
function ImageActions({ id, kind, url, looks, occasions, copy: initialCopy = null, pieces = [], target = null }: { id: string; kind: StudioImage['kind']; url: string; looks: Opt[]; occasions: Opt[]; copy?: LookCopy | null; pieces?: string[]; target?: Target | null }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [occ, setOcc] = useState(initialCopy?.occasion.id ?? '')
  const [copy, setCopy] = useState<LookCopy | null>(initialCopy)
  const [site, setSite] = useState(initialCopy?.site ?? '')
  const [copyBusy, setCopyBusy] = useState(false)
  const [copyErr, setCopyErr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  async function suggest() {
    setCopyBusy(true); setCopyErr(null)
    const r = await fetch('/api/varejo/ia/texto', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image_id: id }) })
      .then(async (x): Promise<{ copy: LookCopy } | { error: string }> => { const j = await x.json().catch(() => ({})); return x.ok ? { copy: j.copy as LookCopy } : { error: String(j.error ?? `Erro ${x.status}.`) } })
      .catch((): { error: string } => ({ error: 'Sem conexão. Tente de novo.' }))
    setCopyBusy(false)
    if ('error' in r) { setCopyErr(r.error); return }
    setCopy(r.copy); setSite(r.copy.site); if (r.copy.occasion.id) setOcc(r.copy.occasion.id)
  }
  async function copySocial() {
    if (!copy) return
    const text = `${copy.social}${copy.hashtags.length ? `\n\n${copy.hashtags.map(h => `#${h}`).join(' ')}` : ''}`
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { setCopyErr('Não foi possível copiar. Selecione o texto e copie.') }
  }
  const [look, setLook] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  async function act(f: () => Promise<{ ok: true } | { ok: false; error: string }>, okText: string) {
    setBusy(true); setMsg(null)
    const r = await f()
    setBusy(false)
    setMsg(r.ok ? { ok: true, text: okText } : { ok: false, text: r.error })
    if (r.ok) router.refresh()
  }
  return (
    <div className="space-y-2 border-t border-gray-100 p-2">
      {kind === 'look' && (
        <div className="space-y-1.5 rounded-md border border-gray-100 p-2">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[11px] font-medium text-gray-700">Texto sugerido</p>
            {!copyBusy && <button type="button" className="text-[11px] text-brand-700 underline" onClick={suggest}>{copy ? 'Refazer texto' : 'Sugerir texto'}</button>}
          </div>
          {copyBusy && <p className="text-[11px] text-gray-500" role="status">Escrevendo pela foto…</p>}
          {copyErr && <p role="alert" className="text-[11px] text-negative-700">{copyErr}</p>}
          {copy && (
            <>
              {pieces.length > 1 && <label className="block text-[11px] text-gray-600">Para o site (vai na descrição do look)
                <textarea className={`${inp} mt-0.5 text-xs`} rows={4} value={site} onChange={e => setSite(e.target.value)} /></label>}
              <div className="text-[11px] text-gray-600">Para a rede social
                <p className="mt-0.5 whitespace-pre-wrap rounded-lg bg-gray-50 p-2 text-xs text-gray-800">{copy.social}{copy.hashtags.length ? `\n\n${copy.hashtags.map(h => `#${h}`).join(' ')}` : ''}</p>
                <button type="button" className="mt-1 text-[11px] text-brand-700 underline" onClick={copySocial}>{copied ? 'Copiado' : 'Copiar legenda'}</button></div>
              {copy.occasion.name && (
                <p className="rounded bg-brand-100/50 px-2 py-1 text-[11px] text-gray-700"><strong>Ocasião sugerida:</strong> {copy.occasion.name}{copy.occasion.why ? `. ${copy.occasion.why}` : ''}{!copy.occasion.id ? ' (é nova: crie em Varejo → Vitrine → Ocasiões)' : ''}</p>
              )}
            </>
          )}
        </div>
      )}
      {kind === 'look' && pieces.length === 1 && <PublishToProduct id={id} pieces={pieces} target={target} site={site} setSite={setSite} />}
      {kind === 'look' && (
        <div className="space-y-1.5 rounded-md bg-brand-100/40 p-2">
          <p className="text-[11px] font-medium text-gray-700">Criar look na vitrine com esta foto (já com as peças dela)</p>
          <input className={inp} value={name} onChange={e => setName(e.target.value)} placeholder="Nome do look (ex.: Reunião)" aria-label="Nome do look" />
          {occasions.length > 0 && <select className={inp} value={occ} onChange={e => setOcc(e.target.value)} aria-label="Ocasião"><option value="">Sem ocasião</option>{occasions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select>}
          <button type="button" className={`${btn} w-full`} disabled={busy || !name.trim()} onClick={() => act(() => createLookFromAiImage(id, { name, occasion: occ || null, description: site || null }), 'Look criado e publicado na vitrine.')}>Criar look no site</button>
        </div>
      )}
      {kind === 'look' && looks.length > 0 && (
        <div className="space-y-1.5">
          <select className={inp} value={look} onChange={e => setLook(e.target.value)} aria-label="Look existente"><option value="">Ou trocar a capa de um look…</option>{looks.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
          {look && <button type="button" className={`${btnLine} w-full`} disabled={busy} onClick={() => act(() => publishAiImage(id, { look }), 'Capa do look trocada.')}>Usar como capa deste look</button>}
        </div>
      )}
      {kind === 'look' && pieces.length > 1 && (
        <details className="rounded-md border border-gray-100 p-2">
          <summary className="cursor-pointer text-[11px] font-medium text-gray-700">Publicar também na página de uma das peças</summary>
          <div className="mt-1.5"><PublishToProduct id={id} pieces={pieces} target={target} site={site} setSite={setSite} /></div>
        </details>
      )}
      <button type="button" className={`${btnLine} w-full`} disabled={busy} onClick={() => act(() => publishAiImage(id, { hero: 'desktop' }), 'Capa da vitrine (computador) trocada.')}>Capa da vitrine (computador)</button>
      <button type="button" className={`${btnLine} w-full`} disabled={busy} onClick={() => act(() => publishAiImage(id, { hero: 'mobile' }), 'Capa da vitrine (celular) trocada.')}>Capa da vitrine (celular)</button>
      <button type="button" className={`${btnLine} w-full`} onClick={() => downloadImage(url, copy?.occasion.name ? `look-${copy.occasion.name}` : 'foto-ia')}>Baixar a foto</button>
      <div className="flex justify-between text-xs"><a href={url} target="_blank" rel="noopener noreferrer" className="text-brand-700 underline">Abrir grande</a><button type="button" className="text-negative-700" disabled={busy} onClick={() => { if (confirm('Excluir esta imagem do banco?')) void act(() => deleteAiImage(id), 'Excluída.') }}>Excluir</button></div>
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`rounded px-2 py-1 text-xs ${msg.ok ? 'bg-positive-100 text-positive-700' : 'bg-negative-100 text-negative-700'}`}>{msg.text}{msg.ok ? ' A vitrine atualiza em até 1 minuto.' : ''}</p>}
    </div>
  )
}

// ── Modelos virtuais ──────────────────────────────────────────────────────────
function ModelTab({ images, connected }: { images: StudioImage[]; connected: AiProvider[] }) {
  const [s, setS] = useState<ModelSpec>({ age: '30 a 35 anos', body: 'manequim 40, curvas suaves', skin: 'morena', hair: 'castanho escuro, longo e ondulado', style: 'elegante, sorriso leve e natural', extra: '' })
  const [title, setTitle] = useState('')
  const [provider, setProvider] = useState<AiProvider | ''>(connected[0] ?? '')
  const [custom, setCustom] = useState<string | null>(null)
  const g = useGenerate()
  const prompt = custom ?? modelPrompt(s)
  const set = (k: keyof ModelSpec) => (e: React.ChangeEvent<HTMLInputElement>) => { setS(p => ({ ...p, [k]: e.target.value })); setCustom(null) }
  return (
    <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-sm text-gray-600">Crie a modelo da marca uma vez e reuse em todos os looks. Ela é uma pessoa que não existe, criada pela IA: sem direito de imagem de terceiros.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div><label className={lbl} htmlFor="mo-title">Nome para você reconhecer</label><input id="mo-title" className={inp} value={title} onChange={e => setTitle(e.target.value)} placeholder="ex.: Modelo Ana" /></div>
        <div><label className={lbl} htmlFor="mo-age">Idade aparente</label><input id="mo-age" className={inp} value={s.age} onChange={set('age')} /></div>
        <div><label className={lbl} htmlFor="mo-body">Tipo de corpo / manequim</label><input id="mo-body" className={inp} value={s.body} onChange={set('body')} /></div>
        <div><label className={lbl} htmlFor="mo-skin">Tom de pele</label><input id="mo-skin" className={inp} value={s.skin} onChange={set('skin')} /></div>
        <div><label className={lbl} htmlFor="mo-hair">Cabelo</label><input id="mo-hair" className={inp} value={s.hair} onChange={set('hair')} /></div>
        <div><label className={lbl} htmlFor="mo-style">Estilo e expressão</label><input id="mo-style" className={inp} value={s.style} onChange={set('style')} /></div>
        <div className="sm:col-span-2"><label className={lbl} htmlFor="mo-extra">Mais algum detalhe (opcional)</label><input id="mo-extra" className={inp} value={s.extra} onChange={set('extra')} /></div>
      </div>
      <div><div className="flex items-baseline justify-between"><label className={lbl} htmlFor="mo-prompt">Pedido para a IA</label>{custom !== null && <button type="button" className="text-xs text-gray-500 underline" onClick={() => setCustom(null)}>Voltar ao texto padrão</button>}</div>
        <textarea id="mo-prompt" className={inp} rows={5} value={prompt} onChange={e => setCustom(e.target.value)} /></div>
      <ProviderPick connected={connected} value={provider || connected[0] || ''} onChange={setProvider} />
      <button type="button" className={btn} disabled={g.busy || !(provider || connected[0])} onClick={() => g.run([{ kind: 'modelo', provider: provider || connected[0], prompt, title: title || 'Modelo' }])}>Criar modelo</button>
      <Waiting busy={g.busy} />
      {g.err && <p role="alert" className="rounded-lg bg-negative-100 px-3 py-2 text-sm text-negative-700">{g.err}</p>}
      <Results made={g.last} />
      <Gallery images={images} />
    </section>
  )
}

// ── Cenários ──────────────────────────────────────────────────────────────────
function SceneTab({ images, connected }: { images: StudioImage[]; connected: AiProvider[] }) {
  const [place, setPlace] = useState(SCENE_PLACES[0])
  const [mood, setMood] = useState('acolhedor, tons claros e madeira, luz quente')
  const [extra, setExtra] = useState('')
  const [title, setTitle] = useState('')
  const [provider, setProvider] = useState<AiProvider | ''>(connected[0] ?? '')
  const [custom, setCustom] = useState<string | null>(null)
  const g = useGenerate()
  const prompt = custom ?? scenePrompt({ place, mood, extra })
  return (
    <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-sm text-gray-600">Ambientes sem pessoas, criados pela IA, para colocar a modelo depois.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div><label className={lbl} htmlFor="sc-title">Nome</label><input id="sc-title" className={inp} value={title} onChange={e => setTitle(e.target.value)} placeholder="ex.: Provador claro" /></div>
        <div><label className={lbl} htmlFor="sc-place">Lugar <span className="font-normal text-gray-400">(escreva qualquer lugar ou escolha uma sugestão)</span></label>
          <input id="sc-place" className={inp} list="sc-places" value={place} onChange={e => { setPlace(e.target.value); setCustom(null) }} placeholder="ex.: parque com árvores e banco de madeira" />
          <datalist id="sc-places">{SCENE_PLACES.map(p => <option key={p} value={p} />)}</datalist></div>
        <div><label className={lbl} htmlFor="sc-mood">Clima</label><input id="sc-mood" className={inp} value={mood} onChange={e => { setMood(e.target.value); setCustom(null) }} /></div>
        <div><label className={lbl} htmlFor="sc-extra">Mais algum detalhe (opcional)</label><input id="sc-extra" className={inp} value={extra} onChange={e => { setExtra(e.target.value); setCustom(null) }} /></div>
      </div>
      <div><div className="flex items-baseline justify-between"><label className={lbl} htmlFor="sc-prompt">Pedido para a IA</label>{custom !== null && <button type="button" className="text-xs text-gray-500 underline" onClick={() => setCustom(null)}>Voltar ao texto padrão</button>}</div>
        <textarea id="sc-prompt" className={inp} rows={4} value={prompt} onChange={e => setCustom(e.target.value)} /></div>
      <ProviderPick connected={connected} value={provider || connected[0] || ''} onChange={setProvider} />
      <button type="button" className={btn} disabled={g.busy || !(provider || connected[0]) || !prompt.trim()} onClick={() => g.run([{ kind: 'cenario', provider: provider || connected[0], prompt, title: title || place || 'Cenário' }])}>Criar cenário</button>
      <Waiting busy={g.busy} />
      {g.err && <p role="alert" className="rounded-lg bg-negative-100 px-3 py-2 text-sm text-negative-700">{g.err}</p>}
      <Results made={g.last} />
      <Gallery images={images} />
    </section>
  )
}

function Gallery({ images }: { images: StudioImage[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  if (!images.length) return null
  async function remove(i: StudioImage) {
    if (!confirm(`Excluir ${i.title ?? 'esta imagem'}? As fotos de look já criadas com ela continuam.`)) return
    setBusy(i.id); setErr(null)
    const r = await deleteAiImage(i.id)
    setBusy(null)
    if (!r.ok) { setErr(r.error); return }
    router.refresh()
  }
  return (
    <div className="space-y-2 border-t border-gray-100 pt-3">
      {err && <p role="alert" className="rounded-lg bg-negative-100 px-3 py-2 text-sm text-negative-700">{err}</p>}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {images.map(i => (
          <div key={i.id}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <a href={i.url} target="_blank" rel="noopener noreferrer" className="block"><img src={i.url} alt={i.title ?? ''} loading="lazy" className="aspect-[3/4] w-full rounded-lg bg-gray-100 object-cover" /></a>
            <div className="flex items-center justify-between gap-1"><span className="truncate text-[11px] text-gray-600">{i.title}</span>
              <span className="flex shrink-0 gap-2"><button type="button" className="text-[11px] text-brand-700" onClick={() => downloadImage(i.url, i.title ?? i.kind)}>Baixar</button>
              <button type="button" className="text-[11px] text-negative-700 disabled:opacity-50" disabled={busy === i.id} onClick={() => remove(i)}>{busy === i.id ? '…' : 'Excluir'}</button></span></div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Banco de imagens e publicação ─────────────────────────────────────────────
function BankTab({ images, looks, occasions }: { images: StudioImage[]; looks: Opt[]; occasions: Opt[] }) {
  const [kind, setKind] = useState<'todas' | StudioImage['kind']>('todas')
  const [open, setOpen] = useState<string | null>(null)
  const list = images.filter(i => kind === 'todas' || i.kind === kind)
  const label = { modelo: 'Modelo', cenario: 'Cenário', look: 'Look' } as const
  return (
    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-sm text-gray-600">Tudo o que você criou fica aqui. Toque na foto para colocar no site (look da vitrine ou capa) ou excluir.</p>
      <div className="flex flex-wrap gap-2 text-sm">
        {(['todas', 'look', 'modelo', 'cenario'] as const).map(k => <button key={k} type="button" onClick={() => setKind(k)} className={`rounded-full px-3 py-1 ${kind === k ? 'bg-brand-700 text-white' : 'border border-gray-300 text-gray-700'}`}>{k === 'todas' ? 'Todas' : label[k]}</button>)}
      </div>
      {list.length === 0 ? <p className="text-sm text-gray-500">Nada aqui ainda.</p> : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {list.map(i => (
            <div key={i.id} className={`overflow-hidden rounded-lg border ${open === i.id ? 'border-brand-700' : 'border-gray-200'}`}>
              <button type="button" onClick={() => setOpen(open === i.id ? null : i.id)} className="block w-full text-left">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={i.url} alt={i.title ?? ''} loading="lazy" className="aspect-[4/5] w-full bg-gray-100 object-cover" />
                <span className="block px-2 py-1 text-xs text-gray-700"><span className="font-medium">{label[i.kind]}</span>{i.title ? ` · ${i.title}` : ''}</span>
              </button>
              {open === i.id && <ImageActions id={i.id} kind={i.kind} url={i.url} looks={looks} occasions={occasions} copy={i.copy} pieces={i.pieces} target={i.target} />}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
