'use client'

import { useState } from 'react'
import { acceptRetailProposal } from '@/lib/actions/retail-proposal'
import { fmtBRL } from '@/lib/format'
import type { ProposalOption } from '@/lib/retail/proposal'

export function ProposalAccept({ token, brand, options, acceptedChoice }: { token: string; brand: string; options: ProposalOption[]; acceptedChoice: 'pix' | 'card' | null }) {
  const [choice, setChoice] = useState<'pix' | 'card' | null>(acceptedChoice ?? (options.length === 1 ? options[0].id : null))
  const [done, setDone] = useState<{ link: string | null; label: string } | null>(() => {
    const o = options.find(x => x.id === acceptedChoice)
    return o ? { link: o.link, label: o.label } : null
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function accept() {
    if (!choice) return
    setBusy(true); setError(null)
    const r = await acceptRetailProposal(token, choice)
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    setDone({ link: r.link, label: r.label })
  }

  if (done) {
    const o = options.find(x => x.label === done.label) ?? options.find(x => x.id === choice)
    return (
      <section className="space-y-3 rounded-2xl bg-white p-5 text-center shadow-sm">
        <p className="text-lg font-semibold text-gray-900">Combinado!</p>
        <p className="text-sm text-gray-600">Você escolheu <strong>{done.label}</strong>{o ? `: ${o.installments > 1 ? `${o.installments}x de ${fmtBRL(o.installmentValue)}` : fmtBRL(o.grand_total)}` : ''}.</p>
        {done.link ? (
          <a href={done.link} target="_blank" rel="noopener noreferrer" className="block rounded-xl px-4 py-3 text-base font-semibold text-white" style={{ background: brand }}>Pagar agora</a>
        ) : (
          <p className="text-sm text-gray-600">O link de pagamento chega pelo WhatsApp em instantes.</p>
        )}
      </section>
    )
  }

  return (
    <section className="space-y-3 rounded-2xl bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-gray-900">Como você prefere pagar?</p>
      {options.map(o => (
        <label key={o.id} className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border-2 p-4" style={{ borderColor: choice === o.id ? brand : '#e5e7eb' }}>
          <span className="flex items-center gap-3">
            <input type="radio" name="cond" checked={choice === o.id} onChange={() => setChoice(o.id)} className="h-4 w-4" />
            <span><span className="block text-sm font-medium text-gray-900">{o.label}</span><span className="block text-xs text-gray-500">{o.installments > 1 ? `${o.installments}x de ${fmtBRL(o.installmentValue)}` : 'pagamento único'}</span></span>
          </span>
          <span className="text-lg font-semibold" style={{ color: brand }}>{fmtBRL(o.grand_total)}</span>
        </label>
      ))}
      {error && <p role="alert" className="rounded-lg bg-negative-100 px-3 py-2 text-sm text-negative-700">{error}</p>}
      <button type="button" disabled={!choice || busy} onClick={accept} className="w-full rounded-xl px-4 py-3 text-base font-semibold text-white disabled:opacity-50" style={{ background: brand }}>{busy ? 'Confirmando…' : 'Aceitar esta condição'}</button>
    </section>
  )
}
