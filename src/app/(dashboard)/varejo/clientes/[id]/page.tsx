import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { hasFeature } from '@/lib/auth/access'
import { requireTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { fmtBRL } from '@/lib/format'
import { CUSTOMER_STATUS, birthdayInfo, birthdayMessage, customerStatus, formatPhone, mergeStats, orderStatusLabel, ORDER_STATUSES, whatsappLink } from '@/lib/retail/customers'
import { loadCustomerOrderStats, loadRetailSettings } from '@/lib/retail/queries'
import { CustomerForm, type CustomerData } from '@/components/retail/customer-form'
import { customerLoyalty, loadPricingConfig } from '@/lib/retail/loyalty-server'
import { analyzeLines, analyzeOrder, loyaltyMessage, loyaltyUnitText, pricingAt, round2 } from '@/lib/retail/margin'
import { fmtPct } from '@/lib/format'
import { PAID_STATUSES } from '@/lib/retail/customers'

export const dynamic = 'force-dynamic'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const fmtDate = (d: string | null) => (d ? new Date(d.length === 10 ? `${d}T12:00:00` : d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—')

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
  const bday = birthdayInfo(c.birth_date)
  const { data: org } = await db.from('organization_settings').select('company_name, name').eq('tenant_id', tenantId).maybeSingle()
  // Compras pagas com os itens: peças, quanto pagou e quanto a loja ganhou com ela
  const cfg = await loadPricingConfig(db, tenantId)
  const { data: paidRows } = await db.from('retail_orders')
    .select('id, number, paid_at, discount, loyalty_discount, retail_order_items(qty, unit_price, unit_cost, name, color, size, retail_products(cost_price))')
    .eq('customer_id', id).in('status', PAID_STATUSES).order('paid_at', { ascending: false }).limit(500)
  type PI = { qty: number; unit_price: number; unit_cost: number | null; name: string; color: string | null; size: string | null; retail_products: { cost_price: number | null } | null }
  const paidOrders = (paidRows ?? []) as unknown as { id: string; number: number; paid_at: string | null; discount: number; loyalty_discount: number; retail_order_items: PI[] }[]
  const lineOf = (i: PI) => ({ qty: i.qty, unit_price: Number(i.unit_price), unit_cost: i.unit_cost !== null && i.unit_cost !== undefined ? Number(i.unit_cost) : i.retail_products?.cost_price !== null && i.retail_products?.cost_price !== undefined ? Number(i.retail_products.cost_price) : null })
  let piecesBought = 0, revenue = 0, gain = 0, missingCost = 0
  const boughtLines: { key: string; order: number; orderId: string; when: string | null; label: string; qty: number; price: number; gain: number | null }[] = []
  for (const o of paidOrders) {
    const p = pricingAt(cfg.pricing, cfg.regimes, o.paid_at ?? new Date())
    const lines = o.retail_order_items.map(lineOf)
    const a = analyzeOrder(lines, Number(o.discount) + Number(o.loyalty_discount ?? 0), p, cfg.loyalty)
    revenue += a.revenue; gain += a.contribution; missingCost += a.missingCost
    const per = analyzeLines(lines, p, cfg.loyalty)
    o.retail_order_items.forEach((i, k) => {
      piecesBought += i.qty
      boughtLines.push({ key: `${o.id}-${k}`, order: o.number, orderId: o.id, when: o.paid_at, label: `${i.name}${[i.color, i.size].filter(Boolean).length ? ` · ${[i.color, i.size].filter(Boolean).join(' / ')}` : ''}`, qty: i.qty, price: Number(i.unit_price), gain: per[k].contribution })
    })
  }
  const loyaltyState = await customerLoyalty(db, id, cfg.loyalty)
  const storeName = ((org?.company_name as string | null) || (org?.name as string | null) || 'loja').trim()
  const congrats = bday && c.phone ? whatsappLink(c.phone, birthdayMessage(c.name, storeName)) : null
  const lMsg = loyaltyState.mode !== 'off' ? loyaltyMessage(c.name.split(' ')[0], storeName, cfg.loyalty, loyaltyState, fmtBRL) : null
  const lWa = lMsg ? whatsappLink(c.phone, lMsg) : null

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
      {bday && (
        <section className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 ${bday.daysUntil === 0 ? 'border-accent-purple/40 bg-accent-purple/10' : 'border-gray-200 bg-white'}`}>
          <div>
            <p className="text-sm font-semibold text-gray-900">
              Aniversário: {String(bday.day).padStart(2, '0')}/{String(bday.month).padStart(2, '0')}
              {bday.turning ? ` · fará ${bday.turning} anos` : ''}
            </p>
            <p className="text-xs text-gray-500">{bday.daysUntil === 0 ? 'É hoje.' : bday.daysUntil === 1 ? 'É amanhã.' : `Faltam ${bday.daysUntil} dias.`}</p>
          </div>
          {congrats
            ? <a href={congrats} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800">Mandar parabéns no WhatsApp</a>
            : <span className="text-xs text-gray-500">Cadastre o telefone para mandar parabéns pelo WhatsApp.</span>}
        </section>
      )}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">Compras no sistema e ganhos</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Info label="Pedidos pagos" value={String(paidOrders.length)} />
          <Info label="Peças compradas" value={String(piecesBought)} />
          <Info label="Pagou (peças, sem frete)" value={fmtBRL(round2(revenue))} />
          <Info label="Você ganhou com ela" value={`${fmtBRL(round2(gain))}${revenue > 0 ? ` · ${fmtPct((gain / revenue) * 100)}` : ''}`} />
        </div>
        {missingCost > 0 && <p className="mt-2 text-xs text-warn-700">{missingCost} peça(s) sem custo cadastrado: o ganho real é menor.</p>}
        {boughtLines.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-medium text-brand-700">Peças que ela comprou ({boughtLines.length})</summary>
            <ul className="mt-2 divide-y divide-gray-100 text-sm">
              {boughtLines.slice(0, 100).map(b => (
                <li key={b.key} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="min-w-0"><span className="block truncate">{b.label}</span><span className="block text-xs text-gray-500"><Link href={`/varejo/pedidos/${b.orderId}`} className="hover:text-brand-700">Nº {b.order}</Link> · {fmtDate(b.when)} · {b.qty} × {fmtBRL(b.price)}</span></span>
                  <span className="whitespace-nowrap text-xs text-gray-600">{b.gain === null ? 'sem custo' : `ganho ${fmtBRL(b.gain)}`}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {cfg.loyalty.enabled && (
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-900">Fidelidade</h2>
          <p className="mt-1 text-sm text-gray-700">
            {loyaltyState.mode === 'cashback' && (loyaltyState.balance > 0 ? <>Crédito de cashback: <strong>{fmtBRL(loyaltyState.balance)}</strong>{loyaltyState.nextExpiry ? ` · ${fmtBRL(loyaltyState.expiringAmount)} vence em ${fmtDate(loyaltyState.nextExpiry)}` : ''}</> : 'Sem crédito de cashback válido.')}
            {loyaltyState.mode === 'cada_x' && (loyaltyState.available > 0
              ? <>Ganhou <strong>{fmtPct(loyaltyState.pct)} de desconto</strong> na próxima compra{loyaltyState.available > 1 ? ` (${loyaltyState.available} prêmios)` : ''}.</>
              : <>Já tem {loyaltyUnitText(loyaltyState.progress, loyaltyState.unit, fmtBRL)}; falta{loyaltyState.missing === 1 && loyaltyState.unit !== 'valor' ? '' : 'm'} {loyaltyUnitText(loyaltyState.missing, loyaltyState.unit, fmtBRL)} para ganhar {fmtPct(loyaltyState.pct)}.</>)}
            {loyaltyState.mode === 'progressivo' && <>Nível atual: <strong>{fmtPct(loyaltyState.pct)}</strong> ({fmtBRL(loyaltyState.spent12m)} em 12 meses){loyaltyState.missing !== null ? `. Faltam ${fmtBRL(loyaltyState.missing)} para ${fmtPct(loyaltyState.nextPct)}.` : '.'}</>}
          </p>
          {lMsg && (
            <div className="mt-2 rounded-lg bg-gray-50 px-3 py-2">
              <p className="text-xs text-gray-500">Para avisar a cliente:</p>
              <p className="text-sm text-gray-800">{lMsg}</p>
              {lWa ? <a href={lWa} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-xs font-medium text-brand-700 hover:underline">Mandar no WhatsApp</a> : <p className="text-xs text-gray-500">Cadastre o telefone para mandar pelo WhatsApp.</p>}
            </div>
          )}
          <p className="mt-2 text-xs text-gray-500">Contam as compras pagas com a fidelidade ligada. A compra que usa o desconto também conta.</p>
        </section>
      )}

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
