'use client'
// Admin: quais seções da "Apresentação ao Cliente" do Price entram por padrão nas propostas.
// Na montagem de cada proposta ainda dá para excluir ou trazer de volta qualquer seção.
import { useState, useTransition } from 'react'
import { PRICE_SECTIONS } from '@/lib/proposals/price-sections'
import { savePriceSections } from '@/lib/actions/proposal-price-sections'

export function PriceSectionsSettings({ initial }: { initial: string[] | null }) {
  const [on, setOn] = useState<Set<string>>(new Set(initial ?? PRICE_SECTIONS.map(s => s.key)))
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function toggle(k: string) {
    setOn(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n })
    setMsg(null)
  }
  function save() {
    const all = PRICE_SECTIONS.every(s => on.has(s.key))
    start(async () => {
      const r = await savePriceSections(all ? null : PRICE_SECTIONS.filter(s => on.has(s.key)).map(s => s.key))
      setMsg(r.ok ? 'Salvo.' : r.error)
    })
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
      <div>
        <h3 className="text-sm font-medium text-gray-900">Seções do Price na proposta</h3>
        <p className="mt-0.5 text-xs text-gray-500">
          O que da &ldquo;Apresentação ao Cliente&rdquo; do Price entra na proposta, na mesma ordem e com os mesmos valores.
          Na montagem de cada proposta você ainda pode editar, excluir ou trazer de volta qualquer seção.
        </p>
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {PRICE_SECTIONS.map(s => (
          <label key={s.key} className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={on.has(s.key)} onChange={() => toggle(s.key)} />
            {s.label}
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={pending}
          className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-800 disabled:opacity-50">
          {pending ? 'Salvando...' : 'Salvar'}
        </button>
        {msg && <span className="text-xs text-gray-500">{msg}</span>}
      </div>
    </div>
  )
}
