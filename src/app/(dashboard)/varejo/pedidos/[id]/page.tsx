import Link from 'next/link'
import { lostReasonLabel } from '@/lib/retail/funnel'
import { providerLabel, readPaymentSetup } from '@/lib/retail/payments'
import { notFound, redirect } from 'next/navigation'
import { hasFeature } from '@/lib/auth/access'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { fmtBRL } from '@/lib/format'
import { ORDER_STATUSES, PAYMENT_METHODS, formatPhone, orderMessage, whatsappLink } from '@/lib/retail/customers'
import { OrderPanel } from '@/components/retail/order-panel'
import { TestOrderDelete } from '@/components/retail/test-order-delete'
import { getSupportSession } from '@/lib/tenant/support'
import { OrderMessagesPanel, type OrderEvent, type OrderMessage } from '@/components/retail/order-messages-panel'
import { ensurePublicToken, orderPublicUrl } from '@/lib/retail/order-messages-server'
import { birthdayInfo, birthdayLabel } from '@/lib/retail/customers'
import { NegotiationPanel } from '@/components/retail/negotiation-panel'
import { ProposalPanel } from '@/components/retail/proposal-panel'
import { isProposal } from '@/lib/retail/proposal'
import { appBaseUrl } from '@/lib/whatsapp/webhook-token'
import { requireTenantId } from '@/lib/tenant/context'
import { customerLoyalty, loadPricingConfig } from '@/lib/retail/loyalty-server'
import { pricingAt, readPricing, conditionOptions, requiredMarginPct } from '@/lib/retail/margin'

export const dynamic = 'force-dynamic'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Order = {
  id: string; number: number; status: string; payment_method: string | null; payment_condition: string | null; payment_link: string | null
  subtotal: number; discount: number; shipping: number; total: number; loyalty_discount: number; loyalty_kind: string | null; loyalty_earned: number; source: string; notes: string | null; stock_applied: boolean
  delivery: { method?: string | null; cep?: string | null; address?: string | null } | null
  paid_at: string | null; created_at: string; customer_id: string | null; lost_reason: string | null
  payment_provider: string | null; payment_paid_method: string | null; payment_paid_amount: number | null; payment_receipt_url: string | null; payment_alert: string | null
  proposal_token: string | null; proposal: unknown; proposal_sent_at: string | null; proposal_choice: string | null; proposal_accepted_at: string | null
  retail_customers: { id: string; name: string; phone: string | null; email: string | null; birth_date: string | null } | null
  separated_at: string | null; tracking_carrier: string | null; tracking_code: string | null; tracking_url: string | null
  retail_order_items: { id: string; code: string; name: string; sku: string | null; color: string | null; size: string | null; qty: number; unit_price: number; total: number; unit_cost: number | null; retail_products: { cost_price: number | null } | null }[]
}

