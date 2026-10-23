// "Finalizar compra" do Varejo (página pública com token): a cliente vê as peças, escolhe
// Pix ou cartão e vai direto pagar. Ao voltar do pagamento, o Drone confere no serviço e,
// se aprovado, o pedido já vira Pago. Mostra só o que a cliente pode ver.
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPublicBranding } from '@/lib/utils/public-branding'
import { isProposal } from '@/lib/retail/proposal'
import { fmtBRL } from '@/lib/format'
import { ProposalAccept } from './accept'
import { confirmRetailPayment, orderByToken } from '@/lib/retail/checkout-server'
import { loadPaymentAccounts, verifyInfinitePay, verifyMercadoPago } from '@/lib/retail/payment-providers'

type SP = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''

// Volta do pagamento: confere no serviço (o que vem no endereço não basta para marcar Pago)
async function checkReturn(token: string, sp: SP): Promise<void> {
  if (one(sp.retorno) !== '1') return
  const order = await orderByToken(token)
  if (!order || order.stock_applied) return
  try {
    const accounts = await loadPaymentAccounts(order.tenant_id)
    const nsu = one(sp.order_nsu), tx = one(sp.transaction_nsu), slug = one(sp.slug)
    if (nsu && tx && slug && order.payment_links?.[nsu]?.provider === 'infinitepay') {
      const v = await verifyInfinitePay(accounts, { order_nsu: nsu, transaction_nsu: tx, slug, receipt_url: one(sp.receipt_url) || null })
      if (v) await confirmRetailPayment(order, 'infinitepay', v)
      return
    }
    const mpId = one(sp.payment_id) || one(sp.collection_id)
    if (/^\d{1,30}$/.test(mpId)) {
      const v = await verifyMercadoPago(accounts, mpId)
      if (v) await confirmRetailPayment(order, 'mercadopago', v)
    }
  } catch (e) { console.error('[varejo-pagamento] retorno:', e instanceof Error ? e.message : e) }
}

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Finalizar compra', robots: { index: false, follow: false } }

const day = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

export default async function RetailProposalPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<SP> }) {
  const { token } = await params
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) notFound()
  const sp = await searchParams
  await checkReturn(token, sp)
  const admin = createAdminClient()
  const { data: o } = await admin.from('retail_orders').select('tenant_id, status, stock_applied, proposal, payment_receipt_url').eq('proposal_token', token).maybeSingle()
  if (!o || !isProposal(o.proposal)) notFound()
  const p = o.proposal
  const [branding, { data: org }] = await Promise.all([
    getPublicBranding(o.tenant_id as string),
    admin.from('organization_settings').select('proposal_brand_color').eq('tenant_id', o.tenant_id).maybeSingle(),
  ])
  const brand = (org?.proposal_brand_color as string | null) || '#1B556B'
  const today = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10)
  const closed = o.status === 'cancelado'
  const paid = !!o.stock_applied || ['pago', 'enviado', 'entregue'].includes(o.status as string)
  const expired = p.valid_until < today
  const returned = one(sp.retorno) === '1'

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-6">
      <div className="mx-auto max-w-lg space-y-4">
        <header className="flex items-center justify-between gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {branding.logoUrl ? <img src={branding.logoUrl} alt={p.store} className="h-10 w-auto max-w-[160px] object-contain" /> : <span className="text-lg font-semibold" style={{ color: brand }}>{p.store}</span>}
          <span className="text-right text-xs text-gray-500">Pedido nº {p.number}<br />valores até {day(p.valid_until)}</span>
        </header>

        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-sm text-gray-500">Olá{p.customer.name ? `, ${p.customer.name.split(' ')[0]}` : ''}! Falta pouco! Estas são as peças que você escolheu:</p>
          <ul className="mt-3 divide-y divide-gray-100">
            {p.items.map((it, i) => (
              <li key={i} className="flex justify-between gap-3 py-2.5 text-sm">
                <span className="min-w-0"><span className="block font-medium text-gray-900">{it.name}</span><span className="block text-xs text-gray-500">{[it.detail, `${it.qty} un.`].filter(Boolean).join(' · ')}</span></span>
                <span className="whitespace-nowrap text-gray-900">{fmtBRL(it.total)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-2 space-y-1 border-t border-gray-100 pt-2 text-sm text-gray-600">
            <div className="flex justify-between"><span>Subtotal</span><span>{fmtBRL(p.subtotal)}</span></div>
            {p.discount > 0 && <div className="flex justify-between"><span>Desconto</span><span>− {fmtBRL(p.discount)}</span></div>}
            {p.loyalty_discount > 0 && <div className="flex justify-between"><span>Fidelidade</span><span>− {fmtBRL(p.loyalty_discount)}</span></div>}
            {p.shipping > 0 && <div className="flex justify-between"><span>Frete</span><span>{fmtBRL(p.shipping)}</span></div>}
          </div>
        </section>

        {paid ? (
          <section className="space-y-2 rounded-2xl bg-white p-5 text-center shadow-sm">
            <p className="text-lg font-semibold text-gray-900">Pagamento confirmado!</p>
            <p className="text-sm text-gray-600">Obrigada pela compra. A loja já recebeu o seu pedido.</p>
            {o.payment_receipt_url && <a href={o.payment_receipt_url as string} target="_blank" rel="noopener noreferrer" className="inline-block text-sm underline" style={{ color: brand }}>Ver comprovante</a>}
          </section>
        ) : closed ? (
          <p className="rounded-2xl bg-white p-5 text-sm text-gray-600 shadow-sm">Este pedido foi encerrado. Fale com a loja pelo WhatsApp.</p>
        ) : expired ? (
          <p className="rounded-2xl bg-white p-5 text-sm text-gray-600 shadow-sm">Este link venceu em {day(p.valid_until)}. Peça um novo para a loja pelo WhatsApp.</p>
        ) : (
          <>
            {returned && <p className="rounded-2xl bg-white p-4 text-sm text-gray-600 shadow-sm">Estamos confirmando o seu pagamento. Assim que for aprovado, a loja recebe o aviso. Se ainda não pagou, escolha abaixo.</p>}
            <ProposalAccept token={token} brand={brand} options={p.options} />
          </>
        )}

        <p className="text-center text-xs text-gray-500"><a href={`/api/varejo/proposta/${token}`} className="underline">Resumo em PDF</a> · {p.store}</p>
      </div>
    </main>
  )
}
