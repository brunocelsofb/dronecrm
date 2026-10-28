'use client'

// Somar peças (entrada) ou contar o estoque: à mão (busca + "+1") ou com leitor de código de barras.
// O leitor funciona como teclado: digita o código e aperta Enter, então o mesmo campo serve para os dois.
// Nada muda no estoque até "Lançar"; aí vai tudo de uma vez para o Histórico do estoque.

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { applyRetailScan, linkRetailBarcode } from '@/lib/actions/retail-products'
import { findByCode, normalizeBarcode, scanChanges } from '@/lib/retail/scan'

export type CountVariant = { id: string; sku: string; barcode: string | null; color: string | null; size: string | null; stock: number; code: string; name: string; category: string | null }
type Mode = 'entrada' | 'contagem'
const KEY = 'drone-varejo-contagem'
const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-700 focus:outline-none'
const label = (v: CountVariant) => [v.color, v.size].filter(Boolean).join(' · ') || 'Única'
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// Bip curto (ok) ou grave (não achou), sem arquivo de som
function beep(ok: boolean) {
  try {
    const W = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }
    const Ctx = W.AudioContext ?? W.webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx(), o = ctx.createOscillator(), g = ctx.createGain()
    o.frequency.value = ok ? 1200 : 300; g.gain.value = 0.08
    o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + (ok ? 0.08 : 0.25))
    setTimeout(() => void ctx.close(), 400)
  } catch { /* sem som: segue */ }
}