const fmtDT = (d: string | null) => (d ? new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')

export default async function RetailOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const access = await hasFeature('varejo')
  if (!access) redirect('/')
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const tenantId = await requireTenantId()
  const db = await createScopedAdmin(tenantId)
  const { data } = await db.from('retail_orders')
    .select('id, number, status, payment_method, payment_condition, payment_link, subtotal, discount, shipping, total, loyalty_discount, loyalty_kind, loyalty_earned, source, proposal_token, proposal, proposal_sent_at, proposal_choice, proposal_accepted_at, lost_reason, payment_provider, payment_paid_method, payment_paid_amount, payment_receipt_url, payment_alert, notes, stock_applied, delivery, paid_at, created_at, customer_id, separated_at, tracking_carrier, tracking_code, tracking_url, campaign_id, retail_campaigns(name), retail_customers(id, name, phone, email, birth_date), retail_order_items(id, code, name, sku, color, size, qty, unit_price, total, unit_cost, retail_products(cost_price))')
    .eq('id', id).maybeSingle()
  if (!data) notFound()
  const o = data as unknown as Order
  const n = (v: unknown) => Number(v ?? 0)
  const message = orderMessage({
    number: o.number, customerName: o.retail_customers?.name ?? null,
    items: o.retail_order_items.map(i => ({ name: i.name, color: i.color, size: i.size, qty: i.qty, total: n(i.total) })),
    subtotal: n(o.subtotal), discount: n(o.discount), shipping: n(o.shipping), total: n(o.total), loyaltyDiscount: n(o.loyalty_discount),
    paymentMethod: o.payment_method, paymentCondition: o.payment_condition, paymentLink: o.payment_link,
  }, fmtBRL)
  const wa = whatsappLink(o.retail_customers?.phone, message)
  const st = ORDER_STATUSES.find(s => s.id === o.status)
  const cfg = await loadPricingConfig(db, tenantId)
  // imposto do regime em vigor na data da venda (pedido pago) ou hoje (em aberto)
  const pricing = pricingAt(readPricing(cfg.raw.pricing), cfg.regimes, o.paid_at ?? new Date(), cfg.rbt12)
  const loyalty = cfg.loyalty
  const paySetup = readPaymentSetup(cfg.raw.payments)
  const { data: org } = await db.from('organization_settings').select('company_name, name').eq('tenant_id', tenantId).maybeSingle()
  const storeName = ((org?.company_name as string | null) || (org?.name as string | null) || 'loja').trim()
  // Mensagens por etapa, linha do tempo, WhatsApps que enviam e se quem está logado tem e-mail
  const support = await getSupportSession()
  const token = await ensurePublicToken(db, o.id).catch(() => null) // suporte (só leitura) não grava
  const [{ data: msgs }, { data: evs }, { data: orgWa }, { data: myEmail }] = await Promise.all([
    db.from('retail_order_messages').select('id, stage, status, wa_text, email_subject, email_body, sent_channels, sent_at, sent_by, last_error, updated_at').eq('order_id', o.id),
    db.from('retail_order_events').select('id, kind, note, public, created_at, created_by').eq('order_id', o.id).order('created_at', { ascending: false }).limit(100),
    db.from('organization_settings').select('evo_instance_name, evo_instance_aliases').eq('tenant_id', tenantId).maybeSingle(),
    db.from('email_accounts').select('user_id').eq('user_id', access.userId).maybeSingle(),
  ])
  const peopleIds = [...new Set([...(msgs ?? []).map(m => m.sent_by), ...(evs ?? []).map(e => e.created_by)].filter(Boolean))] as string[]
  const { data: people } = peopleIds.length ? await db.from('profiles').select('id, full_name').in('id', peopleIds) : { data: [] }
  const nameOf = new Map((people ?? []).map(p => [p.id as string, (p.full_name as string | null) ?? null]))
  type Alias = string | { label?: string; private?: boolean }
  const aliases = (orgWa?.evo_instance_aliases ?? {}) as Record<string, Alias>
  const instances = Object.entries(aliases).filter(([, v]) => !(typeof v === 'object' && v?.private)).map(([name, v]) => ({ name, label: typeof v === 'string' ? v : v?.label ?? name }))
  if (orgWa?.evo_instance_name && !instances.some(i => i.name === orgWa.evo_instance_name)) instances.unshift({ name: orgWa.evo_instance_name as string, label: orgWa.evo_instance_name as string })
  const messages: OrderMessage[] = (msgs ?? []).map(m => ({ ...(m as Omit<OrderMessage, 'sent_by_name'>), sent_by_name: m.sent_by ? nameOf.get(m.sent_by as string) ?? null : null }))
  const events: OrderEvent[] = (evs ?? []).map(e => ({ id: e.id as string, kind: e.kind as string, note: e.note as string | null, public: !!e.public, created_at: e.created_at as string, by: e.created_by ? nameOf.get(e.created_by as string) ?? null : null }))
  const bday = birthdayLabel(birthdayInfo(o.retail_customers?.birth_date ?? null))
  const custLoyalty = o.customer_id ? await customerLoyalty(db, o.customer_id, loyalty, o.id) : { mode: 'off' as const }
  // custo gravado na venda; pedidos antigos (sem custo gravado) usam o custo atual da peça
  const lines = o.retail_order_items.map(i => ({
    qty: i.qty, unit_price: n(i.unit_price),
    unit_cost: i.unit_cost !== null && i.unit_cost !== undefined ? n(i.unit_cost) : i.retail_products?.cost_price !== null && i.retail_products?.cost_price !== undefined ? n(i.retail_products.cost_price) : null,
  }))

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/varejo/pedidos" className="text-sm text-brand-700 hover:underline">← Pedidos</Link>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Pedido nº {o.number}</h1>
          <p className="text-sm text-gray-500">{fmtDT(o.created_at)} · {o.source === 'vitrine' ? 'veio da vitrine' : 'lançado pela equipe'}{(o as unknown as { retail_campaigns: { name: string } | null }).retail_campaigns ? <> · campanha <Link href={`/varejo/campanhas/${(o as unknown as { campaign_id: string }).campaign_id}`} className="text-brand-700 hover:underline">{(o as unknown as { retail_campaigns: { name: string } }).retail_campaigns.name}</Link></> : null}{o.paid_at ? ` · pago em ${fmtDT(o.paid_at)}` : ''}</p>
        </div>
        <span className={`rounded px-2 py-1 text-xs ${st?.style ?? ''}`}>{st?.label ?? o.status}{o.status === 'cancelado' && o.lost_reason ? ` · ${lostReasonLabel(o.lost_reason)}` : ''}</span>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
        <h2 className="text-sm font-semibold text-gray-900">Cliente</h2>
        {o.retail_customers ? (
          <>
            <p className="mt-1"><Link href={`/varejo/clientes/${o.retail_customers.id}`} className="text-brand-700 hover:underline">{o.retail_customers.name}</Link> · {formatPhone(o.retail_customers.phone)}{o.retail_customers.email ? ` · ${o.retail_customers.email}` : ''}</p>
            <p className="mt-0.5 text-xs text-gray-500">Aniversário: {o.retail_customers.birth_date ? `${o.retail_customers.birth_date.slice(8, 10)}/${o.retail_customers.birth_date.slice(5, 7)}${bday ? ` (${bday})` : ''}` : 'não informado'}</p>
            {(!o.retail_customers.phone || !o.retail_customers.email) && (
              <p className="mt-1 rounded-lg bg-warn-100 px-2 py-1 text-xs text-warn-700">Falta {[!o.retail_customers.phone && 'WhatsApp', !o.retail_customers.email && 'e-mail'].filter(Boolean).join(' e ')} na ficha. <Link href={`/varejo/clientes/${o.retail_customers.id}#cadastro`} className="underline">Completar cadastro</Link></p>
            )}
          </>
        ) : <p className="mt-1 text-gray-500">Sem cliente ligada.</p>}
        {(o.delivery?.method || o.delivery?.address || o.delivery?.cep) && (
          <p className="mt-1 text-gray-600">Entrega: {[o.delivery?.method, o.delivery?.address, o.delivery?.cep ? `CEP ${o.delivery.cep}` : null].filter(Boolean).join(' · ')}</p>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">Itens</h2>
        <ul className="mt-2 divide-y divide-gray-100 text-sm">
          {o.retail_order_items.map(i => (
            <li key={i.id} className="flex justify-between gap-2 py-2">
              <span>{i.name}{[i.color, i.size].filter(Boolean).length ? ` · ${[i.color, i.size].filter(Boolean).join(' / ')}` : ''} <span className="text-xs text-gray-500">({i.sku ?? i.code})</span><span className="block text-xs text-gray-500">{i.qty} × {fmtBRL(n(i.unit_price))}</span></span>
              <span className="whitespace-nowrap">{fmtBRL(n(i.total))}</span>
            </li>
          ))}
        </ul>
        <div className="mt-2 space-y-1 border-t border-gray-100 pt-2 text-sm">
          <div className="flex justify-between text-gray-600"><span>Subtotal</span><span>{fmtBRL(n(o.subtotal))}</span></div>
          {n(o.discount) > 0 && <div className="flex justify-between text-gray-600"><span>Desconto</span><span>− {fmtBRL(n(o.discount))}</span></div>}
          {n(o.loyalty_discount) > 0 && <div className="flex justify-between text-gray-600"><span>Fidelidade</span><span>− {fmtBRL(n(o.loyalty_discount))}</span></div>}
          {n(o.shipping) > 0 && <div className="flex justify-between text-gray-600"><span>Frete</span><span>{fmtBRL(n(o.shipping))}</span></div>}
          <div className="flex justify-between font-semibold text-gray-900"><span>Total</span><span>{fmtBRL(n(o.total))}</span></div>
          <p className="text-xs text-gray-500">Pagamento: {[PAYMENT_METHODS.find(p => p.id === o.payment_method)?.label, o.payment_condition].filter(Boolean).join(' · ') || '—'}{o.stock_applied ? ' · estoque baixado' : ''}{n(o.loyalty_earned) > 0 ? ` · gerou ${fmtBRL(n(o.loyalty_earned))} de cashback` : ''}</p>
        </div>
      </section>

      {(() => {
        const prop = isProposal(o.proposal) ? o.proposal : null
        // na proposta já aceita, o desconto do Pix está no pedido: mostra o ganho como ficou
        const base = n(o.discount) + n(o.loyalty_discount)
        const previews = conditionOptions(lines, prop && o.proposal_accepted_at ? base - (prop.options.find(x => x.id === o.proposal_choice)?.discount ?? 0) : base, pricing, loyalty, cfg.conditions).map(c => ({
          id: c.id, label: c.label, grand_total: Math.round((c.total + n(o.shipping)) * 100) / 100, installments: c.installments,
          installmentValue: Math.round(((c.total + n(o.shipping)) / c.installments) * 100) / 100, contribution: c.analysis.contribution, marginPct: c.analysis.marginPct,
        }))
        return (
          <ProposalPanel orderId={o.id} previews={previews} targetMargin={requiredMarginPct(pricing)}
            url={o.proposal_token ? `${appBaseUrl()}/loja/proposta/${o.proposal_token}` : null} sentAt={o.proposal_sent_at}
            choiceLabel={prop?.options.find(x => x.id === o.proposal_choice)?.label ?? null}
            links={{ pix: prop?.options.find(x => x.id === 'pix')?.link ?? null, card: prop?.options.find(x => x.id === 'card')?.link ?? null }}
            customer={o.retail_customers ? { name: o.retail_customers.name, phone: o.retail_customers.phone } : null} storeName={storeName}
            editable={o.status !== 'cancelado' && !o.stock_applied}
            providers={{ pix: paySetup.pix_provider, card: paySetup.card_provider }}
            payment={{
              paid: !!o.stock_applied,
              via: o.payment_provider && o.payment_provider !== 'manual' ? `${o.payment_paid_method === 'pix' ? 'Pix' : o.payment_paid_method === 'card' ? 'cartão' : 'pagamento'} via ${providerLabel(o.payment_provider)}${o.payment_paid_amount ? `, ${fmtBRL(n(o.payment_paid_amount))}` : ''}` : null,
              alert: o.payment_alert, receiptUrl: o.payment_receipt_url,
            }} />
        )
      })()}

      <OrderMessagesPanel
        orderId={o.id} status={o.status} separatedAt={o.separated_at}
        tracking={{ carrier: o.tracking_carrier, code: o.tracking_code, url: o.tracking_url }}
        messages={messages} events={events}
        customer={o.retail_customers ? { phone: o.retail_customers.phone, email: o.retail_customers.email } : null}
        instances={instances} canEmail={!!myEmail} publicUrl={token ? orderPublicUrl(token) : null} editable={o.status !== 'cancelado'}
      />

      <NegotiationPanel
        orderId={o.id} lines={lines} storeName={storeName}
        labels={o.retail_order_items.map(i => `${i.name}${[i.color, i.size].filter(Boolean).length ? ` · ${[i.color, i.size].filter(Boolean).join(' / ')}` : ''}`)}
        customer={o.retail_customers ? { name: o.retail_customers.name, phone: o.retail_customers.phone } : null}
        payment={{ discount: n(o.discount), shipping: n(o.shipping), payment_method: o.payment_method, payment_condition: o.payment_condition, payment_link: o.payment_link, notes: o.notes }}
        loyaltyDiscount={n(o.loyalty_discount)} loyaltyKind={o.loyalty_kind}
        pricing={pricing} loyalty={loyalty} customerLoyalty={custLoyalty}
        editable={o.status !== 'cancelado' && !o.stock_applied} hasCustomer={!!o.customer_id}
      />

      <OrderPanel
        // remonta quando a negociação muda o desconto (o formulário não fica com valor velho)
        key={`${n(o.discount)}|${n(o.loyalty_discount)}|${n(o.total)}`}
        order={{
          id: o.id, status: o.status, discount: n(o.discount), shipping: n(o.shipping), payment_method: o.payment_method,
          payment_condition: o.payment_condition, payment_link: o.payment_link, notes: o.notes,
        }}
        message={message}
        whatsappUrl={wa}
      />

      {(access.isAdmin || support) && <TestOrderDelete orderId={o.id} support={!!support} />}
    </div>
  )
}
