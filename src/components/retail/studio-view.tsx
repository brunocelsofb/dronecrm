'use client'

// Estúdio IA: conta de IA da administradora, modelos virtuais, cenários, foto do look
// (modelo + peças + cenário) e o banco de imagens para publicar na vitrine.

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createLookFromAiImage, deleteAiImage, publishAiImage, removeAiConnection, saveAiConnection, setAiModel } from '@/lib/actions/retail-ai-studio'
import { AI_PROVIDERS, IMAGE_FORMAT, MAX_LOOK_PIECES, POSES, SCENE_PLACES, lookPrompt, modelPrompt, scenePrompt, type AiProvider, type ModelSpec } from '@/lib/retail/ai-studio'

export type StudioImage = { id: string; kind: 'modelo' | 'cenario' | 'look'; title: string | null; url: string; provider: string; created_at: string }
export type StudioProduct = { id: string; code: string; name: string; photos: string[] }
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
type Made = { id: string; url: string; kind: StudioImage['kind'] }
function useGenerate() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [last, setLast] = useState<Made[]>([])
  // Um pedido por foto (com 2 fotos, cada pedido leva uma pose diferente)
  async function run(bodies: Record<string, unknown>[]) {
    setBusy(true); setErr(null)
    const results = await Promise.all(bodies.map(body => fetch('/api/varejo/ia/gerar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(async r => { const j = await r.json().catch(() => ({})); return r.ok ? { id: j.id as string, url: j.url as string, kind: j.kind as Made['kind'] } : { error: (j.error as string) ?? (r.status === 504 ? 'A IA demorou demais e o tempo acabou. Tente de novo ou use o modelo rápido.' : `Erro ${r.status}.`) } })
      .catch(() => ({ error: 'Sem conexão. Tente de novo.' }))))
    setBusy(false)
    const ok = results.filter((x): x is Made => 'url' in x)
    const bad = results.find((x): x is { error: string } => 'error' in x)
    if (bad) setErr(bad.error)
    if (ok.length) { setLast(ok); router.refresh() }
  }
  return { busy, err, last, run }
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
  return (
    <div className="space-y-2 rounded-lg bg-positive-100/50 p-3">
      <p className="text-sm font-medium text-positive-700">Pronto! {made.length > 1 ? 'As fotos ficaram guardadas' : 'A foto ficou guardada'} no Banco de imagens{made[0].kind === 'look' ? '. Para colocar no site, use os botões abaixo da foto.' : '.'}</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {made.map(m => (
          <div key={m.id} className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <a href={m.url} target="_blank" rel="noopener noreferrer"><img src={m.url} alt="Imagem gerada" className="aspect-[4/5] w-full object-cover" /></a>
            {m.kind === 'look' && looks && occasions && <ImageActions id={m.id} kind="look" url={m.url} looks={looks} occasions={occasions} />}
          </div>
        ))}
      </div>
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
  const g = useGenerate()
  const auto = lookPrompt(Math.max(1, picked.length), !!scene)
  const prompt = custom ?? auto
  const term = q.trim().toLowerCase()
  const tiles = useMemo(() => products.filter(p => !term || p.name.toLowerCase().includes(term) || p.code.toLowerCase().includes(term))
    .flatMap(p => p.photos.map((url, i) => ({ p, url, i }))).slice(0, 120), [products, term])
  const isPicked = (pid: string, i: number) => picked.findIndex(x => x.product_id === pid && x.photo === i)
  const toggle = (pid: string, i: number) => setPicked(prev => {
    const k = prev.findIndex(x => x.product_id === pid && x.photo === i)
    if (k >= 0) return prev.filter((_, j) => j !== k)
    return prev.length >= MAX_LOOK_PIECES ? prev : [...prev, { product_id: pid, photo: i }]
  })
  return (
    <section className="space-y-5 rounded-xl border border-gray-200 bg-white p-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">1. Escolha a modelo</h3>
        {models.length === 0 ? <p className="mt-1 text-sm text-gray-600">Você ainda não tem modelo. <button type="button" className="text-brand-700 underline" onClick={() => goTo('modelo')}>Crie a primeira na aba Modelos</button>.</p> : (
          <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">{models.map(m => <Pickable key={m.id} url={m.url} label={m.title ?? 'Modelo'} selected={model === m.id} onClick={() => setModel(m.id)} />)}</div>
        )}
      </div>
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-gray-900">2. Escolha as peças do look <span className="font-normal text-gray-500">({picked.length} de até {MAX_LOOK_PIECES})</span></h3>
          {picked.length > 0 && <button type="button" className="text-xs text-gray-500 underline" onClick={() => setPicked([])}>Limpar</button>}
        </div>
        <input className={`${inp} mt-2`} value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar peça por nome ou código" />
        {products.length === 0 ? <p className="mt-2 text-sm text-gray-600">Nenhuma peça com foto ainda. Adicione fotos em Produtos.</p> : (
          <div className="mt-2 grid max-h-[420px] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-6">
            {tiles.map(t => { const k = isPicked(t.p.id, t.i); return <Pickable key={`${t.p.id}-${t.i}`} url={t.url} label={`${t.p.code} · ${t.p.name}`} selected={k >= 0} badge={k >= 0 ? String(k + 1) : undefined} onClick={() => toggle(t.p.id, t.i)} /> })}
          </div>
        )}
      </div>
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
          <textarea id="lk-prompt" className={inp} rows={8} value={prompt} onChange={e => setCustom(e.target.value)} /></div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <ProviderPick connected={connected} value={provider || connected[0] || ''} onChange={setProvider} />
          <div><label className={lbl} htmlFor="lk-n">Quantas fotos</label><select id="lk-n" className={inp} value={times} onChange={e => setTimes(Number(e.target.value))}><option value={1}>1 foto</option><option value={2}>2 fotos, poses diferentes (cobra 2)</option></select></div>
          <div><label className={lbl} htmlFor="lk-pose">Pose</label><select id="lk-pose" className={inp} value={pose} onChange={e => setPose(e.target.value)} disabled={times > 1}>
            <option value="auto">{times > 1 ? 'Uma pose diferente em cada foto' : 'A IA escolhe'}</option>{POSES.map(p => <option key={p} value={p}>{p}</option>)}</select></div>
        </div>
        <p className="text-xs text-gray-500">Tamanho: {IMAGE_FORMAT.look.label}, o padrão da vitrine (cartão do look e capa do computador).</p>
        <button type="button" className={btn} disabled={g.busy || !(provider || connected[0]) || !model || !picked.length}
          onClick={() => {
            const start = Math.floor(Math.random() * POSES.length)
            const poses = times > 1 ? [POSES[start], POSES[(start + 1 + Math.floor(Math.random() * (POSES.length - 1))) % POSES.length]] : [pose === 'auto' ? POSES[start] : pose]
            g.run(poses.map(p => ({ kind: 'look', provider: provider || connected[0], prompt, title, model_image_id: model, scene_image_id: scene, pieces: picked, pose: p })))
          }}>Gerar foto do look</button>
        {!picked.length && <p className="text-xs text-gray-500">Escolha a modelo e ao menos uma peça.</p>}
        <Waiting busy={g.busy} />
        {g.err && <p role="alert" className="rounded-lg bg-negative-100 px-3 py-2 text-sm text-negative-700">{g.err}</p>}
        <Results made={g.last} looks={looks} occasions={occasions} />
      </div>
      <LookGallery images={images.filter(i => i.kind === 'look')} looks={looks} occasions={occasions} />
    </section>
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
            {open === i.id && <ImageActions id={i.id} kind="look" url={i.url} looks={looks} occasions={occasions} />}
          </div>
        ))}
      </div>
    </div>
  )
}

