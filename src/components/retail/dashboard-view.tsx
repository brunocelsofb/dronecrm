// Painel do Varejo: blocos (só exibição; os dados vêm de lib/retail/dashboard.ts)

import Link from 'next/link'
import type { ReactNode } from 'react'
import { fmtBRL, fmtPct } from '@/lib/format'
import { birthdayLabel, birthdayMessage, formatPhone, orderStatusLabel, whatsappLink } from '@/lib/retail/customers'
import type { RetailDashboard } from '@/lib/retail/dashboard'
import type { DashboardBlockId } from '@/lib/retail/dashboard-blocks'
import { requiredMarginPct } from '@/lib/retail/margin'

const fmtDay = (iso: string | null) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—')
const daysAgo = (iso: string, now: Date) => Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / 86_400_000))

function Card({ title, children, href, hrefLabel, wide }: { title: string; children: ReactNode; href?: string; hrefLabel?: string; wide?: boolean }) {
  return (
    <section className={`flex flex-col rounded-xl border border-gray-200 bg-white p-4 ${wide ? 'lg:col-span-2' : ''}`}>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {href && <Link href={href} className="shrink-0 text-xs text-brand-700 hover:underline">{hrefLabel ?? 'Ver tudo'}</Link>}
      </div>
      <div className="flex-1">{children}</div>
    </section>
  )
}

const Empty = ({ children }: { children: ReactNode }) => <p className="text-sm text-gray-500">{children}</p>

