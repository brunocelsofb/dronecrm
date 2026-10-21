import Link from 'next/link'
import { redirect } from 'next/navigation'
import { hasFeature } from '@/lib/auth/access'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { fmtBRL } from '@/lib/format'
import { ORDER_STATUSES, PAID_STATUSES, formatPhone, isOrderStatus } from '@/lib/retail/customers'

export const dynamic = 'force-dynamic'

type Row = { id: string; number: number; status: string; total: number; source: string; created_at: string; retail_customers: { name: string; phone: string | null } | null }

export default async function RetailOrdersPage({ searchParams }: { searchParams: Promise<{ situacao?: string }> }) {
  if (!(await hasFeature('varejo'))) redirect('/')
  const { situacao = '' } = await searchParams
  const db = await createScopedAdmin()
  let q = db.from('retail_orders').select('id, number, status, total, source, created_at, retail_customers(name, phone)').order('created_at', { ascending: false }).limit(300)
  if (isOrderStatus(situacao)) q = q.eq('status', situacao)
  const [{ data }, { data: open }] = await Promise.all([
    q,
    db.from('retail_orders').select('status, total').in('status', ['enviado_atendimento', 'aguardando_pagamento']),
  ])
  const list = (data ?? []) as unknown as Row[]
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0)
  const { data: paidMonth } = await db.from('retail_orders').select('total').in('status', PAID_STATUSES).gte('paid_at', monthStart.toISOString())
  const sum = (rows: { total: number }[] | null) => (rows ?? []).reduce((s, r) => s + Number(r.total), 0)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Pedidos</h1>
          <p className="mt-1 text-sm text-gray-500">Pedidos da vitrine e vendas lançadas pela equipe. O estoque baixa quando o pedido vira pago.</p>
        </div>
        <Link href="/varejo/pedidos/novo" className="rounded-lg bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800">Novo pedido</Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Em atendimento" value={String((open ?? []).filter(o => o.status === 'enviado_atendimento').length)} />
        <Stat label="Aguardando pagamento" value={`${(open ?? []).filter(o => o.status === 'aguardando_pagamento').length} · ${fmtBRL(sum((open ?? []).filter(o => o.status === 'aguardando_pagamento') as { total: number }[]))}`} />
        <Stat label="Vendido no mês (pago)" value={fmtBRL(sum(paidMonth as { total: number }[] | null))} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Link href="/varejo/pedidos" className={`rounded-full px-3 py-1 text-sm ${!situacao ? 'bg-brand-700 text-white' : 'border border-gray-300 bg-white text-gray-700'}`}>Todos</Link>
        {ORDER_STATUSES.map(s => (
          <Link key={s.id} href={`/varejo/pedidos?situacao=${s.id}`} className={`rounded-full px-3 py-1 text-sm ${situacao === s.id ? 'bg-brand-700 text-white' : 'border border-gray-300 bg-white text-gray-700'}`}>{s.label}</Link>
        ))}
      </div>

      {list.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">Nenhum pedido{situacao ? ' nessa situação' : ''}.</div>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
          {list.map(o => {
            const st = ORDER_STATUSES.find(s => s.id === o.status)
            return (
              <li key={o.id}>
                <Link href={`/varejo/pedidos/${o.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-gray-50">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900">Nº {o.number} · {o.retail_customers?.name ?? 'Sem cliente'}</p>
                    <p className="text-xs text-gray-500">{new Date(o.created_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}{o.retail_customers?.phone ? ` · ${formatPhone(o.retail_customers.phone)}` : ''} · {o.source === 'vitrine' ? 'vitrine' : 'lançado pela equipe'}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded px-1.5 py-0.5 text-[11px] ${st?.style ?? ''}`}>{st?.label ?? o.status}</span>
                    <span className="text-sm font-medium text-gray-900">{fmtBRL(Number(o.total))}</span>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-gray-900">{value}</p>
    </div>
  )
}
