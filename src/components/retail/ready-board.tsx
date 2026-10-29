'use client'

// Pronta para vender: uma lista, um botão por peça ("Resolver: o que falta"), sem telas a decorar.

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { setRetailProductStatus } from '@/lib/actions/retail-products'
import type { Step, StepKey } from '@/lib/retail/readiness'

export type ReadyItem = {
  id: string; code: string; name: string; category: string | null; status: string; thumb: string | null; colors: number; stock: number
  steps: Step[]; next: Step | null; ready: boolean; blocking: number; joined: boolean
}

const FILTERS: { key: 'todas' | 'prontas' | StepKey; label: string }[] = [
  { key: 'todas', label: 'Todas' }, { key: 'publicar', label: 'Só falta publicar' }, { key: 'fotos', label: 'Falta foto' },
  { key: 'preco', label: 'Falta preço' }, { key: 'estoque', label: 'Falta estoque' }, { key: 'cadastro', label: 'Cadastro a corrigir' },
  { key: 'modelo', label: 'Falta foto com modelo' }, { key: 'prontas', label: 'Prontas' },
]

// Para onde o "Resolver" leva em cada passo
function resolveHref(i: ReadyItem, key: StepKey): string | null {
  if (key === 'cadastro') return i.joined ? `/varejo/produtos/separar?produto=${i.id}` : '/varejo/produtos/juntar'
  if (key === 'preco') return `/varejo/produtos/${i.id}`
  if (key === 'estoque') return `/varejo/produtos/${i.id}#estoque`
  if (key === 'fotos') return `/varejo/produtos/${i.id}#fotos`
  if (key === 'modelo') return `/varejo/estudio?peca=${i.id}`
  return null
}

export function ReadyBoard({ items, readOnly }: { items: ReadyItem[]; readOnly: boolean }) {
  const router = useRouter()
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('todas')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const ready = items.filter(i => i.ready).length
  const onlyPublish = items.filter(i => !i.ready && i.next?.key === 'publicar').length
  const count = (k: (typeof FILTERS)[number]['key']) => k === 'todas' ? items.length : k === 'prontas' ? ready : items.filter(i => i.next?.key === k && !(k !== 'modelo' && i.ready)).length
  const term = q.trim().toLowerCase()
  const list = useMemo(() => items
    .filter(i => !term || i.name.toLowerCase().includes(term) || i.code.toLowerCase().includes(term))
    .filter(i => filter === 'todas' ? true : filter === 'prontas' ? i.ready : i.next?.key === filter && (filter === 'modelo' || !i.ready))
    .sort((a, b) => Number(a.ready) - Number(b.ready) || a.blocking - b.blocking || a.name.localeCompare(b.name, 'pt-BR')), [items, term, filter])

  async function publish(i: ReadyItem) {
    setBusy(i.id); setErr(null)
    const r = await setRetailProductStatus(i.id, 'publicado')
    setBusy(null)
    if (!r.ok) { setErr(`${i.name}: ${r.error}`); return }
    router.refresh()
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-positive-600/30 bg-positive-100/50 p-3"><p className="text-2xl font-semibold text-positive-700">{ready}</p><p className="text-xs text-gray-700">prontas e no site</p></div>
        <div className="rounded-xl border border-brand-700/30 bg-brand-100/50 p-3"><p className="text-2xl font-semibold text-brand-800">{onlyPublish}</p><p className="text-xs text-gray-700">só falta publicar</p></div>
        <div className="rounded-xl border border-gray-200 bg-white p-3"><p className="text-2xl font-semibold text-gray-900">{items.length - ready - onlyPublish}</p><p className="text-xs text-gray-700">com algo a resolver</p></div>
      </div>
      <input className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-700 focus:outline-none" value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar peça por nome ou código" />
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map(f => { const n = count(f.key); return (n > 0 || f.key === 'todas') && (
          <button key={f.key} type="button" onClick={() => setFilter(f.key)} className={`rounded-full px-3 py-1 text-xs ${filter === f.key ? 'bg-brand-700 text-white' : 'border border-gray-300 bg-white text-gray-700'}`}>{f.label} ({n})</button>
        ) })}
      </div>
      {err && <p role="alert" className="rounded-lg bg-negative-100 px-3 py-2 text-sm text-negative-700">{err}</p>}
      <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
        {list.length === 0 && <li className="p-4 text-sm text-gray-500">Nenhuma peça aqui.</li>}
        {list.map(i => {
          const n = i.next
          const href = n ? resolveHref(i, n.key) : null
          return (
            <li key={i.id} className="flex flex-wrap items-center gap-3 p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {i.thumb ? <img src={i.thumb} alt="" loading="lazy" className="h-14 w-11 shrink-0 rounded object-cover" /> : <span className="flex h-14 w-11 shrink-0 items-center justify-center rounded bg-gray-100 text-[10px] text-gray-400">sem foto</span>}
              <div className="min-w-0 flex-1">
                <Link href={`/varejo/produtos/${i.id}`} className="block truncate text-sm font-medium text-gray-900 hover:underline">{i.name}</Link>
                <p className="text-xs text-gray-500">{i.code}{i.colors > 1 ? ` · ${i.colors} cores` : ''} · {i.stock} un.</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {i.steps.map(s => (
                    <span key={s.key} title={s.detail ?? 'ok'} className={`rounded-full px-1.5 py-0.5 text-[10px] ${s.ok ? 'bg-positive-100 text-positive-700' : s.required ? 'bg-warn-100 text-warn-700' : 'bg-gray-100 text-gray-600'}`}>{s.ok ? '✓' : '•'} {s.label}</span>
                  ))}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                {i.ready && n?.key !== 'modelo' ? <span className="rounded-full bg-positive-100 px-2 py-1 text-xs font-medium text-positive-700">Pronta</span>
                  : n?.key === 'publicar' ? (
                    <button type="button" disabled={readOnly || busy === i.id} onClick={() => publish(i)} className="rounded-lg bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">{busy === i.id ? 'Publicando…' : 'Publicar'}</button>
                  ) : n && href ? (
                    <Link href={href} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${n.required ? 'bg-brand-700 text-white hover:bg-brand-800' : 'border border-brand-700 text-brand-700 hover:bg-brand-100'}`}>{n.required ? 'Resolver' : 'Fazer'}: {n.label}</Link>
                  ) : null}
                {n?.detail && !(i.ready && n.key !== 'modelo') && <span className="max-w-[16rem] text-right text-[11px] text-gray-500">{n.detail}</span>}
                {i.ready && n?.key === 'modelo' && <span className="text-[11px] text-positive-700">Pronta · foto com modelo é opcional</span>}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
