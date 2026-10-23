'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateRetailOrderStatus, updateRetailOrderPayment } from '@/lib/actions/retail-orders'
import { ORDER_STATUSES, PAYMENT_METHODS } from '@/lib/retail/customers'

type O = { id: string; status: string; discount: number; shipping: number; payment_method: string | null; payment_condition: string | null; payment_link: string | null; notes: string | null }

const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-700 focus:outline-none'
const lbl = 'mb-1 block text-xs font-medium text-gray-600'
const money = (n: number) => (n ? n.toFixed(2).replace('.', ',') : '')

// Próximos passos possíveis a partir da situação atual
const NEXT: Record<string, string[]> = {
  carrinho: ['enviado_atendimento', 'aguardando_pagamento', 'pago', 'cancelado'],
  enviado_atendimento: ['aguardando_pagamento', 'pago', 'cancelado'],
  aguardando_pagamento: ['pago', 'cancelado'],
  pago: ['enviado', 'entregue', 'cancelado'],
  enviado: ['entregue', 'cancelado'],
  entregue: ['cancelado'],
  cancelado: [],
}

export function OrderPanel({ order, message, whatsappUrl }: { order: O; message: string; whatsappUrl: string | null }) {
  const router = useRouter()
  const [f, setF] = useState({
    discount: money(order.discount), shipping: money(order.shipping), payment_method: order.payment_method ?? 'pix',
    payment_condition: order.payment_condition ?? '', payment_link: order.payment_link ?? '', notes: order.notes ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF(p => ({ ...p, [k]: e.target.value }))
  const cancelled = order.status === 'cancelado'

  async function changeStatus(s: string) {
    if (s === 'cancelado' && !confirm('Cancelar o pedido? Se o estoque já foi baixado, ele volta.')) return
    setBusy(true); setMsg(null)
    const r = await updateRetailOrderStatus(order.id, s)
    setBusy(false)
    if (!r.ok) { setMsg({ ok: false, text: r.error }); return }
    router.refresh()
  }

  async function savePayment() {
    setBusy(true); setMsg(null)
    const r = await updateRetailOrderPayment(order.id, f)
    setBusy(false)
    if (!r.ok) { setMsg({ ok: false, text: r.error }); return }
    setMsg({ ok: true, text: 'Salvo. A mensagem abaixo já usa os valores novos.' }); router.refresh()
  }

  async function copy() {
    try { await navigator.clipboard.writeText(message); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { setMsg({ ok: false, text: 'Não foi possível copiar. Selecione o texto e copie.' }) }
  }

  return (
    <div className="space-y-4">
      {!cancelled && (
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-900">Mudar situação</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {NEXT[order.status]?.map(s => (
              <button key={s} type="button" disabled={busy} onClick={() => changeStatus(s)}
                className={`rounded-lg px-3 py-2 text-sm disabled:opacity-50 ${s === 'cancelado' ? 'border border-negative-600/40 text-negative-700' : 'bg-brand-700 font-medium text-white hover:bg-brand-800'}`}>
                {ORDER_STATUSES.find(x => x.id === s)?.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-gray-500">Ao marcar Pago (ou Enviado/Entregue) o estoque das peças baixa. Cancelar depois devolve o estoque.</p>
        </section>
      )}

      <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">Cobrança</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label className={lbl}>Forma de pagamento</label>
            <select className={inp} value={f.payment_method} onChange={set('payment_method')} disabled={cancelled}>{PAYMENT_METHODS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></div>
          <div><label className={lbl}>Condição</label><input className={inp} value={f.payment_condition} onChange={set('payment_condition')} disabled={cancelled} placeholder="ex.: 5% no Pix" /></div>
          <div><label className={lbl}>Desconto (R$)</label><input className={inp} inputMode="decimal" value={f.discount} onChange={set('discount')} disabled={cancelled} /></div>
          <div><label className={lbl}>Frete (R$)</label><input className={inp} inputMode="decimal" value={f.shipping} onChange={set('shipping')} disabled={cancelled} /></div>
          <div className="sm:col-span-2"><label className={lbl}>Link de pagamento</label><input className={inp} value={f.payment_link} onChange={set('payment_link')} disabled={cancelled} placeholder="cole aqui o link gerado no banco ou na maquininha" /></div>
        </div>
        <div><label className={lbl}>Observações</label><textarea className={inp} rows={2} value={f.notes} onChange={set('notes')} disabled={cancelled} /></div>
        {!cancelled && <div className="flex justify-end"><button type="button" onClick={savePayment} disabled={busy} className="rounded-lg bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">Salvar cobrança</button></div>}
      </section>

      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? 'bg-positive-100 text-positive-700' : 'bg-negative-100 text-negative-700'}`}>{msg.text}</p>}

      <section className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">Mensagem para a cliente</h2>
        <pre className="whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-xs text-gray-800">{message}</pre>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={copy} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">{copied ? 'Copiada' : 'Copiar mensagem'}</button>
          {whatsappUrl && <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">Abrir no WhatsApp</a>}
        </div>
        <p className="text-xs text-gray-500">Salve a cobrança antes de enviar, para a mensagem sair com o valor e o link certos.</p>
      </section>
    </div>
  )
}
