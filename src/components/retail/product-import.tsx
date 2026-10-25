'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { parseRetailProductFile, importRetailProductsChunk, retailStockForSkus, type ImportMode, type ImportProduct } from '@/lib/actions/retail-products'
import { fmtBRL } from '@/lib/format'

const CHUNK = 10

const MODES: { id: ImportMode; label: string; text: string }[] = [
  { id: 'cadastro', label: 'Atualizar cadastro e preços', text: 'Nome, preço, custo, categoria… O estoque das variações que já existem não muda. Variação nova entra com a quantidade da planilha.' },
  { id: 'entrada', label: 'Entrada de mercadoria (soma)', text: 'Chegou mercadoria: a quantidade da planilha é somada ao estoque atual. Basta código, cor, tamanho e quantidade.' },
  { id: 'contagem', label: 'Contagem de estoque (substitui)', text: 'Depois de contar a loja: o estoque fica igual ao da planilha. Variação que não está na planilha não muda.' },
]
type Line = { code: string; name: string | null; variant: string; before: number | null; after: number }

export function ProductImport() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ products: ImportProduct[]; ignored: string[]; warnings: string[] } | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [result, setResult] = useState<{ created: number; updated: number; errors: string[] } | null>(null)
  const [mode, setMode] = useState<ImportMode>('cadastro')
  const [lines, setLines] = useState<Line[]>([])

  function reset() { setError(null); setPreview(null); setProgress(null); setResult(null); setLines([]) }

  async function read(file: File | undefined) {
    if (!file) return
    reset(); setBusy(true)
    const fd = new FormData(); fd.append('file', file); fd.append('mode', mode)
    const r = await parseRetailProductFile(fd)
    if (!r.ok) { setBusy(false); setError(r.error); return }
    if (!r.products.length) { setBusy(false); setError('Nenhuma peça válida encontrada na planilha.'); return }
    // Antes → depois de cada variação, com o saldo de agora
    const st = await retailStockForSkus(r.products.flatMap(p => p.variants.map(v => v.sku)))
    setBusy(false)
    if (!st.ok) { setError(st.error); return }
    const out: Line[] = []
    for (const p of r.products) for (const v of p.variants) {
      const cur = st.stock[v.sku]
      const before = cur ? cur.stock : null
      const after = before === null ? v.stock : mode === 'entrada' ? before + v.stock : mode === 'contagem' ? v.stock : before
      out.push({ code: p.code, name: p.name, variant: [v.color, v.size].filter(Boolean).join(' / ') || v.sku, before, after })
    }
    setLines(out)
    setPreview({ products: r.products, ignored: r.ignored, warnings: r.warnings })
  }

  async function run() {
    if (!preview) return
    setBusy(true); setError(null)
    const total = { created: 0, updated: 0, errors: [] as string[] }
    for (let i = 0; i < preview.products.length; i += CHUNK) {
      setProgress(`Importando ${Math.min(i + CHUNK, preview.products.length)} de ${preview.products.length}…`)
      const r = await importRetailProductsChunk(preview.products.slice(i, i + CHUNK), mode)
      if (!r.ok) { setError(r.error); break }
      total.created += r.created; total.updated += r.updated; total.errors.push(...r.errors)
    }
    setBusy(false); setProgress(null); setPreview(null); setResult(total)
    router.refresh()
  }

  const changed = lines.filter(l => l.before !== l.after)
  const plus = changed.reduce((s, l) => s + Math.max(0, l.after - (l.before ?? 0)), 0)
  const minus = changed.reduce((s, l) => s + Math.max(0, (l.before ?? 0) - l.after), 0)
  const newVariants = lines.filter(l => l.before === null).length

  return (
    <>
      <button type="button" onClick={() => { setOpen(o => !o); reset() }} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">Importar planilha</button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-4" onClick={() => !busy && setOpen(false)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-gray-900">Importar produtos</h2>
            <p className="mt-1 text-xs text-gray-500">Excel ou CSV, uma linha por cor e tamanho (use a planilha-modelo). Peça com o mesmo código e variação com o mesmo SKU são atualizadas, sem duplicar; nada é apagado; campo vazio mantém o que já está cadastrado. Peça nova sem preço entra em rascunho, com aviso.</p>

            <fieldset className="mt-4 space-y-2" disabled={busy || !!preview}>
              <legend className="mb-1 text-sm font-medium text-gray-800">O que esta planilha faz?</legend>
              {MODES.map(m => (
                <label key={m.id} className={`flex cursor-pointer gap-2 rounded-lg border p-2.5 text-sm ${mode === m.id ? 'border-brand-700 bg-brand-100/40' : 'border-gray-200'}`}>
                  <input type="radio" name="import-mode" className="mt-1" checked={mode === m.id} onChange={() => setMode(m.id)} />
                  <span><span className="block font-medium text-gray-900">{m.label}</span><span className="block text-xs text-gray-600">{m.text}</span></span>
                </label>
              ))}
            </fieldset>

            {!preview && !result && (
              <label className={`mt-4 block cursor-pointer rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-600 hover:bg-gray-50 ${busy ? 'pointer-events-none opacity-50' : ''}`}>
                {busy ? 'Lendo a planilha…' : 'Escolher planilha'}
                <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => { void read(e.target.files?.[0]); e.target.value = '' }} />
              </label>
            )}

            {preview && (
              <div className="mt-4 space-y-3">
                <div className="rounded-lg bg-brand-100 px-3 py-2 text-sm text-brand-800">
                  <p className="font-medium">{MODES.find(m => m.id === mode)?.label}</p>
                  <p>{preview.products.length} peça(s), {lines.length} variação(ões){newVariants ? `, ${newVariants} nova(s)` : ''}.</p>
                  <p>Estoque: {changed.length ? `${changed.length} variação(ões) mudam (+${plus}${minus ? ` / −${minus}` : ''} unidades)` : 'nenhuma variação muda'}.</p>
                </div>
                {changed.length > 0 && (
                  <div>
                    <p className="mb-1 text-xs font-medium text-gray-700">Como o estoque vai ficar</p>
                    <ul className="max-h-48 space-y-0.5 overflow-y-auto rounded-lg border border-gray-100 p-2 text-xs tabular-nums text-gray-700">
                      {changed.slice(0, 200).map((l, i) => (
                        <li key={i} className="flex justify-between gap-2"><span className="min-w-0 truncate"><strong>{l.code}</strong> {l.variant}{l.before === null ? ' (nova)' : ''}</span>
                          <span className="whitespace-nowrap">{l.before ?? 0} → {l.after} <span className={l.after >= (l.before ?? 0) ? 'text-positive-700' : 'text-negative-700'}>({l.after - (l.before ?? 0) >= 0 ? '+' : ''}{l.after - (l.before ?? 0)})</span></span></li>
                      ))}
                      {changed.length > 200 && <li>… e mais {changed.length - 200}.</li>}
                    </ul>
                  </div>
                )}
                <details className="text-xs text-gray-600">
                  <summary className="cursor-pointer">Peças da planilha ({preview.products.length})</summary>
                  <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto">
                    {preview.products.slice(0, 100).map(p => (
                      <li key={p.code}><strong>{p.code}</strong>{p.name ? ` · ${p.name}` : ''} · {p.price === null ? <span className="font-medium text-warn-700">sem preço na planilha</span> : fmtBRL(p.price)} · {p.variants.length} var.</li>
                    ))}
                    {preview.products.length > 100 && <li>… e mais {preview.products.length - 100}.</li>}
                  </ul>
                </details>
                {preview.warnings.length > 0 && (
                  <details open className="rounded-lg bg-warn-100 px-3 py-2 text-xs text-warn-700">
                    <summary className="font-medium">{preview.warnings.length} aviso(s): entram, mas confira</summary>
                    <ul className="mt-1 space-y-0.5">{preview.warnings.map(m => <li key={m}>{m}</li>)}</ul>
                  </details>
                )}
                {preview.ignored.length > 0 && (
                  <details className="rounded-lg bg-warn-100 px-3 py-2 text-xs text-warn-700">
                    <summary>{preview.ignored.length} linha(s) ignorada(s)</summary>
                    <ul className="mt-1 space-y-0.5">{preview.ignored.map(m => <li key={m}>{m}</li>)}</ul>
                  </details>
                )}
                <div className="flex justify-end gap-2">
                  <button type="button" disabled={busy} onClick={reset} className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700">Escolher outra</button>
                  <button type="button" disabled={busy} onClick={run} className="rounded-lg bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">{progress ?? (mode === 'entrada' ? 'Somar ao estoque' : mode === 'contagem' ? 'Substituir o estoque' : 'Importar')}</button>
                </div>
              </div>
            )}

            {result && (
              <div className="mt-4 space-y-2">
                <p className="rounded-lg bg-positive-100 px-3 py-2 text-sm text-positive-700">{result.created} peça(s) criada(s) e {result.updated} atualizada(s). As mudanças de estoque ficam no Histórico do estoque.</p>
                {result.errors.length > 0 && (
                  <ul className="rounded-lg bg-negative-100 px-3 py-2 text-xs text-negative-700">{result.errors.map(m => <li key={m}>{m}</li>)}</ul>
                )}
                <div className="flex justify-end"><button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700">Fechar</button></div>
              </div>
            )}

            {error && <p role="alert" className="mt-3 rounded-lg bg-negative-100 px-3 py-2 text-sm text-negative-700">{error}</p>}
          </div>
        </div>
      )}
    </>
  )
}
