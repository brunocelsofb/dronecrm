import Link from 'next/link'
import { loadDashboardInput } from '@/lib/revenue/dashboard-data'
import { computeDashboard } from '@/lib/revenue/dashboard-compute'
import { MONTHS_LONG, MONTHS_SHORT } from '@/lib/revenue/measurement'
import { getCurrentProfile } from '@/lib/auth/role'
import { Section, Kpi, RevenueGoalChart, brl, brl2, pctTxt } from '@/components/painel/painel-parts'

export const dynamic = 'force-dynamic'

export default async function PainelPage({ searchParams }: { searchParams: Promise<{ ano?: string; mes?: string; visao?: string }> }) {
  const sp = await searchParams
  const now = new Date(Date.now() - 3 * 60 * 60 * 1000) // Brasília
  const y = Number(sp.ano), m = Number(sp.mes)
  const year = Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : now.getUTCFullYear()
  const month = Number.isInteger(m) && m >= 1 && m <= 12 ? m : now.getUTCMonth() + 1

  const isYear = sp.visao === 'ano'
  const [input, profile] = await Promise.all([loadDashboardInput(year), getCurrentProfile()])
  const d = computeDashboard(input, year, month, isYear ? 'year' : 'month')
  const periodo = isYear ? `${year}` : `${MONTHS_LONG[month - 1]}/${year}`
  const noPeriodo = isYear ? `no ano de ${year}` : 'no mês'
  const rv = d.revenue
  const h = d.hunter
  const f = d.farmer
  const isAdmin = profile?.role === 'admin'

  const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 }
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 }
  const goalTone = rv.goal <= 0 ? 'neutral' : (rv.goalPct ?? 0) >= 100 ? 'good' : (rv.goalPct ?? 0) >= 80 ? 'warn' : 'bad'

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      {/* Cabeçalho e período */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Painel gerencial</h1>
          <p className="text-xs text-gray-500">Receita x meta, Hunter (novos negócios) e Farmer (carteira). Clique em qualquer indicador para ver o que compõe o número.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-sm" role="tablist" aria-label="Visão">
            <Link role="tab" aria-selected={!isYear} href={`/painel?ano=${year}&mes=${month}`} className={`rounded-md px-3 py-1 ${!isYear ? 'bg-[#1B556B] font-medium text-white' : 'text-gray-600 hover:bg-gray-50'}`}>Mês</Link>
            <Link role="tab" aria-selected={isYear} href={`/painel?visao=ano&ano=${year}&mes=${month}`} className={`rounded-md px-3 py-1 ${isYear ? 'bg-[#1B556B] font-medium text-white' : 'text-gray-600 hover:bg-gray-50'}`}>Ano consolidado</Link>
          </div>
          {isYear ? (
            <div className="flex items-center gap-1.5">
              <Link href={`/painel?visao=ano&ano=${year - 1}&mes=${month}`} className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-600 hover:bg-gray-50" aria-label="Ano anterior">‹</Link>
              <span className="px-1 text-sm font-semibold text-gray-900">{year}</span>
              <Link href={`/painel?visao=ano&ano=${year + 1}&mes=${month}`} className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-600 hover:bg-gray-50" aria-label="Próximo ano">›</Link>
            </div>
          ) : (<>
          <Link href={`/painel?ano=${prev.y}&mes=${prev.m}`} className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-600 hover:bg-gray-50" aria-label="Mês anterior">‹</Link>
          <form className="flex items-center gap-1.5" action="/painel">
            <select name="mes" defaultValue={month} className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm" aria-label="Mês">
              {MONTHS_LONG.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
            </select>
            <input name="ano" type="number" defaultValue={year} className="w-20 rounded-md border border-gray-300 px-2 py-1.5 text-sm" aria-label="Ano" />
            <button className="rounded-md bg-[#1B556B] px-3 py-1.5 text-sm font-medium text-white">Ver</button>
          </form>
          <Link href={`/painel?ano=${next.y}&mes=${next.m}`} className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-600 hover:bg-gray-50" aria-label="Próximo mês">›</Link>
          </>)}
        </div>
      </div>

      {/* ── Receita x meta ─────────────────────────────────────────── */}
      <Section title={isYear ? `Receita consolidada de ${year}` : `Receita de ${periodo}`} subtitle={isYear ? 'Soma de todos os meses do ano até hoje — recorrente + medição validada + avulso faturado' : 'Recorrente + Medição validada + Avulso faturado'}>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-gray-200 bg-white p-5 md:col-span-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{isYear ? 'Receita do ano' : 'Receita do mês'}</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums text-gray-900">{brl(rv.total)}</p>
            {rv.goal > 0 ? (
              <>
                <p className={`mt-1 text-sm font-medium ${goalTone === 'good' ? 'text-green-700' : goalTone === 'warn' ? 'text-amber-700' : 'text-red-700'}`}>
                  {pctTxt(rv.goalPct)} da meta {isYear ? 'anual' : ''} de {brl(rv.goal)}
                </p>
                {isYear && 'goalToDate' in rv && (rv.goalToDate as number) > 0 && (
                  <p className="text-xs text-gray-600">Até agora: {pctTxt(rv.goalToDatePct as number | null)} da meta acumulada ({brl(rv.goalToDate as number)})</p>
                )}
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
                  <div className="h-full rounded-full bg-[#1B556B]" style={{ width: `${Math.min(100, rv.goalPct ?? 0)}%` }} />
                </div>
                <p className="mt-1.5 text-xs text-gray-500">{rv.gap > 0 ? `Faltam ${brl(rv.gap)}` : `Meta superada em ${brl(-rv.gap)}`}</p>
              </>
            ) : (
              <p className="mt-1 text-xs text-amber-700">
                {isYear ? 'Sem metas cadastradas neste ano.' : 'Sem meta para este mês.'} {isAdmin ? <Link href={`/settings/metas?ano=${year}`} className="underline">Cadastrar metas</Link> : 'Peça ao administrador para cadastrar.'}
              </p>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-3 md:col-span-2">
            <Kpi label="$ Recorrente" value={brl(rv.recurringTotal)} hint={isYear ? `${rv.recurring.length} contrato(s) no ano` : `${rv.recurring.length} contrato(s) ativos`} lines={rv.recurring} />
            <Kpi
              label="📏 Medição"
              value={brl(rv.meteredTotal)}
              hint={<>
                {rv.measured.length} validada(s) de {rv.measured.length + rv.measurePending.length}
                {rv.lostPotential > 0 && <span className="block font-medium text-red-700">Perdemos {brl(rv.lostPotential)} do potencial ({brl(rv.meteredPotential)})</span>}
              </>}
              tone={rv.measurePending.length > 0 ? 'warn' : 'neutral'}
              lines={[...rv.measured, ...rv.measurePending.map(p => ({ ...p, value: 0, note: `⚠ ${p.note} — potencial ${brl2(p.value)}` }))]}
            />
            <Kpi label="Avulso faturado" value={brl(rv.avulsoTotal)} hint={`${rv.avulso.length} serviço(s) faturado(s) ${noPeriodo}`} lines={rv.avulso} />
          </div>
        </div>

        {isYear ? <YearTable year={year} series={d.yearSeries} /> : (
        <div className="grid gap-3 md:grid-cols-3">
          <Kpi label={`Acumulado ${year} (até ${MONTHS_SHORT[month - 1]})`} value={brl(d.ytdRevenue)} hint={d.ytdGoal > 0 ? `${pctTxt(d.ytdPct)} da meta acumulada (${brl(d.ytdGoal)})` : 'Sem metas cadastradas'} tone={d.ytdGoal > 0 && (d.ytdPct ?? 0) >= 100 ? 'good' : 'neutral'} />
          <Kpi label={`Meta anual ${year}`} value={brl(d.annualGoal)} hint="Soma das metas mensais" />
          <Kpi label="Medições pendentes" value={String(rv.measurePending.length)} hint="Sem medição validada no mês — não entram na receita" tone={rv.measurePending.length ? 'warn' : 'neutral'} lines={rv.measurePending} empty="Todas as medições do mês estão validadas." linesLabel="Ver contratos" />
        </div>
        )}

        <RevenueGoalChart series={d.yearSeries} monthLabels={MONTHS_SHORT} />
      </Section>

      {/* ── Hunter ────────────────────────────────────────────────── */}
      <Section badge="Hunter" title="Novos negócios" subtitle={`Fechamentos ${isYear ? `de ${year}` : `de ${periodo}`} nos funis de vendas e avulso`}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Taxa de conversão" value={pctTxt(h.conversion)} hint={`${h.won.length} ganha(s) de ${h.closed} fechada(s)`} lines={[...h.won.map(w => ({ ...w, note: 'ganha' })), ...h.lost.map(l => ({ ...l, note: 'perdida' }))]} linesLabel="Ver fechadas" />
          <Kpi label="Novo recorrente vendido" value={brl(h.newMrr)} hint={`Valor mensal das vendas ganhas ${noPeriodo} (entra na receita quando o contrato estiver na carteira)`} lines={h.won} />
          <Kpi label="Ticket médio (vendas)" value={brl(h.ticket)} hint="Valor ganho ÷ vendas ganhas" />
          <Kpi label="Ticket médio (avulso)" value={brl(h.avulso.ticket)} hint={`${h.avulso.won.length} avulso(s) faturado(s) · conversão ${pctTxt(h.avulso.conversion)}`} lines={h.avulso.won} />
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <TagTable title="Por serviço (tag) — vendas" rows={h.byTag} />
          <TagTable title="Por serviço (tag) — avulso" rows={h.avulso.byTag} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Funil aberto" value={brl(h.openValue)} hint={`${h.open.length} oportunidade(s) em andamento`} lines={h.open} />
          <Kpi label="Oportunidades paradas" value={String(h.stale.length)} hint="Mais tempo na etapa que o prazo (SLA) dela" tone={h.stale.length ? 'warn' : 'neutral'} lines={h.stale} empty="Nenhuma parada." />
          <Kpi label="Avulsos em andamento" value={String(h.avulso.open.length)} lines={h.avulso.open} />
          <Kpi label={isYear ? 'Leads no ano' : 'Leads no mês'} value={String(h.leadsNew)} hint={`${h.leadsConverted} já convertido(s)`} />
        </div>
      </Section>

      {/* ── Farmer ────────────────────────────────────────────────── */}
      <Section badge="Farmer" title="Carteira" subtitle="Contratos no funil de Gestão de Contratos">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Receita recorrente da carteira" value={brl(f.mrr)} hint={`${f.active.length} contrato(s) ativos · ${isYear ? 'início do ano' : 'início do mês'}: ${brl(f.mrrStart)}`} lines={f.active} />
          <Kpi
            label="Churn (rescisões)"
            value={String(f.churned.length)}
            hint={<>
              {f.churnMrr > 0 ? <span className="font-medium text-red-700">Perdemos {brl(f.churnMrr)} de receita mensal</span> : 'Nenhuma receita perdida'}
              <span className="block">Taxa: {pctTxt(f.churnRate)} dos contratos · {pctTxt(f.revenueChurnRate)} da receita</span>
            </>}
            tone={f.churned.length ? 'bad' : 'good'}
            lines={f.churned}
            empty={`Nenhuma rescisão ${noPeriodo}.`}
          />
          <Kpi
            label="Renovações"
            value={String(f.renewed.length)}
            hint={f.renewed.length ? <>
              {brl(f.renewPrev)} → {brl(f.renewNew)}{' '}
              <span className={f.renewDelta > 0 ? 'font-medium text-green-700' : f.renewDelta < 0 ? 'font-medium text-red-700' : ''}>
                ({f.renewDelta >= 0 ? '+' : ''}{brl(f.renewDelta)}{f.renewDeltaPct !== null ? ` · ${f.renewDeltaPct >= 0 ? '+' : ''}${f.renewDeltaPct}%` : ''})
              </span>
              <span className="block">▲ {f.renewUp} aumentaram · ▼ {f.renewDown} reduziram · = {f.renewFlat} mantiveram</span>
            </> : `Nenhuma renovação ${noPeriodo}`}
            tone={f.renewDelta < 0 ? 'bad' : 'neutral'}
            lines={f.renewed}
            empty={`Nenhuma renovação ${noPeriodo}.`}
          />
          <Kpi label="Taxa de renovação" value={pctTxt(f.renewalRate)} hint={`Renovados ÷ (renovados + rescindidos) ${noPeriodo}`} tone={f.renewalRate === null ? 'neutral' : f.renewalRate >= 90 ? 'good' : f.renewalRate >= 70 ? 'warn' : 'bad'} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Potencial perdido na medição" value={brl(f.lostPotential)} hint={`Valor dos contratos − medido (com glosa) ${noPeriodo}`} tone={f.lostPotential > 0 ? 'bad' : 'neutral'} />
          <Kpi label="Medições pendentes" value={String(f.measurePending.length)} hint={isYear ? `Meses sem medição validada no ano · prazo: dia ${input.measurementDueDay}` : `Prazo: dia ${input.measurementDueDay} do mês seguinte`} tone={f.measurePending.length ? 'warn' : 'neutral'} lines={f.measurePending} linesLabel="Ver contratos" empty="Nenhuma pendente." />
          <Kpi label="NPS (12 meses)" value={f.nps === null ? '—' : String(f.nps)} hint={`${f.npsAnswers} resposta(s)`} />
          <Kpi label="Chamados abertos" value={String(f.openTickets)} hint={`${f.overdueTickets} fora do prazo`} tone={f.overdueTickets ? 'warn' : 'neutral'} />
        </div>
      </Section>

      <details className="rounded-lg border border-gray-200 bg-white p-4 text-xs text-gray-600">
        <summary className="cursor-pointer font-medium text-gray-800">Como os números são calculados</summary>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          <li><strong>Recorrente:</strong> contrato ativo no funil de Gestão de Contratos no mês, pelo valor mensal vigente. Vencer sem renovar não tira da receita; só a rescisão. O mês da rescisão ainda conta.</li>
          <li><strong>Medição:</strong> só a medição validada do mês (com relatório ou aprovada pelo administrador), já descontada a glosa.</li>
          <li><strong>Avulso:</strong> serviço marcado como Faturamento (ganho) no mês, com o relatório final.</li>
          <li><strong>Conversão:</strong> ganhas ÷ (ganhas + perdidas) fechadas no mês. <strong>Ticket médio:</strong> valor ganho ÷ quantidade ganha, por tag do serviço.</li>
          <li><strong>Churn:</strong> contratos de Gestão de Contratos marcados como perdidos (rescisão) no mês, sobre a carteira do início do mês.</li>
          <li><strong>Renovação:</strong> valor mensal antes x depois, informado ao marcar Renovado.</li>
        </ul>
      </details>
    </div>
  )
}

function TagTable({ title, rows }: { title: string; rows: { tagId: string | null; name: string; color: string | null; won: number; lost: number; wonValue: number; ticket: number | null; conversion: number | null }[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <p className="border-b border-gray-100 px-4 py-2.5 text-xs font-semibold text-gray-700">{title}</p>
      {rows.length === 0 ? (
        <p className="px-4 py-3 text-xs text-gray-400">Nenhum fechamento no período.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="px-3 py-1.5 text-left font-medium">Serviço</th>
                <th className="px-3 py-1.5 text-right font-medium">Ganhas</th>
                <th className="px-3 py-1.5 text-right font-medium">Perdidas</th>
                <th className="px-3 py-1.5 text-right font-medium">Conversão</th>
                <th className="px-3 py-1.5 text-right font-medium">Ticket médio</th>
                <th className="px-3 py-1.5 text-right font-medium">Total ganho</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(r => (
                <tr key={r.tagId ?? 'none'}>
                  <td className="px-3 py-1.5">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-2 w-2 rounded-full" style={{ background: r.color ?? '#d1d5db' }} />
                      <span className={r.tagId ? 'text-gray-800' : 'italic text-gray-400'}>{r.name}</span>
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.won}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.lost}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{pctTxt(r.conversion)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{brl(r.ticket)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{brl(r.wonValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function YearTable({ year, series }: { year: number; series: { month: number; total: number | null; recurring: number | null; metered: number | null; avulso: number | null; lostPotential: number | null; pending: number | null; goal: number; goalPct: number | null }[] }) {
  const done = series.filter(s => s.total !== null)
  const sum = (k: 'total' | 'recurring' | 'metered' | 'avulso' | 'lostPotential') => done.reduce((a, s) => a + (s[k] ?? 0), 0)
  const goalDone = done.reduce((a, s) => a + s.goal, 0)
  const goalYear = series.reduce((a, s) => a + s.goal, 0)
  const tone = (p: number | null, g: number) => (g <= 0 || p === null ? 'text-gray-400' : p >= 100 ? 'text-green-700' : p >= 80 ? 'text-amber-700' : 'text-red-700')
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <p className="border-b border-gray-100 px-4 py-2.5 text-xs font-semibold text-gray-700">Mês a mês</p>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Mês</th>
              <th className="px-3 py-2 text-right font-medium">$ Recorrente</th>
              <th className="px-3 py-2 text-right font-medium">📏 Medição</th>
              <th className="px-3 py-2 text-right font-medium">Avulso</th>
              <th className="px-3 py-2 text-right font-medium">Receita total</th>
              <th className="px-3 py-2 text-right font-medium">Meta</th>
              <th className="px-3 py-2 text-right font-medium">% da meta</th>
              <th className="px-3 py-2 text-right font-medium">Perdido na medição</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {series.map(s => {
              const future = s.total === null
              return (
                <tr key={s.month} className={future ? 'text-gray-300' : ''}>
                  <td className="px-3 py-1.5">
                    {future ? MONTHS_LONG[s.month - 1] : (
                      <Link href={`/painel?ano=${year}&mes=${s.month}`} className="text-gray-800 hover:text-[#1B556B] hover:underline" title="Abrir o mês">{MONTHS_LONG[s.month - 1]}</Link>
                    )}
                    {!future && (s.pending ?? 0) > 0 && <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 text-[10px] text-amber-800">{s.pending} medição(ões) pendente(s)</span>}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{future ? '—' : brl(s.recurring)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{future ? '—' : brl(s.metered)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{future ? '—' : brl(s.avulso)}</td>
                  <td className="px-3 py-1.5 text-right font-medium tabular-nums">{future ? '—' : brl(s.total)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{s.goal > 0 ? brl(s.goal) : '—'}</td>
                  <td className={`px-3 py-1.5 text-right font-medium tabular-nums ${tone(s.goalPct, s.goal)}`}>{future || s.goal <= 0 ? '—' : pctTxt(s.goalPct)}</td>
                  <td className={`px-3 py-1.5 text-right tabular-nums ${(s.lostPotential ?? 0) > 0 ? 'text-red-700' : ''}`}>{future ? '—' : brl(s.lostPotential)}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="border-t border-gray-200 bg-gray-50 font-semibold text-gray-900">
            <tr>
              <td className="px-3 py-2">Total do ano</td>
              <td className="px-3 py-2 text-right tabular-nums">{brl(sum('recurring'))}</td>
              <td className="px-3 py-2 text-right tabular-nums">{brl(sum('metered'))}</td>
              <td className="px-3 py-2 text-right tabular-nums">{brl(sum('avulso'))}</td>
              <td className="px-3 py-2 text-right tabular-nums">{brl(sum('total'))}</td>
              <td className="px-3 py-2 text-right tabular-nums">{goalYear > 0 ? brl(goalYear) : '—'}</td>
              <td className={`px-3 py-2 text-right tabular-nums ${tone(goalDone > 0 ? Math.round((sum('total') / goalDone) * 1000) / 10 : null, goalDone)}`}>
                {goalDone > 0 ? `${pctTxt(Math.round((sum('total') / goalDone) * 1000) / 10)} até hoje` : '—'}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-red-700">{brl(sum('lostPotential'))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
