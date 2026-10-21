import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { hasFeature } from '@/lib/auth/access'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { fmtBRL } from '@/lib/format'
import { ORDER_STATUSES, PAYMENT_METHODS, formatPhone, orderMessage, whatsappLink } from '@/lib/retail/customers'
import { OrderPanel } from '@/components/retail/order-panel'

export const dynamic = 'force-dynamic'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Order = {
  id: string; number: number; status: string; payment_method: string | null; payment_condition: string | null; payment_link: string | null
  subtotal: number; discount: number; shipping: number; total: number; source: string; notes: string | null; stock_applied: boolean
  delivery: { method?: string | null; cep?: string | null; address?: string | null } | null
  paid_at: string | null; created_at: string; customer_id: string | null
  retail_customers: { id: string; name: string; phone: string | null } | null
  retail_order_items: { id: string; code: string; name: string; sku: string | null; color: string | null; size: string | null; qty: number; unit_price: number; total: number }[]
}

const fmtDT = (d: string | null) => (d ? new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')

export default async function RetailOrderPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await hasFeature('varejo'))) redirect('/')
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const db = await createScopedAdmin()
  const { data } = await db.from('retail_orders')
    .select('id, number, status, payment_method, payment_condition, payment_link, subtotal, discount, shipping, total, source, notes, stock_applied, delivery, paid_at, created_at, customer_id, retail_customers(id, name, phone), retail_order_items(id, code, name, sku, color, size, qty, unit_price, total)')
    .eq('id', id).maybeSingle()
  if (!data) notFound()
  const o = data as unknown as Order
  const n = (v: unknown) => Number(v ?? 0)
  const message = orderMessage({
    number: o.number, customerName: o.retail_customers?.name ?? null,
    items: o.retail_order_items.map(i => ({ name: i.name, color: i.color, size: i.size, qty: i.qty, total: n(i.total) })),
    subtotal: n(o.subtotal), discount: n(o.discount), shipping: n(o.shipping), total: n(o.total),
    paymentMethod: o.payment_method, paymentCondition: o.payment_condition, paymentLink: o.payment_link,
  }, fmtBRL)
  const wa = whatsappLink(o.retail_customers?.phone, message)
  const st = ORDER_STATUSES.find(s => s.id === o.status)

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/varejo/pedidos" className="text-sm text-brand-700 hover:underline">← Pedidos</Link>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Pedido nº {o.number}</h1>
          <p className="text-sm text-gray-500">{fmtDT(o.created_at)} · {o.source === 'vitrine' ? 'veio da vitrine' : 'lançado pela equipe'}{o.paid_at ? ` · pago em ${fmtDT(o.paid_at)}` : ''}</p>
        </div>
        <span className={`rounded px-2 py-1 text-xs ${st?.style ?? ''}`}>{st?.label ?? o.status}</span>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
        <h2 className="text-sm font-semibold text-gray-900">Cliente</h2>
        {o.retail_customers ? (
          <p className="mt-1"><Link href={`/varejo/clientes/${o.retail_customers.id}`} className="text-brand-700 hover:underline">{o.retail_customers.name}</Link> · {formatPhone(o.retail_customers.phone)}</p>
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
          {n(o.shipping) > 0 && <div className="flex justify-between text-gray-600"><span>Frete</span><span>{fmtBRL(n(o.shipping))}</span></div>}
          <div className="flex justify-between font-semibold text-gray-900"><span>Total</span><span>{fmtBRL(n(o.total))}</span></div>
          <p className="text-xs text-gray-500">Pagamento: {[PAYMENT_METHODS.find(p => p.id === o.payment_method)?.label, o.payment_condition].filter(Boolean).join(' · ') || '—'}{o.stock_applied ? ' · estoque baixado' : ''}</p>
        </div>
      </section>

      <OrderPanel
        order={{
          id: o.id, status: o.status, discount: n(o.discount), shipping: n(o.shipping), payment_method: o.payment_method,
          payment_condition: o.payment_condition, payment_link: o.payment_link, notes: o.notes,
        }}
        message={message}
        whatsappUrl={wa}
      />
    </div>
  )
}
