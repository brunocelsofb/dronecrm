'use client'
// Painel da licitação · Quem disputou: a equipe registra, a partir da sessão pública, as empresas que
// participaram, a posição e o lance de cada uma (inclusive a nossa). Monta o histórico dos concorrentes.

import { useEffect, useState } from 'react'
import { Swords, Trash2 } from 'lucide-react'
import { fmtBRL } from '@/lib/format'
import { listBids, saveBid, deleteBid, type BidRow } from '@/lib/actions/licitacoes'
import { SupplierDrawer, fmtCnpjView } from './supplier-profile'

const empty = { name: '', cnpj: '', position: '', value: '', is_us: false }

export function BidsPanel({ numero }: { numero: string }) {
  const [bids, setBids] = useState<BidRow[] | null>(null)
  const [own, setOwn] = useState<string[]>([])
  const [f, setF] = useState(empty)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sup, setSup] = useState<{ ni: string; nome: string } | null>(null)

  const load = async () => {
    const r = await listBids(numero)
    if (r.ok) { setBids(r.bids); setOwn(r.own) } else setErr(r.error)
  }
  useEffect(() => {
    let alive = true
    listBids(numero).then(r => { if (!alive) return; if (r.ok) { setBids(r.bids); setOwn(r.own) } else setErr(r.error) })
    return () => { alive = false }
  }, [numero])

  const add = async () => {
    setBusy(true); setErr(null)
    const r = await saveBid(numero, {
      name: f.name, cnpj: f.cnpj || null, is_us: f.is_us,
      position: f.position ? Number(f.position) : null,
      value: f.value ? Number(f.value.replace(/\./g, '').replace(',', '.')) : null,
    })
    setBusy(false)
    if (!r.ok) { setErr(r.error ?? 'Não foi possível.'); return }
    setF(empty); await load()
  }

  return (
    <div className="rounded-xl border border-gray-200 p-4">
      <p className="inline-flex items-center gap-1 text-sm font-semibold text-gray-900"><Swords className="h-4 w-4 text-brand-700" />Quem disputou</p>
      <p className="mt-0.5 text-xs text-gray-500">O PNCP não publica os participantes. Anote aqui quem disputou, a posição e o lance (veja na sessão pública da plataforma). Com o tempo, o CRM monta o histórico de cada concorrente contra vocês.</p>

      {bids && bids.length > 0 && (
        <ul className="mt-2 divide-y divide-gray-100 rounded-xl border border-gray-200 text-xs">
          {bids.map(b => (
            <li key={b.id} className="flex items-center gap-2 px-3 py-1.5">
              <span className="w-8 shrink-0 text-center font-semibold text-gray-600">{b.position ? `${b.position}º` : '—'}</span>
              <span className="min-w-0 flex-1">
                {b.cnpj && !b.is_us
                  ? <button type="button" onClick={() => setSup({ ni: b.cnpj as string, nome: b.name })} className="text-left font-medium text-brand-700 hover:underline">{b.name}</button>
                  : <span className="font-medium text-gray-900">{b.name}</span>}
                {b.is_us && <span className="ml-1 rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700">nós</span>}
                {b.won && <span className="ml-1 rounded bg-positive-100 px-1.5 py-0.5 text-[10px] font-semibold text-positive-700">venceu</span>}
                {b.cnpj && <span className="block text-gray-400">{fmtCnpjView(b.cnpj)}</span>}
              </span>
              <span className="shrink-0 tabular-nums text-gray-700">{b.value !== null ? fmtBRL(b.value) : '—'}</span>
              <button type="button" aria-label="Remover" onClick={async () => { const r = await deleteBid(b.id); if (r.ok) load() }} className="rounded p-1 text-gray-400 hover:text-negative-700"><Trash2 className="h-3.5 w-3.5" /></button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-6">
        <input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="Empresa" aria-label="Empresa" className="col-span-2 rounded-lg border border-gray-300 px-2 py-1 text-xs" />
        <input value={f.cnpj} onChange={e => setF({ ...f, cnpj: e.target.value })} placeholder="CNPJ (opcional)" aria-label="CNPJ" className="col-span-2 rounded-lg border border-gray-300 px-2 py-1 text-xs" />
        <input value={f.position} onChange={e => setF({ ...f, position: e.target.value.replace(/\D/g, '') })} placeholder="Posição" aria-label="Posição" inputMode="numeric" className="rounded-lg border border-gray-300 px-2 py-1 text-xs" />
        <input value={f.value} onChange={e => setF({ ...f, value: e.target.value.replace(/[^\d.,]/g, '') })} placeholder="Lance R$" aria-label="Lance" inputMode="decimal" className="rounded-lg border border-gray-300 px-2 py-1 text-xs" />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1 text-xs text-gray-700">
          <input type="checkbox" checked={f.is_us} onChange={e => setF({ ...f, is_us: e.target.checked, ...(e.target.checked && own[0] && !f.cnpj ? { cnpj: own[0] } : {}) })} />é a nossa empresa
        </label>
        <button type="button" disabled={busy || !f.name.trim()} onClick={add} className="rounded-lg bg-brand-700 px-3 py-1 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50">{busy ? 'Salvando…' : 'Adicionar'}</button>
        <span className="text-[11px] text-gray-400">1º lugar conta como vencedor.</span>
      </div>
      {err && <p className="mt-1 text-xs text-negative-700">{err}</p>}
      {sup && <SupplierDrawer cnpj={sup.ni} name={sup.nome} onClose={() => setSup(null)} />}
    </div>
  )
}
