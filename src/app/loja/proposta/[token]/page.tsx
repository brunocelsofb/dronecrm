// Página pública da proposta do Varejo: a cliente vê o que escolheu, escolhe Pix ou cartão,
// aceita e já recebe o link de pagamento. Link com token; mostra só o que a cliente pode ver.
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPublicBranding } from '@/lib/utils/public-branding'
import { isProposal } from '@/lib/retail/proposal'
import { fmtBRL } from '@/lib/format'
import { ProposalAccept } from './accept'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Sua proposta', robots: { index: false, follow: false } }

const day = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

export default async function RetailProposalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) notFound()
  const admin = createAdminClient()
  const { data: o } = await admin.from('retail_orders').select('tenant_id, status, proposal, proposal_choice, proposal_accepted_at').eq('proposal_token', token).maybeSingle()
  if (!o || !isProposal(o.proposal)) notFound()
  const p = o.proposal
  const [branding, { data: org }] = await Promise.all([
    getPublicBranding(o.tenant_id as string),
    admin.from('organization_settings').select('proposal_brand_color').eq('tenant_id', o.tenant_id).maybeSingle(),
  ])
  const brand = (org?.proposal_brand_color as string | null) || '#1B556B'
  const today = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10)
  const closed = o.status === 'cancelado'
  const expired = !o.proposal_accepted_at && p.valid_until < today

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-6">
      <div className="mx-auto max-w-lg space-y-4">
        <header className="flex items-center justify-between gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {branding.logoUrl ? <img src={branding.logoUrl} alt={p.store} className="h-10 w-auto max-w-[160px] object-contain" /> : <span className="text-lg font-semibold" style={{ color: brand }}>{p.store}</span>}
          <span className="text-right text-xs text-gray-500">Proposta nº {p.number}<br />válida até {day(p.valid_until)}</span>
        </header>

        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-sm text-gray-500">Olá{p.customer.name ? `, ${p.customer.name.split(' ')[0]}` : ''}! Estas são as peças que você escolheu:</p>
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

        {closed ? (
          <p className="rounded-2xl bg-white p-5 text-sm text-gray-600 shadow-sm">Este pedido foi encerrado. Fale com a loja pelo WhatsApp.</p>
        ) : expired ? (
          <p className="rounded-2xl bg-white p-5 text-sm text-gray-600 shadow-sm">Esta proposta venceu em {day(p.valid_until)}. Peça uma nova para a loja pelo WhatsApp.</p>
        ) : (
          <ProposalAccept token={token} brand={brand} options={p.options} acceptedChoice={(o.proposal_choice as 'pix' | 'card' | null) ?? null} />
        )}

        <p className="text-center text-xs text-gray-500"><a href={`/api/varejo/proposta/${token}`} className="underline">Baixar em PDF</a> · {p.store}</p>
      </div>
    </main>
  )
}
