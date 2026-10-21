'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { parseRetailProductFile, importRetailProductsChunk, type ImportProduct } from '@/lib/actions/retail-products'
import { fmtBRL } from '@/lib/format'

const CHUNK = 10

export function ProductImport() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ products: ImportProduct[]; ignored: string[] } | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [result, setResult] = useState<{ created: number; updated: number; errors: string[] } | null>(null)

  function reset() { setError(null); setPreview(null); setProgress(null); setResult(null) }

  async function read(file: File | undefined) {
    if (!file) return
    reset(); setBusy(true)
    const fd = new FormData(); fd.append('file', file)
    const r = await parseRetailProductFile(fd)
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    if (!r.products.length) { setError('Nenhuma peça válida encontrada na planilha.'); return }
    setPreview({ products: r.products, ignored: r.ignored })
  }

  async function run() {
    if (!preview) return
    setBusy(true); setError(null)
    const total = { created: 0, updated: 0, errors: [] as string[] }
    for (let i = 0; i < preview.products.length; i += CHUNK) {
      setProgress(`Importando ${Math.min(i + CHUNK, preview.products.length)} de ${preview.products.length}…`)
      const r = await importRetailProductsChunk(preview.products.slice(i, i + CHUNK))
      if (!r.ok) { setError(r.error); break }
      total.created += r.created; total.updated += r.updated; total.errors.push(...r.errors)
    }
    setBusy(false); setProgress(null); setPreview(null); setResult(total)
    router.refresh()
  }

  const variants = preview?.products.reduce((s, p) => s + p.variants.length, 0) ?? 0
  const units = preview?.products.reduce((s, p) => s + p.variants.reduce((t, v) => t + v.stock, 0), 0) ?? 0

  return (
    <>
      <button type="button" onClick={() => { setOpen(o => !o); reset() }} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">Importar planilha</button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-4" onClick={() => !busy && setOpen(false)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-gray-900">Importar produtos</h2>
            <p className="mt-1 text-xs text-gray-500">Excel ou CSV, uma linha por cor e tamanho. Use a planilha-modelo para ver as colunas. Peça com o mesmo código e variação com o mesmo SKU são atualizadas; nada é apagado.</p>

            {!preview && !result && (
              <label className={`mt-4 block cursor-pointer rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-600 hover:bg-gray-50 ${busy ? 'pointer-events-none opacity-50' : ''}`}>
                {busy ? 'Lendo a planilha…' : 'Escolher planilha'}
                <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => { void read(e.target.files?.[0]); e.target.value = '' }} />
              </label>
            )}

            {preview && (
              <div className="mt-4 space-y-3">
                <p className="rounded-lg bg-brand-100 px-3 py-2 text-sm text-brand-800">
                  {preview.products.length} peça(s), {variants} variação(ões), {units} unidade(s) em estoque.
                </p>
                <ul className="max-h-48 space-y-1 overflow-y-auto text-xs text-gray-600">
                  {preview.products.slice(0, 50).map(p => (
                    <li key={p.code}><strong>{p.code}</strong> · {p.name} · {fmtBRL(p.price)} · {p.variants.length} var.</li>
                  ))}
                  {preview.products.length > 50 && <li>… e mais {preview.products.length - 50}.</li>}
                </ul>
                {preview.ignored.length > 0 && (
                  <details className="rounded-lg bg-warn-100 px-3 py-2 text-xs text-warn-700">
                    <summary>{preview.ignored.length} linha(s) ignorada(s)</summary>
                    <ul className="mt-1 space-y-0.5">{preview.ignored.map(m => <li key={m}>{m}</li>)}</ul>
                  </details>
                )}
                <div className="flex justify-end gap-2">
                  <button type="button" disabled={busy} onClick={reset} className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700">Escolher outra</button>
                  <button type="button" disabled={busy} onClick={run} className="rounded-lg bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">{progress ?? 'Importar'}</button>
                </div>
              </div>
            )}

            {result && (
              <div className="mt-4 space-y-2">
                <p className="rounded-lg bg-positive-100 px-3 py-2 text-sm text-positive-700">{result.created} peça(s) criada(s) e {result.updated} atualizada(s).</p>
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
