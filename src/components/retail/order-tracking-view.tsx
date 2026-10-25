// Página do pedido para a cliente: só apresentação (dados prontos vêm da página)
import { fmtBRL } from '@/lib/format'
import { PAYMENT_METHODS } from '@/lib/retail/customers'
import { PUBLIC_EVENT_LABELS, STEP_ORDER, cleanTrackingUrl } from '@/lib/retail/order-messages'
import type { StorefrontPolicy, StorefrontTheme } from '@/lib/retail/storefront'

export type TrackingOrder = {
  number: number; status: string; created_at: string
  subtotal: number; discount: number; loyalty_discount: number; shipping: number; total: number
  payment_method: string | null; payment_condition: string | null; proposal_token: string | null
  tracking_carrier: string | null; tracking_code: string | null; tracking_url: string | null
  retail_customers: { name: string } | null
  retail_order_items: { name: string; color: string | null; size: string | null; qty: number; unit_price: number; total: number }[]
}
const fmtDT = (d: string) => new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export function OrderTrackingView({ o, events, store, logoUrl, theme, policies, wa }: {
  o: TrackingOrder; events: { kind: string; created_at: string }[]; store: string; logoUrl: string | null
  theme: StorefrontTheme; policies: StorefrontPolicy[]; wa: string | null
}) {
  const n = (v: unknown) => Number(v ?? 0)
  const evs = events
  // Data de cada etapa (a primeira vez que aconteceu; o link vale o mais recente)
  const when: Record<string, string> = {}
  for (const e of evs) if (!when[e.kind] || e.kind === 'link') when[e.kind] = e.created_at
  if (!when.recebido) when.recebido = o.created_at
  const cancelled = o.status === 'cancelado'
  const reachedIdx = Math.max(...STEP_ORDER.map((k, i) => (when[k] ? i : -1)))
  const steps = STEP_ORDER.filter(k => k !== 'link' || when.link || !when.pago)
  const awaiting = ['carrinho', 'enviado_atendimento', 'aguardando_pagamento'].includes(o.status)
  const current = cancelled ? 'Pedido cancelado' : PUBLIC_EVENT_LABELS[STEP_ORDER[Math.max(0, reachedIdx)]]
  const trackUrl = cleanTrackingUrl(o.tracking_url)
  const payLabel = [PAYMENT_METHODS.find(p => p.id === o.payment_method)?.label, o.payment_condition].filter(Boolean).join(' · ')

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-6">
      <div className="mx-auto max-w-lg space-y-4">
        <header className="flex items-center justify-between gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {logoUrl ? <img src={logoUrl} alt={store} className="h-10 w-auto max-w-[160px] object-contain" /> : <span className="text-lg font-semibold" style={{ color: theme.primary }}>{store}</span>}
          <span className="text-right text-xs text-gray-500">Pedido nº {o.number}<br />feito em {fmtDT(o.created_at).slice(0, 10)}</span>
        </header>

        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-sm text-gray-500">Olá{o.retail_customers?.name ? `, ${o.retail_customers.name.split(' ')[0]}` : ''}! Este é o andamento do seu pedido.</p>
          <p className="mt-1 text-lg font-semibold" style={{ color: theme.primary }}>{current}</p>
          {cancelled ? (
            <p className="mt-3 text-sm text-gray-600">Este pedido foi cancelado. Se tiver dúvida, fale com a loja.</p>
          ) : (
            <ol className="mt-4">
              {steps.map((k, i) => {
                const done = !!when[k] && STEP_ORDER.indexOf(k) <= reachedIdx
                const isCur = STEP_ORDER.indexOf(k) === reachedIdx
                return (
                  <li key={k} className="relative grid grid-cols-[20px_1fr] gap-3 pb-4 last:pb-0">
                    {i < steps.length - 1 && <span aria-hidden className="absolute left-[9px] top-4 bottom-0 w-px bg-gray-200" />}
                    <span aria-hidden className="relative z-10 mt-1 h-3 w-3 justify-self-center rounded-full" style={{ background: done ? (isCur ? theme.primary : theme.accent) : '#E5E7EB', boxShadow: isCur ? `0 0 0 3px #fff, 0 0 0 4px ${theme.primary}` : undefined }} />
                    <span>
                      <span className={`block text-sm ${done ? 'font-medium text-gray-900' : 'text-gray-400'}`}>{PUBLIC_EVENT_LABELS[k]}</span>
                      {done && when[k] && <span className="block text-xs text-gray-500">{fmtDT(when[k])}</span>}
                      {k === 'enviado' && done && (o.tracking_carrier || o.tracking_code) && <span className="block text-xs text-gray-600">{[o.tracking_carrier, o.tracking_code].filter(Boolean).join(' · ')}</span>}
                    </span>
                  </li>
                )
              })}
            </ol>
          )}
        </section>

        {!cancelled && (o.tracking_carrier || o.tracking_code) && (
          <section className="rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900">Rastreio</h2>
            <p className="mt-1 text-sm text-gray-700">{o.tracking_carrier ?? 'Envio'}{o.tracking_code ? <> · <span className="select-all font-mono">{o.tracking_code}</span></> : null}</p>
            {trackUrl && <a href={trackUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block rounded-lg px-4 py-2 text-sm font-medium text-white" style={{ background: theme.primary }}>Acompanhar a entrega</a>}
          </section>
        )}

        {awaiting && o.proposal_token && (
          <a href={`/loja/proposta/${o.proposal_token}`} className="block rounded-2xl px-5 py-4 text-center text-sm font-semibold text-white shadow-sm" style={{ background: theme.primary }}>Pagar agora (Pix ou cartão)</a>
        )}

        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900">Suas peças e a conta</h2>
          <ul className="mt-2 divide-y divide-gray-100">
            {o.retail_order_items.map((it, i) => (
              <li key={i} className="flex justify-between gap-3 py-2.5 text-sm">
                <span className="min-w-0"><span className="block font-medium text-gray-900">{it.name}</span><span className="block text-xs text-gray-500">{[[it.color, it.size].filter(Boolean).join(' / '), `${it.qty} × ${fmtBRL(n(it.unit_price))}`].filter(Boolean).join(' · ')}</span></span>
                <span className="whitespace-nowrap text-gray-900">{fmtBRL(n(it.total))}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-2 space-y-1 border-t border-gray-100 pt-2 text-sm tabular-nums">
            <div className="flex justify-between text-gray-600"><dt>Subtotal</dt><dd>{fmtBRL(n(o.subtotal))}</dd></div>
            {n(o.discount) > 0 && <div className="flex justify-between text-gray-600"><dt>Desconto{o.payment_condition ? ` (${o.payment_condition})` : ''}</dt><dd>− {fmtBRL(n(o.discount))}</dd></div>}
            {n(o.loyalty_discount) > 0 && <div className="flex justify-between text-gray-600"><dt>Fidelidade</dt><dd>− {fmtBRL(n(o.loyalty_discount))}</dd></div>}
            <div className="flex justify-between text-gray-600"><dt>Frete</dt><dd>{n(o.shipping) > 0 ? fmtBRL(n(o.shipping)) : 'sem frete ou a combinar'}</dd></div>
            <div className="flex justify-between font-semibold text-gray-900"><dt>Total</dt><dd>{fmtBRL(n(o.total))}</dd></div>
            {payLabel && !awaiting && <p className="text-xs text-gray-500">Pagamento: {payLabel}</p>}
          </dl>
        </section>

        {policies.length > 0 && (
          <section className="rounded-2xl bg-white p-5 shadow-sm">
            {policies.map((p, i) => (
              <details key={i} className="border-b border-gray-100 py-2 last:border-0">
                <summary className="cursor-pointer text-sm font-medium text-gray-900">{p.title}</summary>
                <p className="mt-2 whitespace-pre-line text-sm text-gray-600">{p.text}</p>
              </details>
            ))}
          </section>
        )}

        {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="block rounded-2xl bg-positive-600 px-5 py-3 text-center text-sm font-semibold text-white shadow-sm">Falar com a loja no WhatsApp</a>}
        <p className="text-center text-xs text-gray-400">Página do seu pedido na {store}. Guarde este link para acompanhar.</p>
      </div>
    </main>
  )
}