// Publicar uma imagem: criar look na vitrine, capa de look existente, capa da vitrine, excluir
function ImageActions({ id, kind, url, looks, occasions }: { id: string; kind: StudioImage['kind']; url: string; looks: Opt[]; occasions: Opt[] }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [occ, setOcc] = useState('')
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
        <div className="space-y-1.5 rounded-md bg-brand-100/40 p-2">
          <p className="text-[11px] font-medium text-gray-700">Criar look na vitrine com esta foto (já com as peças dela)</p>
          <input className={inp} value={name} onChange={e => setName(e.target.value)} placeholder="Nome do look (ex.: Reunião)" aria-label="Nome do look" />
          {occasions.length > 0 && <select className={inp} value={occ} onChange={e => setOcc(e.target.value)} aria-label="Ocasião"><option value="">Sem ocasião</option>{occasions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select>}
          <button type="button" className={`${btn} w-full`} disabled={busy || !name.trim()} onClick={() => act(() => createLookFromAiImage(id, { name, occasion: occ || null }), 'Look criado e publicado na vitrine.')}>Criar look no site</button>
        </div>
      )}
      {kind === 'look' && looks.length > 0 && (
        <div className="space-y-1.5">
          <select className={inp} value={look} onChange={e => setLook(e.target.value)} aria-label="Look existente"><option value="">Ou trocar a capa de um look…</option>{looks.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
          {look && <button type="button" className={`${btnLine} w-full`} disabled={busy} onClick={() => act(() => publishAiImage(id, { look }), 'Capa do look trocada.')}>Usar como capa deste look</button>}
        </div>
      )}
      <button type="button" className={`${btnLine} w-full`} disabled={busy} onClick={() => act(() => publishAiImage(id, { hero: 'desktop' }), 'Capa da vitrine (computador) trocada.')}>Capa da vitrine (computador)</button>
      <button type="button" className={`${btnLine} w-full`} disabled={busy} onClick={() => act(() => publishAiImage(id, { hero: 'mobile' }), 'Capa da vitrine (celular) trocada.')}>Capa da vitrine (celular)</button>
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
        <div><label className={lbl} htmlFor="sc-place">Lugar</label><select id="sc-place" className={inp} value={place} onChange={e => { setPlace(e.target.value); setCustom(null) }}>{SCENE_PLACES.map(p => <option key={p}>{p}</option>)}</select></div>
        <div><label className={lbl} htmlFor="sc-mood">Clima</label><input id="sc-mood" className={inp} value={mood} onChange={e => { setMood(e.target.value); setCustom(null) }} /></div>
        <div><label className={lbl} htmlFor="sc-extra">Mais algum detalhe (opcional)</label><input id="sc-extra" className={inp} value={extra} onChange={e => { setExtra(e.target.value); setCustom(null) }} /></div>
      </div>
      <div><div className="flex items-baseline justify-between"><label className={lbl} htmlFor="sc-prompt">Pedido para a IA</label>{custom !== null && <button type="button" className="text-xs text-gray-500 underline" onClick={() => setCustom(null)}>Voltar ao texto padrão</button>}</div>
        <textarea id="sc-prompt" className={inp} rows={4} value={prompt} onChange={e => setCustom(e.target.value)} /></div>
      <ProviderPick connected={connected} value={provider || connected[0] || ''} onChange={setProvider} />
      <button type="button" className={btn} disabled={g.busy || !(provider || connected[0])} onClick={() => g.run([{ kind: 'cenario', provider: provider || connected[0], prompt, title: title || place }])}>Criar cenário</button>
      <Waiting busy={g.busy} />
      {g.err && <p role="alert" className="rounded-lg bg-negative-100 px-3 py-2 text-sm text-negative-700">{g.err}</p>}
      <Results made={g.last} />
      <Gallery images={images} />
    </section>
  )
}

function Gallery({ images }: { images: StudioImage[] }) {
  if (!images.length) return null
  return (
    <div className="grid grid-cols-3 gap-2 border-t border-gray-100 pt-3 sm:grid-cols-6">
      {images.map(i => /* eslint-disable-next-line @next/next/no-img-element */ <a key={i.id} href={i.url} target="_blank" rel="noopener noreferrer" className="block"><img src={i.url} alt={i.title ?? ''} loading="lazy" className="aspect-[3/4] w-full rounded-lg bg-gray-100 object-cover" /><span className="block truncate text-[11px] text-gray-600">{i.title}</span></a>)}
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
              {open === i.id && <ImageActions id={i.id} kind={i.kind} url={i.url} looks={looks} occasions={occasions} />}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
