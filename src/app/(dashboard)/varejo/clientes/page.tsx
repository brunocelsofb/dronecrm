import Link from 'next/link'
import { SectionTabs, CUSTOMER_TABS } from '@/components/retail/section-tabs'
import { redirect } from 'next/navigation'
import { hasFeature } from '@/lib/auth/access'
import { requireTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { fmtBRL } from '@/lib/format'
import { CUSTOMER_STATUS, birthdayInfo, birthdayLabel, customerStatus, daysSince, formatPhone, mergeStats, todayInBrazil, type CustomerStatus } from '@/lib/retail/customers'
import { loadCustomerOrderStats, loadRetailSettings } from '@/lib/retail/queries'
import { CustomerImport, InactiveDaysForm } from '@/components/retail/customer-tools'

export const dynamic = 'force-dynamic'

type Row = {
  id: string; name: string; phone: string | null; email: string | null; city: string | null; whatsapp_optin: boolean; birth_date: string | null
  legacy_last_purchase_at: string | null; legacy_total: number | null; legacy_orders: number | null
}

const TABS: { id: '' | CustomerStatus | 'aniversario'; label: string }[] = [
  { id: '', label: 'Todas' }, { id: 'ativa', label: 'Ativas' }, { id: 'inativa', label: 'Inativas' }, { id: 'sem_compra', label: 'Sem compra' }, { id: 'aniversario', label: 'Aniversariantes' },
]

const fmtDate = (d: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('pt-BR') : '—')

export default async function RetailCustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; situacao?: string }> }) {
  const access = await hasFeature('varejo')
  if (!access) redirect('/')
  const { q = '', situacao = '' } = await searchParams
  const tenantId = await requireTenantId()
  const db = await createScopedAdmin(tenantId)
  const [settings, stats, { data }] = await Promise.all([
    loadRetailSettings(db, tenantId),
    loadCustomerOrderStats(db),
    db.from('retail_customers').select('id, name, phone, email, city, whatsapp_optin, birth_date, legacy_last_purchase_at, legacy_total, legacy_orders').order('name').limit(5000),
  ])
  const now = new Date()
  const rows = ((data ?? []) as Row[]).map(c => {
    const s = mergeStats(stats.get(c.id), c)
    return { ...c, stats: s, status: customerStatus(s.last, settings.inactive_days, now), bday: birthdayInfo(c.birth_date, now) }
  })
  const count = (st: CustomerStatus) => rows.filter(r => r.status === st).length
  const term = q.trim().toLowerCase()
  const digits = q.replace(/\D/g, '')
  const list = rows
    .filter(r => (situacao === 'aniversario' ? (r.bday !== null && r.bday.daysUntil <= 30) : (!situacao || r.status === situacao)) && (!term || r.name.toLowerCase().includes(term) || (digits.length >= 3 && (r.phone ?? '').includes(digits))))
    .sort((a, b) => situacao === 'inativa' ? (a.stats.last ?? '').localeCompare(b.stats.last ?? '')
      : situacao === 'aniversario' ? (a.bday?.daysUntil ?? 999) - (b.bday?.daysUntil ?? 999) : 0)
  const month = todayInBrazil(now).m
  const bdayMonth = rows.filter(r => r.bday?.month === month).length
  const bdayToday = rows.filter(r => r.bday?.daysUntil === 0).length

  return (
    <div className="space-y-5">
      <SectionTabs tabs={CUSTOMER_TABS} active="/varejo/clientes" />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Clientes</h1>
          <p className="mt-1 text-sm text-gray-500">Quem compra, quem continua comprando e quem está inativa (mais de {settings.inactive_days} dias sem comprar).</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href="/api/varejo/modelo-clientes" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">Baixar planilha-modelo</a>
          <CustomerImport />
          <Link href="/varejo/clientes/nova" className="rounded-lg bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800">Nova cliente</Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Clientes" value={String(rows.length)} />
        <Stat label="Ativas" value={String(count('ativa'))} />
        <Stat label="Inativas" value={String(count('inativa'))} tone={count('inativa') ? 'warn' : undefined} />
        <Stat label="Sem compra" value={String(count('sem_compra'))} />
        <Stat label={bdayToday ? `Aniversários no mês · ${bdayToday} hoje` : 'Aniversários no mês'} value={String(bdayMonth)} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {TABS.map(t => (
          <Link key={t.id} href={{ pathname: '/varejo/clientes', query: { ...(t.id ? { situacao: t.id } : {}), ...(q ? { q } : {}) } }}
            className={`rounded-full px-3 py-1 text-sm ${situacao === t.id ? 'bg-brand-700 text-white' : 'border border-gray-300 bg-white text-gray-700'}`}>{t.label}</Link>
        ))}
        <form method="get" className="ml-auto flex gap-2">
          {situacao && <input type="hidden" name="situacao" value={situacao} />}
          <input name="q" defaultValue={q} placeholder="Nome ou telefone" className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
        </form>
      </div>

      {list.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          {rows.length === 0 ? 'Nenhuma cliente cadastrada. Cadastre, importe a planilha ou lance um pedido.' : 'Nenhuma cliente nesse filtro.'}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr><th className="px-3 py-2">Cliente</th><th className="px-3 py-2">Contato</th><th className="px-3 py-2">Aniversário</th><th className="px-3 py-2">Última compra</th><th className="px-3 py-2 text-right">Compras</th><th className="px-3 py-2 text-right">Total</th><th className="px-3 py-2">Situação</th></tr>
            </thead>
            <tbody>
              {list.map(r => {
                const ago = daysSince(r.stats.last, now)
                return (
                  <tr key={r.id} className="border-t border-gray-100">
                    <td className="px-3 py-2"><Link href={`/varejo/clientes/${r.id}`} className="font-medium text-gray-900 hover:text-brand-700">{r.name}</Link> <Link href={`/varejo/clientes/${r.id}#cadastro`} className="ml-1 text-xs text-brand-700 hover:underline">editar</Link>{r.city && <span className="block text-xs text-gray-500">{r.city}</span>}{birthdayLabel(r.bday) && <span className={`block text-xs ${r.bday?.daysUntil === 0 ? 'font-medium text-accent-purple' : 'text-gray-500'}`}>{birthdayLabel(r.bday)}</span>}</td>
                    <td className="px-3 py-2 text-gray-700"><span className="block whitespace-nowrap">{formatPhone(r.phone)}</span>{r.email ? <span className="block text-xs text-gray-500">{r.email}</span> : <span className="block text-xs text-warn-700">sem e-mail</span>}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-gray-700">{r.birth_date ? `${r.birth_date.slice(8, 10)}/${r.birth_date.slice(5, 7)}` : <span className="text-xs text-gray-400">—</span>}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-gray-700">{fmtDate(r.stats.last)}{ago !== null && <span className="block text-xs text-gray-500">há {ago} dia(s)</span>}</td>
                    <td className="px-3 py-2 text-right text-gray-700">{r.stats.orders}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap text-gray-900">{fmtBRL(r.stats.total)}</td>
                    <td className="px-3 py-2"><span className={`rounded px-1.5 py-0.5 text-[11px] ${CUSTOMER_STATUS[r.status].style}`}>{CUSTOMER_STATUS[r.status].label}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {access.isAdmin && <InactiveDaysForm initial={settings.inactive_days} />}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <div className={`rounded-xl border p-3 ${tone === 'warn' ? 'border-warn-600/40 bg-warn-100' : 'border-gray-200 bg-white'}`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${tone === 'warn' ? 'text-warn-700' : 'text-gray-900'}`}>{value}</p>
    </div>
  )
}
