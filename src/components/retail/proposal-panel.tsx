'use client'

// Pedido do Varejo → link "Finalizar compra": mostra o ganho em cada condição (só a equipe vê),
// gera o link (com o logo da loja) e manda pelo WhatsApp. A cliente escolhe Pix ou cartão e paga.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createRetailProposal } from '@/lib/actions/retail-proposal'
import { fmtBRL, fmtPct } from '@/lib/format'
import { whatsappLink } from '@/lib/retail/customers'

export type ConditionPreview = { id: 'pix' | 'card'; label: string; grand_total: number; installments: number; installmentValue: number; contribution: number; marginPct: number }

export function ProposalPanel({ orderId, previews, targetMargin, url, sentAt, choiceLabel, links, providers, customer, storeName, editable, payment }: {
  orderId: string; previews: ConditionPreview[]; targetMargin: number
  url: string | null; sentAt: string | null; choiceLabel: string | null
  links: { pix: string | null; card: string | null }
  providers: { pix: string; card: string } // 'manual' | 'infinitepay' | 'mercadopago' (rótulo pronto em label)
  customer: { name: string; phone: string | null } | null; storeName: string; editable: boolean
  payment: { paid: boolean; via: string | null; alert: string | null; receiptUrl: string | null }
}) {
  const router = useRouter()
  const [pix, setPix] = useState(links.pix ?? '')
  const [card, setCard] = useState(links.card ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const fmtDT = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

  async function generate() {
    setBusy(true); setError(null)
    const r = await createRetailProposal(orderId, { pix: pix || null, card: card || null })
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    router.refresh()
  }
  const msg = url ? `Oi${customer ? `, ${customer.name.split(' ')[0]}` : ''}! Separei as suas peças aqui na ${storeName}. Para finalizar, é só abrir o link, escolher Pix ou cartão e pagar: ${url}` : ''
  const wa = url && customer ? whatsappLink(customer.phone, msg) : null
  const manualPix = previews.some(o => o.id === 'pix') && providers.pix === 'manual'
  const manualCard = previews.some(o => o.id === 'card') && providers.card === 'manual'
  const label = (p: string) => (p === 'infinitepay' ? 'InfinitePay' : p === 'mercadopago' ? 'Mercado Pago' : 'link manual')
  const tone = (c: number, m: number) => (c < 0 ? 'text-negative-700' : m + 1e-9 < targetMargin ? 'text-warn-700' : 'text-positive-700')

  return (
    <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Link para finalizar a compra</h2>
        <p className="text-xs text-gray-500">A cliente abre, vê as peças com o logo da loja, escolhe Pix ou cartão e paga. Pagou, o pedido vira Pago sozinho (com InfinitePay ou Mercado Pago ligados).</p>
      </div>

      {payment.paid && <p className="rounded-lg bg-positive-100 px-3 py-2 text-sm text-positive-700">Pago{payment.via ? `: ${payment.via}` : ''}.{payment.receiptUrl ? <> <a href={payment.receiptUrl} target="_blank" rel="noopener noreferrer" className="underline">Comprovante</a></> : null}</p>}
      {payment.alert && <p role="alert" className="rounded-lg bg-warn-100 px-3 py-2 text-sm text-warn-700">{payment.alert}</p>}
      {!payment.paid && choiceLabel && <p className="text-xs text-gray-600">A cliente escolheu: <strong>{choiceLabel}</strong>.</p>}

      {previews.length === 0 ? (
        <p className="text-sm text-warn-700">Ligue o Pix ou o cartão em Varejo → Custos e preço.</p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {previews.map(o => (
            <div key={o.id} className="rounded-lg border border-gray-200 p-3">
              <p className="text-sm font-medium text-gray-900">{o.label}</p>
              <p className="text-lg font-semibold text-gray-900">{fmtBRL(o.grand_total)}{o.installments > 1 ? <span className="ml-1 text-xs font-normal text-gray-500">{o.installments}x de {fmtBRL(o.installmentValue)}</span> : null}</p>
              <p className={`text-xs ${tone(o.contribution, o.marginPct)}`}>Você ganha {fmtBRL(o.contribution)} · margem {fmtPct(o.marginPct)}</p>
            </div>
          ))}
        </div>
      )}

      {editable && !payment.paid && previews.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500">
            Pix: <strong>{label(providers.pix)}</strong> · Cartão: <strong>{label(providers.card)}</strong> (muda em Custos e preço).
          </p>
          {(manualPix || manualCard) && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {manualPix && <input value={pix} onChange={e => setPix(e.target.value)} placeholder="Link do Pix (opcional)" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-700 focus:outline-none" />}
              {manualCard && <input value={card} onChange={e => setCard(e.target.value)} placeholder="Link do cartão (opcional)" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-700 focus:outline-none" />}
            </div>
          )}
          {error && <p role="alert" className="rounded-lg bg-negative-100 px-3 py-2 text-sm text-negative-700">{error}</p>}
          <button type="button" onClick={generate} disabled={busy} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">{busy ? 'Gerando…' : url ? 'Atualizar link (pedido mudou)' : 'Gerar link'}</button>
        </div>
      )}

      {url && (
        <div className="space-y-2 rounded-lg bg-gray-50 p-3">
          <p className="text-xs text-gray-500">{sentAt ? `Gerado em ${fmtDT(sentAt)}` : ''}</p>
          <p className="break-all text-sm text-brand-700">{url}</p>
          <div className="flex flex-wrap gap-2">
            {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-brand-700 px-3 py-2 text-sm font-medium text-white">Mandar no WhatsApp</a>}
            <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* sem área de transferência */ } }} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700">{copied ? 'Copiado' : 'Copiar link'}</button>
            <a href={url.replace('/loja/proposta/', '/api/varejo/proposta/')} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700">PDF (se ela pedir)</a>
            <a href={url} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700">Ver como a cliente vê</a>
          </div>
        </div>
      )}
    </section>
  )
}