export function RetailDashboardView({ d, blocks, storeName, now = new Date() }: { d: RetailDashboard; blocks: DashboardBlockId[]; storeName: string; now?: Date }) {
  const pricingSet = d.pricing.fixed_monthly > 0 || d.pricing.tax_pct + d.pricing.card_pct + d.pricing.other_pct > 0

  const render: Record<DashboardBlockId, () => ReactNode> = {
    vendas: () => d.sales && (
      <Card key="vendas" title={`Vendas de ${d.month.label}`} href="/varejo/pedidos" hrefLabel="Pedidos">
        <p className="text-3xl font-semibold text-gray-900">{fmtBRL(d.sales.revenue)}</p>
        <p className="mt-1 text-sm text-gray-600">{d.sales.orders} pedido(s) pago(s) · valor médio {fmtBRL(d.sales.avgTicket)}</p>
        <p className={`mt-2 text-xs ${d.sales.revenueChange === null ? 'text-gray-500' : d.sales.revenueChange >= 0 ? 'text-positive-700' : 'text-warn-700'}`}>
          {d.sales.revenueChange === null ? `Mês passado, até o dia ${d.month.day}: sem vendas pagas.` : `${fmtPct(d.sales.revenueChange, { signed: true })} contra o mês passado até o dia ${d.month.day} (${fmtBRL(d.sales.prevRevenue)}).`}
        </p>
        <p className="mt-1 text-xs text-gray-400">Valor das peças, sem frete.</p>
      </Card>
    ),
    equilibrio: () => (
      <Card key="equilibrio" title="Ponto de equilíbrio do mês" href="/varejo/precificacao" hrefLabel="Ajustar custos">
        {!d.breakEven ? (
          <Empty>Informe os custos fixos do mês em Custos e preço para ver quanto falta vender para pagar as contas.</Empty>
        ) : (
          <>
            <div className="h-3 overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-valuenow={Math.round(d.breakEven.pct)} aria-valuemin={0} aria-valuemax={100}>
              <div className={`h-full rounded-full ${d.breakEven.reached ? 'bg-positive-600' : 'bg-warn-600'}`} style={{ width: `${Math.max(2, d.breakEven.pct)}%` }} />
            </div>
            <p className="mt-2 text-sm text-gray-700">O ganho do mês já pagou <strong>{fmtBRL(d.breakEven.covered)}</strong> de {fmtBRL(d.breakEven.fixed)} ({fmtPct(d.breakEven.pct)}).</p>
            {d.breakEven.reached ? (
              <p className="mt-2 rounded-lg bg-positive-100 px-3 py-2 text-sm text-positive-700">Contas do mês pagas. Daqui para frente, o ganho é lucro.</p>
            ) : (
              <p className="mt-2 rounded-lg bg-warn-100 px-3 py-2 text-sm text-warn-700">
                Faltam cerca de <strong>{fmtBRL(d.breakEven.missingRevenue)}</strong> em vendas
                {d.breakEven.perDayRevenue !== null ? <> ({fmtBRL(d.breakEven.perDayRevenue)} por dia até o fim do mês)</> : null}.
              </p>
            )}
            <p className="mt-2 text-xs text-gray-500">No ritmo atual, o mês fecha com {fmtBRL(d.breakEven.projectedContribution)} de ganho. Conta feita com a margem real das vendas do mês{d.sales?.revenue ? '' : ' (sem vendas ainda: usa a margem desejada)'}.</p>
          </>
        )}
      </Card>
    ),
    ganho: () => d.sales && (
      <Card key="ganho" title="Ganho e margem do mês">
        <p className={`text-3xl font-semibold ${d.sales.contribution < 0 ? 'text-negative-700' : 'text-gray-900'}`}>{fmtBRL(d.sales.contribution)}</p>
        <p className="mt-1 text-sm text-gray-600">margem {fmtPct(d.sales.marginPct)} · necessária {fmtPct(requiredMarginPct(d.pricing))} (fixos + lucro)</p>
        <p className="mt-2 text-xs text-gray-500">O que sobrou das vendas depois do custo das peças, impostos, taxas e fidelidade. Paga os custos fixos e o resto é lucro.</p>
        {d.sales.missingCostUnits > 0 && <p className="mt-2 text-xs text-warn-700">{d.sales.missingCostUnits} peça(s) vendida(s) sem custo cadastrado: o ganho real é menor.</p>}
        {!pricingSet && <p className="mt-2 text-xs text-gray-500">Impostos e taxas ainda não informados em <Link href="/varejo/precificacao" className="text-brand-700 hover:underline">Custos e preço</Link>.</p>}
      </Card>
    ),
    pedidos_abertos: () => d.open && (
      <Card key="pedidos_abertos" title={`Pedidos esperando (${d.open.count})`} href="/varejo/pedidos">
        {d.open.list.length === 0 ? <Empty>Nenhum pedido esperando. Tudo em dia.</Empty> : (
          <ul className="divide-y divide-gray-100 text-sm">
            {d.open.list.map(o => {
              const age = daysAgo(o.created_at, now)
              return (
                <li key={o.id}>
                  <Link href={`/varejo/pedidos/${o.id}`} className="flex items-center justify-between gap-2 py-2 hover:text-brand-700">
                    <span className="min-w-0">
                      <span className="block truncate">Nº {o.number} · {o.customer ?? 'sem cliente'}</span>
                      <span className={`block text-xs ${age >= 2 ? 'text-warn-700' : 'text-gray-500'}`}>{orderStatusLabel(o.status)} · {age === 0 ? 'hoje' : `há ${age} dia(s)`}</span>
                    </span>
                    <span className="whitespace-nowrap">{fmtBRL(o.total)}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    ),
    aniversarios: () => d.birthdays && (
      <Card key="aniversarios" title="Aniversariantes (7 dias)" href="/varejo/clientes?situacao=aniversario">
        {d.birthdays.length === 0 ? <Empty>Ninguém faz aniversário nos próximos 7 dias.</Empty> : (
          <ul className="divide-y divide-gray-100 text-sm">
            {d.birthdays.map(c => {
              const wa = c.info.daysUntil === 0 ? whatsappLink(c.phone, birthdayMessage(c.name, storeName)) : null
              return (
                <li key={c.id} className="flex items-center justify-between gap-2 py-2">
                  <span className="min-w-0">
                    <Link href={`/varejo/clientes/${c.id}`} className="block truncate hover:text-brand-700">{c.name}</Link>
                    <span className={`block text-xs ${c.info.daysUntil === 0 ? 'font-medium text-accent-purple' : 'text-gray-500'}`}>{birthdayLabel(c.info)}</span>
                  </span>
                  {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="shrink-0 rounded-lg bg-brand-700 px-2.5 py-1 text-xs font-medium text-white">Parabéns</a>}
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    ),
    inativas: () => d.inactive && (
      <Card key="inativas" title={`Clientes para reativar (${d.inactive.count})`} href="/varejo/clientes?situacao=inativa">
        {d.inactive.list.length === 0 ? <Empty>Nenhuma cliente inativa.</Empty> : (
          <ul className="divide-y divide-gray-100 text-sm">
            {d.inactive.list.map(c => (
              <li key={c.id} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <Link href={`/varejo/clientes/${c.id}`} className="block truncate hover:text-brand-700">{c.name}</Link>
                  <span className="block text-xs text-gray-500">última compra {fmtDay(c.last)} · {formatPhone(c.phone)}{c.optin ? '' : ' · sem autorização de ofertas'}</span>
                </span>
                <span className="whitespace-nowrap text-gray-700">{fmtBRL(c.total)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-gray-500">Ordenadas por quanto já compraram. Ofertas só para quem autorizou (LGPD).</p>
      </Card>
    ),
    mais_vendidas: () => d.topSellers && (
      <Card key="mais_vendidas" title="Mais vendidas no mês" href="/varejo/produtos" hrefLabel="Produtos">
        {d.topSellers.length === 0 ? <Empty>Nenhuma venda paga neste mês ainda.</Empty> : (
          <ol className="space-y-2 text-sm">
            {d.topSellers.map((t, i) => {
              const max = d.topSellers![0].qty || 1
              return (
                <li key={t.name + i}>
                  <div className="flex justify-between gap-2"><span className="truncate">{i + 1}. {t.name}</span><span className="whitespace-nowrap text-gray-600">{t.qty} un. · {fmtBRL(t.revenue)}</span></div>
                  <div className="mt-1 h-1.5 rounded-full bg-gray-100"><div className="h-full rounded-full bg-brand-700/70" style={{ width: `${(t.qty / max) * 100}%` }} /></div>
                </li>
              )
            })}
          </ol>
        )}
      </Card>
    ),
    estoque: () => d.stock && (
      <Card key="estoque" title="Estoque" href="/varejo/produtos?situacao=publicado" hrefLabel="Produtos">
        {d.stock.soldOut.length === 0 && d.stock.lowCombos === 0 ? <Empty>Nenhuma peça publicada esgotada.</Empty> : (
          <>
            {d.stock.soldOut.length > 0 && (
              <>
                <p className="text-sm text-warn-700">{d.stock.soldOut.length} peça(s) publicada(s) esgotada(s):</p>
                <ul className="mt-1 space-y-1 text-sm">
                  {d.stock.soldOut.map(p => <li key={p.id}><Link href={`/varejo/produtos/${p.id}#estoque`} className="hover:text-brand-700">{p.name} <span className="text-xs text-gray-500">({p.code})</span></Link></li>)}
                </ul>
              </>
            )}
            {d.stock.lowCombos > 0 && <p className="mt-2 text-sm text-gray-700">{d.stock.lowCombos} combinação(ões) de cor e tamanho com 1 unidade.</p>}
          </>
        )}
      </Card>
    ),
    fidelidade: () => d.loyaltyStats && (
      <Card key="fidelidade" title="Fidelidade" href="/varejo/precificacao" hrefLabel="Configurar">
        {d.loyaltyStats.mode === 'off' ? <Empty>Fidelidade desligada.</Empty> : d.loyaltyStats.mode === 'cashback' ? (
          <ul className="space-y-1 text-sm text-gray-700">
            <li>Cashback gerado no mês: <strong>{fmtBRL(d.loyaltyStats.earned)}</strong></li>
            <li>Usado em compras no mês: <strong>{fmtBRL(d.loyaltyStats.used)}</strong></li>
            <li>{d.loyaltyStats.withBalance} cliente(s) com crédito para usar</li>
            {d.loyaltyStats.expiringCustomers > 0 && <li className="text-warn-700">{d.loyaltyStats.expiringCustomers} cliente(s) com {fmtBRL(d.loyaltyStats.expiringAmount)} vencendo em até 15 dias: bom motivo para chamar.</li>}
          </ul>
        ) : (
          <ul className="space-y-1 text-sm text-gray-700">
            <li>{d.loyaltyStats.withBenefit} cliente(s) com desconto disponível</li>
            <li>Descontos de fidelidade dados no mês: <strong>{fmtBRL(d.loyaltyStats.given)}</strong></li>
          </ul>
        )}
      </Card>
    ),
    sem_custo: () => d.noCost && (
      <Card key="sem_custo" title={`Peças sem custo (${d.noCost.count})`} href="/varejo/produtos">
        {d.noCost.count === 0 ? <Empty>Todas as peças publicadas têm custo. A margem está completa.</Empty> : (
          <>
            <ul className="space-y-1 text-sm">
              {d.noCost.list.map(p => <li key={p.id}><Link href={`/varejo/produtos/${p.id}`} className="hover:text-brand-700">{p.name} <span className="text-xs text-gray-500">({p.code})</span></Link></li>)}
            </ul>
            <p className="mt-2 text-xs text-gray-500">Sem custo, o painel não sabe quanto essas vendas deixam.</p>
          </>
        )}
      </Card>
    ),
  }

  if (!blocks.length) return <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">Nenhum bloco escolhido. Toque em &quot;Escolher blocos&quot;.</div>
  return <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">{blocks.map(b => render[b]())}</div>
}
