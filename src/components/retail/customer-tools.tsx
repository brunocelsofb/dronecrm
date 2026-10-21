'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { parseRetailCustomerFile, importRetailCustomersChunk, saveRetailSettings, type ImportCustomer } from '@/lib/actions/retail-customers'

const CHUNK = 25

export function CustomerImport() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ customers: ImportCustomer[]; ignored: string[] } | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [result, setResult] = useState<{ created: number; updated: number; errors: string[] } | null>(null)
  const reset = () => { setError(null); setPreview(null); setProgress(null); setResult(null) }

  async function read(file: File | undefined) {
    if (!file) return
    reset(); setBusy(true)
    const fd = new FormData(); fd.append('file', file)
    const r = await parseRetailCustomerFile(fd)
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    if (!r.customers.length) { setError('Nenhuma cliente válida na planilha.'); return }
    setPreview({ customers: r.customers, ignored: r.ignored })
  }

  async function run() {
    if (!preview) return
    setBusy(true); setError(null)
    const total = { created: 0, updated: 0, errors: [] as string[] }
    for (let i = 0; i < preview.customers.length; i += CHUNK) {
      setProgress(`Importando ${Math.min(i + CHUNK, preview.customers.length)} de ${preview.customers.length}…`)
      const r = await importRetailCustomersChunk(preview.customers.slice(i, i + CHUNK))
      if (!r.ok) { setError(r.error); break }
      total.created += r.created; total.updated += r.updated; total.errors.push(...r.errors)
    }
    setBusy(false); setProgress(null); setPreview(null); setResult(total)
    router.refresh()
  }

  const withHistory = preview?.customers.filter(c => c.legacy_last_purchase_at).length ?? 0

  return (
    <>
      <button type="button" onClick={() => { setOpen(o => !o); reset() }} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">Importar planilha</button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center sm:p-4" onClick={() => !busy && setOpen(false)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-gray-900">Importar clientes</h2>
            <p className="mt-1 text-xs text-gray-500">Uma linha por cliente. Mesmo telefone atualiza a cliente; nada é apagado. As colunas de última compra, total comprado e quantidade de compras trazem o histórico de antes do CRM.</p>
            {!preview && !result && (
              <label className={`mt-4 block cursor-pointer rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-600 hover:bg-gray-50 ${busy ? 'pointer-events-none opacity-50' : ''}`}>
                {busy ? 'Lendo a planilha…' : 'Escolher planilha'}
                <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => { void read(e.target.files?.[0]); e.target.value = '' }} />
              </label>
            )}
            {preview && (
              <div className="mt-4 space-y-3">
                <p className="rounded-lg bg-brand-100 px-3 py-2 text-sm text-brand-800">{preview.customers.length} cliente(s), {withHistory} com histórico de compra.</p>
                {preview.ignored.length > 0 && (
                  <details className="rounded-lg bg-warn-100 px-3 py-2 text-xs text-warn-700">
                    <summary>{preview.ignored.length} aviso(s)</summary>
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
                <p className="rounded-lg bg-positive-100 px-3 py-2 text-sm text-positive-700">{result.created} cliente(s) criada(s) e {result.updated} atualizada(s).</p>
                {result.errors.length > 0 && <ul className="rounded-lg bg-negative-100 px-3 py-2 text-xs text-negative-700">{result.errors.map(m => <li key={m}>{m}</li>)}</ul>}
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

export function InactiveDaysForm({ initial }: { initial: number }) {
  const router = useRouter()
  const [days, setDays] = useState(String(initial))
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  async function save() {
    setBusy(true); setMsg(null)
    const r = await saveRetailSettings(Number(days))
    setBusy(false)
    setMsg(r.ok ? { ok: true, text: 'Salvo.' } : { ok: false, text: r.error })
    if (r.ok) router.refresh()
  }
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-900">Quando a cliente conta como &quot;sumiu&quot;</h2>
      <p className="mt-1 text-xs text-gray-500">Dias sem comprar (pedido pago, enviado ou entregue, ou a última compra importada). Só o administrador muda.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input inputMode="numeric" value={days} onChange={e => setDays(e.target.value)} className="w-24 rounded-lg border border-gray-300 px-3 py-2 text-sm" aria-label="Dias sem comprar" />
        <span className="text-sm text-gray-600">dias</span>
        <button type="button" onClick={save} disabled={busy} className="rounded-lg bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">Salvar</button>
        {msg && <span className={`text-sm ${msg.ok ? 'text-positive-700' : 'text-negative-700'}`}>{msg.text}</span>}
      </div>
    </section>
  )
}
