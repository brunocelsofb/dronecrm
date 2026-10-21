import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { hasFeature } from '@/lib/auth/access'
import { requireTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { fmtBRL } from '@/lib/format'
import { CUSTOMER_STATUS, customerStatus, formatPhone, mergeStats, orderStatusLabel, ORDER_STATUSES } from '@/lib/retail/customers'
import { loadCustomerOrderStats, loadRetailSettings } from '@/lib/retail/queries'
import { CustomerForm, type CustomerData } from '@/components/retail/customer-form'

export const dynamic = 'force-dynamic'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const fmtDate = (d: string | null) => (d ? new Date(d.length === 10 ? `${d}T12:00:00` : d).toLocaleDateString('pt-BR') : '—')

export default async function RetailCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await hasFeature('varejo'))) redirect('/')
  const { id } = await params
  if (id === 'nova') {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Link href="/varejo/clientes" className="text-sm text-brand-700 hover:underline">← Clientes</Link>
        <h1 className="text-xl font-semibold text-gray-900">Nova cliente</h1>
        <CustomerForm customer={null} />
      </div>
    )
  }
  if (!UUID.test(id)) notFound()
  const tenantId = await requireTenantId()
  const db = await createScopedAdmin(tenantId)
  const { data } = await db.from('retail_customers')
    .select('id, name, phone, email, cpf, birth_date, city, state, cep, address, notes, whatsapp_optin, optin_at, source, legacy_last_purchase_at, legacy_total, legacy_orders, created_at')
    .eq('id', id).maybeSingle()
  if (!data) notFound()
  const c = data as unknown as CustomerData & { legacy_last_purchase_at: string | null; legacy_total: number | null; legacy_orders: number | null; source: string; optin_at: string | null; created_at: string }
  const [settings, stats, { data: orders }] = await Promise.all([
    loadRetailSettings(db, tenantId),
    loadCustomerOrderStats(db, [id]),
    db.from('retail_orders').select('id, number, status, total, created_at').eq('customer_id', id).order('created_at', { ascending: false }).limit(100),
  ])
  const s = mergeStats(stats.get(id), c)
  const status = customerStatus(s.last, settings.inactive_days)

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/varejo/clientes" className="text-sm text-brand-700 hover:underline">← Clientes</Link>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{c.name}</h1>
          <p className="text-sm text-gray-500">{formatPhone(c.phone)}{c.city ? ` · ${c.city}` : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded px-2 py-1 text-xs ${CUSTOMER_STATUS[status].style}`}>{CUSTOMER_STATUS[status].label}</span>
          <Link href={`/varejo/pedidos/novo?cliente=${c.id}`} className="rounded-lg bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800">Novo pedido</Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Info label="Compras" value={String(s.orders)} />
        <Info label="Total comprado" value={fmtBRL(s.total)} />
        <Info label="Primeira compra" value={fmtDate(s.first)} />
        <Info label="Última compra" value={fmtDate(s.last)} />
      </div>
      {(c.legacy_last_purchase_at || c.legacy_total) && (
        <p className="text-xs text-gray-500">Inclui o histórico importado de antes do CRM: {c.legacy_orders ?? '—'} compra(s), {fmtBRL(c.legacy_total)} até {fmtDate(c.legacy_last_purchase_at)}.</p>
      )}

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">Pedidos</h2>
        {(orders ?? []).length === 0 ? <p className="mt-2 text-sm text-gray-500">Nenhum pedido no CRM.</p> : (
          <ul className="mt-2 divide-y divide-gray-100">
            {(orders ?? []).map(o => (
              <li key={o.id as string}>
                <Link href={`/varejo/pedidos/${o.id}`} className="flex items-center justify-between gap-2 py-2 text-sm hover:text-brand-700">
                  <span>Nº {o.number as number} · {fmtDate(o.created_at as string)}</span>
                  <span className="flex items-center gap-2">
                    <span className={`rounded px-1.5 py-0.5 text-[11px] ${ORDER_STATUSES.find(x => x.id === o.status)?.style ?? ''}`}>{orderStatusLabel(o.status as string)}</span>
                    <span className="text-gray-900">{fmtBRL(Number(o.total))}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <CustomerForm customer={c} />
      <p className="text-xs text-gray-500">Origem: {c.source === 'vitrine' ? 'vitrine' : c.source === 'planilha' ? 'planilha' : 'cadastro manual'}{c.optin_at ? ` · autorizou mensagens no WhatsApp em ${fmtDate(c.optin_at)}` : ''}.</p>
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-gray-900">{value}</p>
    </div>
  )
}
