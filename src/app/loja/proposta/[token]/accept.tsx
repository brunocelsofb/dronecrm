'use client'

import { useState } from 'react'
import { startRetailPayment } from '@/lib/actions/retail-proposal'
import { fmtBRL } from '@/lib/format'
import type { ProposalOption } from '@/lib/retail/proposal'

// "Finalizar compra": um botão por forma de pagamento; leva direto para pagar
export function ProposalAccept({ token, brand, options }: { token: string; brand: string; options: ProposalOption[] }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [waiting, setWaiting] = useState<string | null>(null)

  async function pay(id: 'pix' | 'card') {
    setBusy(id); setError(null)
    const r = await startRetailPayment(token, id)
    if (!r.ok) { setBusy(null); setError(r.error); return }
    if (r.url) { window.location.href = r.url; return }
    setBusy(null); setWaiting(r.label)
  }

  if (waiting) {
    return (
      <section className="space-y-2 rounded-2xl bg-white p-5 text-center shadow-sm">
        <p className="text-lg font-semibold text-gray-900">Combinado!</p>
        <p className="text-sm text-gray-600">Você escolheu <strong>{waiting}</strong>. A loja vai te mandar o link de pagamento pelo WhatsApp em instantes.</p>
      </section>
    )
  }

  return (
    <section className="space-y-3 rounded-2xl bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-gray-900">Como você prefere pagar?</p>
      {options.map(o => (
        <button key={o.id} type="button" disabled={!!busy} onClick={() => pay(o.id)}
          className="flex w-full items-center justify-between gap-3 rounded-xl border-2 p-4 text-left disabled:opacity-60"
          style={{ borderColor: brand }}>
          <span>
            <span className="block text-sm font-semibold text-gray-900">{o.id === 'pix' ? 'Pagar com Pix' : 'Pagar no cartão'}</span>
            <span className="block text-xs text-gray-500">{o.installments > 1 ? `até ${o.installments}x de ${fmtBRL(o.installmentValue)}${o.label.includes('sem juros') ? ' sem juros' : ''}` : o.label}</span>
          </span>
          <span className="whitespace-nowrap text-lg font-semibold" style={{ color: brand }}>{busy === o.id ? 'Abrindo…' : fmtBRL(o.grand_total)}</span>
        </button>
      ))}
      {error && <p role="alert" className="rounded-lg bg-negative-100 px-3 py-2 text-sm text-negative-700">{error}</p>}
      <p className="text-center text-xs text-gray-500">Você vai para a página segura de pagamento. Ao terminar, volte para ver a confirmação.</p>
    </section>
  )
}
