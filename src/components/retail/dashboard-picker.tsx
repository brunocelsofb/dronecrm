'use client'

// Escolher quais blocos aparecem no Painel do Varejo e em que ordem (só o admin)

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { DASHBOARD_BLOCKS, type DashboardBlockId } from '@/lib/retail/dashboard-blocks'
import { saveRetailDashboard } from '@/lib/actions/retail-pricing'

export function DashboardPicker({ current }: { current: DashboardBlockId[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  // ligados na ordem escolhida + desligados no fim
  const [items, setItems] = useState(() => [
    ...current.map(id => ({ id, on: true })),
    ...DASHBOARD_BLOCKS.filter(b => !current.includes(b.id)).map(b => ({ id: b.id as DashboardBlockId, on: false })),
  ])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const info = (id: DashboardBlockId) => DASHBOARD_BLOCKS.find(b => b.id === id)!

  const move = (i: number, d: -1 | 1) => setItems(prev => {
    const j = i + d; if (j < 0 || j >= prev.length) return prev
    const next = [...prev]; [next[i], next[j]] = [next[j], next[i]]; return next
  })

  async function save() {
    setBusy(true); setError(null)
    const r = await saveRetailDashboard(items.filter(i => i.on).map(i => i.id))
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    setOpen(false); router.refresh()
  }

  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">Escolher blocos</button>
  }
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center" role="dialog" aria-modal="true" aria-label="Escolher blocos do painel">
      <div className="flex max-h-[90dvh] w-full max-w-lg flex-col rounded-t-2xl bg-white sm:rounded-2xl">
        <div className="border-b border-gray-100 p-4">
          <h2 className="text-base font-semibold text-gray-900">O que aparece no painel</h2>
          <p className="text-xs text-gray-500">Ligue os blocos que quer ver e use as setas para mudar a ordem. Vale para toda a equipe da loja.</p>
        </div>
        <ul className="min-h-0 flex-1 divide-y divide-gray-100 overflow-y-auto px-4">
          {items.map((it, i) => (
            <li key={it.id} className="flex items-start gap-3 py-3">
              <input type="checkbox" className="mt-1 h-4 w-4" checked={it.on} aria-label={info(it.id).title}
                onChange={e => setItems(prev => prev.map(x => (x.id === it.id ? { ...x, on: e.target.checked } : x)))} />
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium ${it.on ? 'text-gray-900' : 'text-gray-400'}`}>{info(it.id).title}</p>
                <p className="text-xs text-gray-500">{info(it.id).text}</p>
              </div>
              <div className="flex shrink-0 flex-col">
                <button type="button" aria-label="Subir" disabled={i === 0} onClick={() => move(i, -1)} className="px-2 text-gray-600 disabled:opacity-30">↑</button>
                <button type="button" aria-label="Descer" disabled={i === items.length - 1} onClick={() => move(i, 1)} className="px-2 text-gray-600 disabled:opacity-30">↓</button>
              </div>
            </li>
          ))}
        </ul>
        {error && <p role="alert" className="mx-4 rounded-lg bg-negative-100 px-3 py-2 text-sm text-negative-700">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-gray-100 p-4">
          <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700">Cancelar</button>
          <button type="button" onClick={save} disabled={busy} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">{busy ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </div>
    </div>
  )
}
