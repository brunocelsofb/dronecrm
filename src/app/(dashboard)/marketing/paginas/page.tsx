import Link from 'next/link'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { hasFeature } from '@/lib/auth/access'
import { requireTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { periodOf } from '@/lib/analytics/visits'
import { loadSiteReport } from '@/lib/analytics/visits-data'
import { spDate } from '@/lib/analytics/visits-server'
import { fmtBRL } from '@/lib/format'
import { PeriodTabs, StatCard, VisitsChart, SourcesTable, periodText, fmtInt, fmtDur, fmtRate } from '@/components/analytics/page-stats'
import { InstallSnippet } from '@/components/analytics/install-snippet'

export const dynamic = 'force-dynamic'

// Marketing → Páginas: estatísticas do site/LPs da empresa (código colado no site) ligadas aos
// leads e às oportunidades ganhas — visitas, únicos, abandono, tempo, conversão.
export default async function MarketingPagesPage({ searchParams }: { searchParams: Promise<{ periodo?: string; pagina?: string }> }) {
  if (!(await hasFeature('marketing'))) redirect('/')
  const sp = await searchParams
  const tenantId = await requireTenantId()
  const db = await createScopedAdmin(tenantId)
  const period = periodOf(sp.periodo, spDate())
  const [report, { data: tenant }] = await Promise.all([
    loadSiteReport(db, period, sp.pagina ?? null),
    db.from('tenants').select('slug').eq('id', tenantId).maybeSingle(),
  ])
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'app.comercialdrone.com.br'
  const origin = `${host.includes('localhost') ? 'http' : 'https'}://${host}`
  const slug = (tenant?.slug as string | null) ?? null
  const code = slug ? `<script async src="${origin}/api/t/script" data-empresa="${slug}"></script>` : ''
  const base = '/marketing/paginas'
  const extra: Record<string, string> = report.selected ? { pagina: report.selected } : {}
  const r = report
  const hasData = r.pages.length > 0
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4">
      <Link href="/marketing" className="text-sm text-brand-700 hover:underline">← Marketing</Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Páginas</h1>
          <p className="text-sm text-gray-500">Visitas do seu site e das suas LPs ligadas aos leads e às vendas. {hasData && periodText(period)}</p>
        </div>
        <PeriodTabs period={period} base={base} extra={extra} />
      </div>
      {!slug && <p className="rounded-xl bg-warn-100 p-4 text-sm text-warn-700">Sua empresa ainda não tem identificador público (slug). Peça ao administrador da plataforma para cadastrar; sem ele o código do site não sabe para qual empresa contar.</p>}
      {!hasData ? (code && <InstallSnippet code={code} />) : (
        <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
          <nav aria-label="Páginas do site" className="space-y-1">
            <Link href={`${base}?${new URLSearchParams({ periodo: period.key })}`} className={`block rounded-lg px-3 py-2 text-sm ${!r.selected ? 'bg-brand-100 font-medium text-brand-800' : 'text-gray-700 hover:bg-gray-50'}`}>Todas as páginas</Link>
            {r.pages.map(p => (
              <Link key={p.key} href={`${base}?${new URLSearchParams({ periodo: period.key, pagina: p.key })}`} className={`block rounded-lg px-3 py-2 text-sm ${r.selected === p.key ? 'bg-brand-100 font-medium text-brand-800' : 'text-gray-700 hover:bg-gray-50'}`}>
                <span className="block truncate">{p.path === '/' ? `${p.host} (início)` : p.path}</span>
                <span className="text-[11px] text-gray-500">{r.hosts.length > 1 && p.path !== '/' ? `${p.host} · ` : ''}{fmtInt(p.visits)} visita(s) · {fmtInt(p.leads)} lead(s)</span>
              </Link>
            ))}
          </nav>
          <div className="space-y-4">
            <section aria-label="Métricas da página">
              <h2 className="mb-2 text-sm font-semibold text-gray-900">Métricas da {r.selected ? 'página' : 'site'}</h2>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <StatCard label="Visitas" value={fmtInt(r.cards.visits.now)} d={r.cards.visits} />
                <StatCard label="Visitantes únicos" value={fmtInt(r.cards.uniques.now)} d={r.cards.uniques} hint="Sem cookies: a mesma pessoa conta uma vez por dia." />
                <StatCard label="Taxa de abandono" value={fmtRate(r.cards.bounce.now)} d={r.cards.bounce} lowerIsBetter hint="Saiu em menos de 10 segundos sem rolar nem clicar." />
                <StatCard label="Tempo médio" value={fmtDur(r.cards.avgMs.now)} d={r.cards.avgMs} hint="Tempo com a página aberta e visível." />
              </div>
            </section>
            <section aria-label="Resultados da página">
              <h2 className="mb-2 text-sm font-semibold text-gray-900">Resultados</h2>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                <StatCard label="Taxa de conversão" value={fmtRate(r.conversion.now)} d={r.conversion} hint="Leads ÷ visitas." />
                <StatCard label="Leads gerados" value={fmtInt(r.leads.now)} d={r.leads} hint="Leads cujo formulário foi enviado nesta página." />
                <StatCard label="Oportunidades ganhas" value={fmtInt(r.won.now)} d={r.won} hint="Dos leads do período, quantos já viraram venda ganha." />
              </div>
            </section>
            <VisitsChart days={r.days} resultLabel="Leads" />
            <div className="grid gap-4 xl:grid-cols-2">
              <SourcesTable rows={r.sources} resultLabel="Leads" />
              <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
                <table className="min-w-full text-sm">
                  <caption className="px-3 pt-3 text-left text-sm font-semibold text-gray-900">Oportunidades dos leads do período</caption>
                  <thead><tr className="text-left text-xs text-gray-500"><th className="px-3 py-2 font-medium">Lead</th><th className="px-3 py-2 font-medium">Oportunidade</th><th className="px-3 py-2 font-medium">Situação</th><th className="px-3 py-2 text-right font-medium">Valor</th></tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {r.opportunities.length === 0 && <tr><td colSpan={4} className="px-3 py-3 text-gray-500">Nenhum lead desta página virou oportunidade ainda.</td></tr>}
                    {r.opportunities.map((o, i) => (
                      <tr key={i}><td className="px-3 py-2 text-gray-900">{o.lead}</td><td className="px-3 py-2 text-gray-700">{o.title || '—'}</td>
                        <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-[11px] ${o.status === 'ganha' ? 'bg-positive-100 text-positive-700' : o.status === 'perdida' ? 'bg-negative-100 text-negative-700' : 'bg-gray-100 text-gray-600'}`}>{o.status}</span></td>
                        <td className="px-3 py-2 text-right">{o.value === null ? '—' : fmtBRL(o.value)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {code && <InstallSnippet code={code} compact />}
          </div>
        </div>
      )}
    </div>
  )
}
