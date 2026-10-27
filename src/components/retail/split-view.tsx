'use client'

// Separar cores e tamanhos: o Drone propõe as linhas; a pessoa confere, ajusta e confirma.

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { splitRetailVariant } from '@/lib/actions/retail-products'
import type { SplitProposal, SplitRow } from '@/lib/retail/split'

export type SplitItem = { id: string; productId: string; code: string; name: string; color: string | null; size: string | null; stock: number; proposal: SplitProposal }

const inp = 'w-full rounded-lg border border-gray-300 px-2 py-1 text-sm focus:border-brand-700 focus:outline-none'

export function SplitView({ items }: { items: SplitItem[] }) {
  const [done, setDone] = useState<string[]>([])
  const [skipped, setSkipped] = useState<string[]>([])
  const open = items.filter(i => !done.includes(i.id) && !skipped.includes(i.id))
  const sure = open.filter(i => i.proposal.sure).length
  if (!items.length) return <p className="rounded-lg bg-positive-100 px-4 py-3 text-sm text-positive-700">Nenhuma linha para separar. Tudo certo.</p>
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-700"><strong>{open.length}</strong> linha(s) para conferir · {sure} com a separação clara · {done.length} separada(s){skipped.length ? ` · ${skipped.length} deixada(s) como está` : ''}.</p>
      {open.map(i => <SplitCard key={i.id} item={i} onDone={() => setDone(d => [...d, i.id])} onSkip={() => setSkipped(s => [...s, i.id])} />)}
      {open.length === 0 && <p className="rounded-lg bg-positive-100 px-4 py-3 text-sm text-positive-700">Pronto. Confira as fotos das peças separadas: a foto marcada com a cor antiga passa a valer para todas as cores (marque a cor certa na peça).</p>}
    </div>
  )
}

function SplitCard({ item, onDone, onSkip }: { item: SplitItem; onDone: () => void; onSkip: () => void }) {
  const router = useRouter()
  const [rows, setRows] = useState<SplitRow[]>(item.proposal.rows)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const total = rows.reduce((t, r) => t + (Number(r.qty) || 0), 0)
  const bad = rows.some(r => (!r.color.trim() && !r.size.trim()) || r.color.includes('/') || r.size.includes('/') || !(Number(r.qty) >= 0))
  const set = (i: number, k: keyof SplitRow, v: string) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, [k]: k === 'qty' ? Math.max(0, Math.floor(Number(v) || 0)) : v } : r)))
  async function go() {
    if (total !== item.stock && !confirm(`O total (${total}) é diferente do estoque atual (${item.stock}). Separar assim mesmo? O histórico do estoque registra a diferença.`)) return
    setBusy(true); setErr(null)
    const r = await splitRetailVariant(item.id, rows)
    setBusy(false)
    if (!r.ok) { setErr(r.error); return }
    onDone(); router.refresh()
  }
  return (
    <div className={`space-y-2 rounded-xl border bg-white p-4 ${item.proposal.sure ? 'border-gray-200' : 'border-warn-700/40'}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-gray-900"><Link href={`/varejo/produtos/${item.productId}`} className="font-semibold hover:underline">{item.name}</Link> <span className="text-gray-500">· {item.code}</span></p>
        <p className="text-xs text-gray-600">Hoje: cor <strong>{item.color ?? '—'}</strong> · tamanho <strong>{item.size ?? '—'}</strong> · {item.stock} un.</p>
      </div>
      {item.proposal.note && <p className="rounded bg-warn-100 px-2 py-1 text-xs text-warn-700">{item.proposal.note}</p>}
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-gray-500"><th className="pb-1 pr-2">Cor</th><th className="pb-1 pr-2">Tamanho</th><th className="w-20 pb-1 pr-2">Qtd.</th><th className="w-8" /></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="py-0.5 pr-2"><input className={inp} value={r.color} onChange={e => set(i, 'color', e.target.value)} aria-label="Cor" /></td>
              <td className="py-0.5 pr-2"><input className={inp} value={r.size} onChange={e => set(i, 'size', e.target.value)} aria-label="Tamanho" /></td>
              <td className="py-0.5 pr-2"><input className={inp} inputMode="numeric" value={String(r.qty)} onChange={e => set(i, 'qty', e.target.value)} aria-label="Quantidade" /></td>
              <td className="py-0.5 text-right"><button type="button" aria-label="Tirar linha" className="px-1 text-gray-500 hover:text-negative-700" onClick={() => setRows(rs => rs.filter((_, j) => j !== i))} disabled={rows.length <= 1}>×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="text-xs text-brand-700 underline" onClick={() => setRows(rs => [...rs, { color: rs[rs.length - 1]?.color ?? '', size: '', qty: 1 }])}>+ linha</button>
        <span className={`text-xs ${total === item.stock ? 'text-gray-600' : 'text-warn-700'}`}>Total: {total} de {item.stock} un.</span>
        <span className="flex-1" />
        <button type="button" className="text-sm text-gray-600 underline" onClick={onSkip}>Deixar como está</button>
        <button type="button" disabled={busy || bad} onClick={go} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">{busy ? 'Separando…' : 'Separar'}</button>
      </div>
      {bad && <p className="text-xs text-warn-700">Cada linha precisa de cor ou tamanho, sem &quot;/&quot;.</p>}
      {err && <p role="alert" className="text-sm text-negative-700">{err}</p>}
    </div>
  )
}
