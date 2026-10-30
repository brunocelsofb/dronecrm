import { redirect } from 'next/navigation'
import { hasFeature } from '@/lib/auth/access'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { periodOf } from '@/lib/analytics/visits'
import { loadStoreReport } from '@/lib/analytics/visits-data'
import { spDate } from '@/lib/analytics/visits-server'
import { fmtBRL } from '@/lib/format'
import { SectionTabs, CUSTOMER_TABS } from '@/components/retail/section-tabs'
import { PeriodTabs, StatCard, VisitsChart, SourcesTable, periodText, fmtInt, fmtDur, fmtRate } from '@/components/analytics/page-stats'

export const dynamic = 'force-dynamic'

// Varejo → Visitas da vitrine: quantas pessoas abriram a loja, por onde chegaram e quantas fizeram pedido
export default async function StoreVisitsPage({ searchParams }: { searchParams: Promise<{ periodo?: string }> }) {
  if (!(await hasFeature('varejo'))) redirect('/')
  const sp = await searchParams
  const db = await createScopedAdmin()
  const period = periodOf(sp.periodo, spDate())
  const r = await loadStoreReport(db, period)
  const empty = (r.cards.visits.now ?? 0) === 0 && (r.cards.visits.before ?? 0) === 0
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <SectionTabs tabs={CUSTOMER_TABS} active="/varejo/visitas" />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Visitas da vitrine</h1>
          <p className="text-sm text-gray-600">Quantas pessoas abriram a loja, por onde chegaram e quantas fizeram pedido. {!empty && periodText(period)}</p>
        </div>
        <PeriodTabs period={period} base="/varejo/visitas" />
      </div>
      {empty ? (
        <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-600">Ainda não há visitas contadas. A contagem começou agora: cada vez que alguém abre a vitrine, aparece aqui em segundos. Não precisa instalar nada.</p>
      ) : (
        <>
          <section aria-label="Métricas da vitrine">
            <h2 className="mb-2 text-sm font-semibold text-gray-900">Métricas da vitrine</h2>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <StatCard label="Visitas" value={fmtInt(r.cards.visits.now)} d={r.cards.visits} />
              <StatCard label="Visitantes únicos" value={fmtInt(r.cards.uniques.now)} d={r.cards.uniques} hint="Sem cookies: a mesma pessoa conta uma vez por dia." />
              <StatCard label="Taxa de abandono" value={fmtRate(r.cards.bounce.now)} d={r.cards.bounce} lowerIsBetter hint="Saiu em menos de 10 segundos sem rolar nem clicar." />
              <StatCard label="Tempo médio" value={fmtDur(r.cards.avgMs.now)} d={r.cards.avgMs} hint="Tempo com a loja aberta e visível." />
            </div>
          </section>
          <section aria-label="Resultados da vitrine">
            <h2 className="mb-2 text-sm font-semibold text-gray-900">Resultados</h2>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <StatCard label="Taxa de conversão" value={fmtRate(r.conversion.now)} d={r.conversion} hint="Pedidos ÷ visitas." />
              <StatCard label="Pedidos" value={fmtInt(r.orders.now)} d={r.orders} hint="Pedidos enviados pela vitrine (sem os cancelados)." />
              <StatCard label="Pedidos pagos" value={fmtInt(r.paid.now)} d={r.paid} />
              <StatCard label="Vendido (pago, sem frete)" value={fmtBRL(r.sold.now)} d={r.sold} />
            </div>
          </section>
          <VisitsChart days={r.days} resultLabel="Pedidos" />
          <div className="grid gap-4 lg:grid-cols-2">
            <SourcesTable rows={r.sources} />
            <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
              <table className="min-w-full text-sm">
                <caption className="px-3 pt-3 text-left text-sm font-semibold text-gray-900">Campanhas (link da campanha)</caption>
                <thead><tr className="text-left text-xs text-gray-500"><th className="px-3 py-2 font-medium">Campanha</th><th className="px-3 py-2 text-right font-medium">Visitas</th><th className="px-3 py-2 text-right font-medium">Pedidos</th></tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {r.campaigns.length === 0 && <tr><td colSpan={3} className="px-3 py-3 text-gray-500">Nenhuma visita pelo link de campanha no período.</td></tr>}
                  {r.campaigns.map(c => <tr key={c.name}><td className="px-3 py-2 text-gray-900">{c.name}</td><td className="px-3 py-2 text-right">{fmtInt(c.visits)}</td><td className="px-3 py-2 text-right">{fmtInt(c.orders)}</td></tr>)}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
