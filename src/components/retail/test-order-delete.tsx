'use client'

// Excluir pedido de teste (admin da loja ou Super Admin com acesso liberado)
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { deleteRetailTestOrder, retailTestOrderInfo } from '@/lib/actions/retail-test-orders'

export function TestOrderDelete({ orderId, support }: { orderId: string; support: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [info, setInfo] = useState<{ number: number; customerName: string | null; customerRemovable: boolean } | null>(null)
  const [removeCustomer, setRemoveCustomer] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function start() {
    setBusy(true); setErr(null)
    const r = await retailTestOrderInfo(orderId)
    setBusy(false)
    if (!r.ok) { setErr(r.error); return }
    setInfo(r); setRemoveCustomer(r.customerRemovable); setOpen(true)
  }
  async function confirmDelete() {
    setBusy(true); setErr(null)
    const r = await deleteRetailTestOrder(orderId, { removeCustomer })
    setBusy(false)
    if (!r.ok) { setErr(r.error); return }
    router.replace('/varejo/pedidos'); router.refresh()
  }

  return (
    <section className="space-y-2 rounded-xl border border-negative-600/30 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-900">Pedido de teste?</h2>
      <p className="text-xs text-gray-500">Apaga o pedido de vez para não entrar nos números da loja: devolve o estoque, desfaz a fidelidade e tira do funil, dos pedidos e dos relatórios. Só para pedidos de teste; venda de verdade que não deu certo, use Cancelar.{support ? ' No acesso de suporte, a exclusão fica registrada no histórico de acessos da empresa.' : ''}</p>
      {!open ? (
        <button type="button" onClick={start} disabled={busy} className="rounded-lg border border-negative-600/40 px-3 py-2 text-sm text-negative-700 hover:bg-negative-100 disabled:opacity-50">Excluir pedido de teste</button>
      ) : info && (
        <div className="space-y-3 rounded-lg bg-negative-100/50 p-3">
          <p className="text-sm text-gray-800">Excluir o pedido nº {info.number}{info.customerName ? ` de ${info.customerName}` : ''}? Não dá para desfazer.</p>
          {info.customerRemovable && (
            <label className="flex items-start gap-2 text-sm text-gray-700"><input type="checkbox" className="mt-1" checked={removeCustomer} onChange={e => setRemoveCustomer(e.target.checked)} /> Excluir também a cliente {info.customerName} (ela não tem outros pedidos nem histórico).</label>
          )}
          <label className="block text-xs text-gray-600">Para confirmar, digite o número do pedido
            <input className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" inputMode="numeric" value={typed} onChange={e => setTyped(e.target.value)} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={confirmDelete} disabled={busy || typed.trim() !== String(info.number)} className="rounded-lg bg-negative-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Excluindo…' : 'Excluir de vez'}</button>
            <button type="button" onClick={() => { setOpen(false); setTyped('') }} disabled={busy} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700">Voltar</button>
          </div>
        </div>
      )}
      {err && <p role="alert" className="rounded-lg bg-negative-100 px-3 py-2 text-xs text-negative-700">{err}</p>}
    </section>
  )
}