export function ScanCount({ variants }: { variants: CountVariant[] }) {
  const router = useRouter()
  const box = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<Mode>('entrada')
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [order, setOrder] = useState<string[]>([])
  const [text, setText] = useState('')
  const [pending, setPending] = useState<string | null>(null) // código lido que ainda não está ligado a nenhuma peça
  const [linkQ, setLinkQ] = useState('')
  const [last, setLast] = useState<{ ok: boolean; text: string } | null>(null)
  const [category, setCategory] = useState('')
  const [zeroMissing, setZeroMissing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [codes, setCodes] = useState<Record<string, string>>({}) // códigos ligados nesta tela (antes do refresh)
  const list = useMemo(() => variants.map(v => (codes[v.id] ? { ...v, barcode: codes[v.id] } : v)), [variants, codes])
  const byId = useMemo(() => new Map(list.map(v => [v.id, v])), [list])
  const categories = useMemo(() => [...new Set(variants.map(v => v.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [variants])

  function save(c: Record<string, number>, o: string[], m: Mode) {
    try { localStorage.setItem(KEY, JSON.stringify({ counts: c, order: o, mode: m })) } catch { /* sem armazenamento: segue */ }
  }
  function restore() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { counts: Record<string, number>; order: string[]; mode: Mode } | null
      if (!s || !Object.keys(s.counts ?? {}).length) { setMsg({ ok: false, text: 'Não há contagem guardada neste aparelho.' }); return }
      const c = Object.fromEntries(Object.entries(s.counts).filter(([id]) => byId.has(id)))
      setCounts(c); setOrder((s.order ?? []).filter(id => id in c)); setMode(s.mode === 'contagem' ? 'contagem' : 'entrada'); setMsg(null)
    } catch { setMsg({ ok: false, text: 'Não consegui recuperar.' }) }
  }
  function add(id: string, n = 1) {
    const v = byId.get(id); if (!v) return
    const c = { ...counts, [id]: Math.max(0, (counts[id] ?? 0) + n) }
    const o = [id, ...order.filter(x => x !== id)]
    setCounts(c); setOrder(o); save(c, o, mode)
    setLast({ ok: true, text: `+${n} ${v.name} · ${label(v)} (agora ${c[id]})` })
  }
  function setQty(id: string, n: number) {
    const c = { ...counts, [id]: Math.max(0, Math.floor(n) || 0) }
    setCounts(c); save(c, order, mode)
  }
  function remove(id: string) {
    const c = { ...counts }; delete c[id]
    const o = order.filter(x => x !== id)
    setCounts(c); setOrder(o); save(c, o, mode)
  }
  // Enter no campo: código/SKU conhecido soma 1; número desconhecido pede para ligar; texto vira busca
  function enter() {
    const raw = text.trim(); if (!raw) return
    const hit = findByCode(list, raw)
    if (hit) { add(hit.id); beep(true); setText(''); return }
    if (/^[0-9A-Z-]{6,}$/i.test(raw.replace(/\s+/g, '')) && /\d{4,}/.test(raw)) {
      beep(false); setPending(normalizeBarcode(raw)); setLinkQ(''); setText('')
      setLast({ ok: false, text: `Código ${normalizeBarcode(raw)} ainda não está ligado a nenhuma peça.` })
    }
  }
  async function linkAndAdd(v: CountVariant) {
    if (!pending) return
    setBusy(true)
    const r = await linkRetailBarcode(v.id, pending)
    setBusy(false)
    if (!r.ok) { setLast({ ok: false, text: r.error }); return }
    setCodes(c => ({ ...c, [v.id]: pending })); add(v.id); setPending(null); beep(true)
    box.current?.focus()
  }

  const q = norm(text.trim())
  const results = q.length >= 2 && !findByCode(list, text) ? list.filter(v => norm(`${v.name} ${v.code} ${v.sku} ${v.color ?? ''}`).includes(q)).slice(0, 30) : []
  const lq = norm(linkQ.trim())
  const linkResults = pending && lq.length >= 2 ? list.filter(v => norm(`${v.name} ${v.code} ${v.sku} ${v.color ?? ''}`).includes(lq)).slice(0, 20) : []
  const changes = scanChanges(mode, counts, list, mode === 'contagem' && zeroMissing ? { category: category || null, zeroMissing: true } : {})
  const zeroed = changes.filter(c => counts[c.variant_id] === undefined)
  const pieces = Object.values(counts).reduce((t, n) => t + n, 0)

  async function launch() {
    if (!changes.length) { setMsg({ ok: false, text: mode === 'entrada' ? 'Some ao menos uma peça.' : 'Nada muda: a contagem bate com o estoque.' }); return }
    const txt = mode === 'entrada'
      ? `Somar ${pieces} peça(s) ao estoque (${changes.length} cor/tamanho)?`
      : `Lançar a contagem? ${changes.length} cor/tamanho mudam${zeroed.length ? `, sendo ${zeroed.length} zerada(s) por não terem sido contadas` : ''}.`
    if (!confirm(txt)) return
    setBusy(true); setMsg(null)
    const r = await applyRetailScan(mode, changes.map(c => ({ variant_id: c.variant_id, mode: c.mode, qty: c.qty })))
    setBusy(false)
    if (!r.ok) { setMsg({ ok: false, text: r.error }); return }
    setCounts({}); setOrder([]); try { localStorage.removeItem(KEY) } catch { /* ok */ }
    setMsg({ ok: true, text: `Lançado: ${r.changed} cor/tamanho atualizada(s). Está no Histórico do estoque.` })
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="O que fazer">
        {([['entrada', 'Somar ao estoque (chegou mercadoria)'], ['contagem', 'Contagem (o estoque fica igual ao contado)']] as [Mode, string][]).map(([m, l]) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => { setMode(m); save(counts, order, m) }} className={`rounded-full px-4 py-1.5 text-sm ${mode === m ? 'bg-brand-700 text-white' : 'border border-gray-300 bg-white text-gray-700'}`}>{l}</button>
        ))}
      </div>

      <section className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
        <label htmlFor="scan" className="block text-sm font-medium text-gray-900">Bipe a etiqueta ou digite o nome/código da peça</label>
        <input id="scan" ref={box} autoFocus autoComplete="off" className={`${inp} text-base`} value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); enter() } }} placeholder="ex.: 7891234567890 ou calça paris" />
        <p className="text-xs text-gray-500">Com leitor (USB ou Bluetooth): clique aqui e bipe; cada bip soma 1. Sem leitor: digite e toque em +1 na peça.</p>
        {last && <p role="status" className={`rounded-lg px-3 py-2 text-sm ${last.ok ? 'bg-positive-100 text-positive-700' : 'bg-warn-100 text-warn-700'}`}>{last.text}</p>}
        {results.length > 0 && (
          <ul className="max-h-72 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-100">
            {results.map(v => (
              <li key={v.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                <span className="min-w-0 flex-1 truncate"><strong>{v.name}</strong> · {label(v)} <span className="text-xs text-gray-500">{v.code} · estoque {v.stock}{counts[v.id] ? ` · contadas ${counts[v.id]}` : ''}</span></span>
                <button type="button" className="rounded-lg bg-brand-700 px-3 py-1 text-sm font-medium text-white hover:bg-brand-800" onClick={() => { add(v.id); box.current?.focus() }}>+1</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {pending && (
        <section className="space-y-2 rounded-xl border border-warn-700/40 bg-warn-100/60 p-4">
          <p className="text-sm font-medium text-gray-900">Código novo: <span className="font-mono">{pending}</span></p>
          <p className="text-xs text-gray-700">Diga de qual peça, cor e tamanho é esta etiqueta. É só uma vez: nas próximas leituras o Drone já reconhece.</p>
          <input className={inp} autoFocus value={linkQ} onChange={e => setLinkQ(e.target.value)} placeholder="Buscar a peça (nome ou código)" />
          {linkResults.length > 0 && (
            <ul className="max-h-60 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-100 bg-white">
              {linkResults.map(v => (
                <li key={v.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                  <span className="min-w-0 flex-1 truncate"><strong>{v.name}</strong> · {label(v)} <span className="text-xs text-gray-500">{v.code}{v.barcode ? ' · já tem código' : ''}</span></span>
                  <button type="button" disabled={busy} className="rounded-lg bg-brand-700 px-3 py-1 text-xs font-medium text-white hover:bg-brand-800 disabled:opacity-50" onClick={() => linkAndAdd(v)}>Ligar e somar 1</button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="text-xs text-gray-600 underline" onClick={() => { setPending(null); box.current?.focus() }}>Ignorar esta leitura</button>
        </section>
      )}

      <section className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-900">{mode === 'entrada' ? 'Peças para somar' : 'Peças contadas'} ({pieces} un.)</h2>
          {!order.length && <button type="button" className="text-xs text-brand-700 underline" onClick={restore}>Recuperar a última contagem não lançada</button>}
        </div>
        {!order.length ? <p className="text-sm text-gray-500">Nada ainda. Bipe ou busque a primeira peça.</p> : (
          <ul className="divide-y divide-gray-100">
            {order.map(id => {
              const v = byId.get(id); if (!v) return null
              const n = counts[id] ?? 0
              const after = mode === 'entrada' ? v.stock + n : n
              return (
                <li key={id} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
                  <span className="min-w-0 flex-1"><strong>{v.name}</strong> · {label(v)} <span className="text-xs text-gray-500">{v.code}</span></span>
                  <span className="tabular-nums text-xs text-gray-600">estoque {v.stock} → <strong className={after < v.stock ? 'text-negative-700' : 'text-gray-900'}>{after}</strong></span>
                  <span className="flex items-center gap-1">
                    <button type="button" aria-label="Menos 1" className="h-7 w-7 rounded border border-gray-300" onClick={() => add(id, -1)}>−</button>
                    <input className="w-14 rounded border border-gray-300 px-1 py-0.5 text-center tabular-nums" inputMode="numeric" value={n} onChange={e => setQty(id, Number(e.target.value))} aria-label="Quantidade" />
                    <button type="button" aria-label="Mais 1" className="h-7 w-7 rounded border border-gray-300" onClick={() => add(id, 1)}>+</button>
                    <button type="button" aria-label="Tirar" className="px-1 text-gray-500 hover:text-negative-700" onClick={() => remove(id)}>×</button>
                  </span>
                </li>
              )
            })}
          </ul>
        )}
        {mode === 'contagem' && (
          <div className="space-y-1 rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
            <p>Só as peças contadas mudam. Para contar uma parte da loja e zerar o que não apareceu:</p>
            <div className="flex flex-wrap items-center gap-2">
              <select className="rounded-lg border border-gray-300 px-2 py-1 text-sm" value={category} onChange={e => setCategory(e.target.value)} aria-label="Parte da loja">
                <option value="">Loja inteira</option>{categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={zeroMissing} onChange={e => setZeroMissing(e.target.checked)} />Zerar o que {category ? `é de ${category} e ` : ''}não foi contado</label>
            </div>
            {zeroMissing && <p className="text-xs text-warn-700">{zeroed.length} cor/tamanho ficarão com estoque 0 (estão no sistema e não foram contados).</p>}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button type="button" disabled={busy || !changes.length} onClick={launch} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">{busy ? 'Lançando…' : mode === 'entrada' ? `Lançar entrada (${pieces} un.)` : `Lançar contagem (${changes.length} mudança(s))`}</button>
          {order.length > 0 && <button type="button" className="text-sm text-gray-600 underline" onClick={() => { if (confirm('Limpar a lista sem lançar?')) { setCounts({}); setOrder([]); try { localStorage.removeItem(KEY) } catch { /* ok */ } } }}>Limpar</button>}
        </div>
        {msg && <p role={msg.ok ? 'status' : 'alert'} className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? 'bg-positive-100 text-positive-700' : 'bg-negative-100 text-negative-700'}`}>{msg.text}</p>}
      </section>
    </div>
  )
}
