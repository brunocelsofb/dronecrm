// Corpo do Painel gerencial (recebe os números prontos).

import { fmtPct, fmtNum1 } from '@/lib/format'
import Link from 'next/link'
import type { DashboardResult, DashboardInput } from '@/lib/revenue/dashboard-compute'
import { MONTHS_LONG, MONTHS_SHORT } from '@/lib/revenue/measurement'
import { Section, Kpi, RevenueHero, RevenueGoalChart, ContractVsBilled, REV_COLORS, brl, brl2, pctTxt } from '@/components/painel/painel-parts'
import { MonthPicker } from '@/components/painel/month-picker'

export function PainelView({ d, input, isAdmin, year, month, isYear, nowYear, nowMonth }: {
  d: DashboardResult
  input: Pick<DashboardInput, 'measurementDueDay'>
  isAdmin: boolean
  year: number
  month: number
  isYear: boolean
  nowYear: number
  nowMonth: number
}) {
  const rv = d.revenue
  const h = d.hunter
  const f = d.farmer
  const sel = d.selectedMonths
  const allYear = sel.length === 12

  const periodLabel = isYear
    ? (allYear ? `${year} (ano todo)` : `${sel.map(x => MONTHS_SHORT[x - 1]).join(', ')}/${year}`)
    : `${MONTHS_LONG[month - 1]}/${year}`
  const noPeriodo = isYear ? 'no período' : 'no mês'
  const currentMonthOfYear = year < nowYear ? 12 : year > nowYear ? 0 : nowMonth

  const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 }
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 }
  const goalToDate = 'goalToDate' in rv ? (rv.goalToDate as number) : 0
  const goalToDatePct = 'goalToDatePct' in rv ? (rv.goalToDatePct as number | null) : null
  const keepMeses = !allYear && isYear ? `&meses=${sel.join(',')}` : ''

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Painel gerencial</h1>
          <p className="mt-0.5 text-sm text-gray-500">{periodLabel} · clique em qualquer indicador para ver o que compõe o número</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl border border-gray-200 bg-white p-1 text-sm shadow-[0_1px_2px_rgba(16,24,40,0.04)]" role="tablist" aria-label="Visão">
            <Link role="tab" aria-selected={!isYear} href={`/painel?ano=${year}&mes=${month}`}
              className={`rounded-lg px-3.5 py-1.5 ${!isYear ? 'bg-[#1B556B] font-medium text-white' : 'text-gray-600 hover:bg-gray-50'}`}>Mês</Link>
            <Link role="tab" aria-selected={isYear} href={`/painel?visao=ano&ano=${year}`}
              className={`rounded-lg px-3.5 py-1.5 ${isYear ? 'bg-[#1B556B] font-medium text-white' : 'text-gray-600 hover:bg-gray-50'}`}>Consolidado</Link>
          </div>
          {isYear ? (
            <div className="flex items-center gap-1 rounded-xl border border-gray-200 bg-white p-1">
              <Link href={`/painel?visao=ano&ano=${year - 1}${keepMeses}`} className="rounded-lg px-2.5 py-1 text-sm text-gray-600 hover:bg-gray-50" aria-label="Ano anterior">‹</Link>
              <span className="px-2 text-sm font-semibold tabular-nums text-gray-900">{year}</span>
              <Link href={`/painel?visao=ano&ano=${year + 1}${keepMeses}`} className="rounded-lg px-2.5 py-1 text-sm text-gray-600 hover:bg-gray-50" aria-label="Próximo ano">›</Link>
            </div>
          ) : (
            <div className="flex items-center gap-1 rounded-xl border border-gray-200 bg-white p-1">
              <Link href={`/painel?ano=${prev.y}&mes=${prev.m}`} className="rounded-lg px-2.5 py-1 text-sm text-gray-600 hover:bg-gray-50" aria-label="Mês anterior">‹</Link>
              <form className="flex items-center gap-1" action="/painel">
                <select name="mes" defaultValue={month} className="rounded-lg border-0 bg-transparent px-1 py-1 text-sm font-semibold text-gray-900 focus:ring-0" aria-label="Mês">
                  {MONTHS_LONG.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
                </select>
                <input name="ano" type="number" defaultValue={year} className="w-16 rounded-lg border-0 bg-transparent px-1 py-1 text-sm font-semibold tabular-nums text-gray-900 focus:ring-0" aria-label="Ano" />
                <button className="rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200">Ver</button>
              </form>
              <Link href={`/painel?ano=${next.y}&mes=${next.m}`} className="rounded-lg px-2.5 py-1 text-sm text-gray-600 hover:bg-gray-50" aria-label="Próximo mês">›</Link>
            </div>
          )}
        </div>
      </div>

      {isYear && <MonthPicker key={`${year}-${sel.join(',')}`} year={year} selected={sel} currentMonth={currentMonthOfYear || null} />}

      {/* ── Em contrato x faturado ─────────────────────────────────── */}
      <Section title="Em contrato x faturado" subtitle={isYear ? 'Soma dos meses escolhidos — em contrato, enviado para faturamento e faturado' : 'Em contrato, enviado para faturamento e faturado no mês'}>
        <ContractVsBilled
          potential={rv.contractPotential}
          billed={rv.contractBilled}
          sent={rv.contractSent}
          invoiced={rv.contractInvoiced}
          gap={rv.contractGap}
          invoicedPct={rv.contractInvoicedPct}
          flow={rv.billingFlow}
          recurringPotential={rv.recurringPotential}
          recurringBilled={rv.recurringTotal}
          meteredPotential={rv.meteredPotential}
          meteredBilled={rv.meteredTotal}
          parts={rv.gapParts}
          periodo={isYear ? 'no período' : 'no mês'}
        />
      </Section>

      {/* ── Receita x meta ─────────────────────────────────────────── */}
      <Section title={isYear ? 'Faturado do período x meta' : `Faturado de ${MONTHS_LONG[month - 1]} x meta`} subtitle="A meta é comparada com o faturado (recorrente + medição + avulso). Abaixo, o apurado de cada tipo.">
        <div className="grid gap-3">
          <div>
            <RevenueHero
              label={isYear ? `Faturado · ${allYear ? 'ano todo' : `${sel.length} ${sel.length === 1 ? 'mês' : 'meses'}`}` : 'Faturado do mês'}
              total={rv.total}
              goal={rv.goal}
              goalPct={rv.goalPct}
              gap={rv.gap}
              extra={<>
                {rv.apuradoTotal !== rv.total && <span className="block">Apurado (ainda não todo faturado): {brl(rv.apuradoTotal)}</span>}
                {isYear && goalToDate > 0 && goalToDate !== rv.goal && <span className="block">Nos meses já fechados: {pctTxt(goalToDatePct)} da meta ({brl(goalToDate)})</span>}
              </>}
              parts={[
                { key: 'recurring', label: '$ Recorrente', value: rv.invoicedRecurring },
                { key: 'metered', label: '📏 Medição', value: rv.invoicedMetered },
                { key: 'avulso', label: 'Avulso', value: rv.invoicedAvulso },
              ]}
              noGoal={<>Sem meta {isYear ? 'nos meses escolhidos' : 'para este mês'}. {isAdmin ? <Link href={`/settings/metas?ano=${year}`} className="underline">Cadastrar metas</Link> : 'Peça ao administrador.'}</>}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Kpi accent={REV_COLORS.recurring} label="$ Recorrente (apurado)" value={brl(rv.recurringTotal)} hint={<>apurado de {brl(rv.recurringPotential)} em contrato{rv.gapParts.pendingConfirm.total > 0 ? <span className="block font-medium text-amber-700">Não confirmado: {brl(rv.gapParts.pendingConfirm.total)}</span> : null}{rv.gapParts.discounts.total > 0 ? <span className="block font-medium text-red-700">Descontos: {brl(rv.recurringPotential - rv.recurringTotal - rv.gapParts.pendingConfirm.total)}</span> : null}</>} lines={rv.recurring} />
            <Kpi
              accent={REV_COLORS.metered}
              label="📏 Medição (apurado)"
              value={brl(rv.meteredTotal)}
              hint={<>
                {rv.measured.length} validada(s) · {rv.measurePending.length} pendente(s)
                {rv.lostPotential > 0 && <span className="block font-medium text-red-700">Perdemos {brl(rv.lostPotential)} do potencial ({brl(rv.meteredPotential)})</span>}
              </>}
              tone={rv.measurePending.length > 0 ? 'warn' : 'neutral'}
              lines={[...rv.measured, ...rv.measurePending.map(p => ({ ...p, value: 0, note: `⚠ ${p.note} — potencial ${brl2(p.value)}` }))]}
            />
            <Kpi accent={REV_COLORS.avulso} label="Avulso ganho" value={brl(rv.avulsoTotal)} hint={`${rv.avulso.length} serviço(s) ${noPeriodo}`} lines={rv.avulso} />
          </div>
        </div>

        <RevenueGoalChart series={d.yearSeries} monthLabels={MONTHS_SHORT} highlight={isYear ? sel : [month]} />

        {isYear ? <YearTable year={year} series={d.yearSeries} selected={sel} /> : (
          <div className="grid gap-3 md:grid-cols-3">
            <Kpi label={`Acumulado ${year} (até ${MONTHS_SHORT[month - 1]})`} value={brl(d.ytdRevenue)} hint={d.ytdGoal > 0 ? `${pctTxt(d.ytdPct)} da meta acumulada (${brl(d.ytdGoal)})` : 'Sem metas cadastradas'} tone={d.ytdGoal > 0 ? ((d.ytdPct ?? 0) >= 100 ? 'good' : (d.ytdPct ?? 0) >= 80 ? 'warn' : 'bad') : 'neutral'} />
            <Kpi label={`Meta anual ${year}`} value={brl(d.annualGoal)} hint={<Link href={`/painel?visao=ano&ano=${year}`} className="text-[#1B556B] hover:underline">Ver consolidado do ano ›</Link>} />
            <Kpi label="Medições pendentes" value={String(rv.measurePending.length)} hint="Sem medição validada no mês — não entram na receita" tone={rv.measurePending.length ? 'warn' : 'neutral'} lines={rv.measurePending} empty="Todas as medições do mês estão validadas." linesLabel="Ver contratos" />
          </div>
        )}
      </Section>

      {/* ── Hunter ────────────────────────────────────────────────── */}
      <Section agent="hunter" title="Novos negócios" subtitle={`Fechamentos ${noPeriodo} nos funis de vendas e avulso`}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Taxa de conversão" value={pctTxt(h.conversion)} hint={`${h.won.length} ganha(s) de ${h.closed} fechada(s)`} lines={[...h.won.map(w => ({ ...w, note: 'ganha' })), ...h.lost.map(l => ({ ...l, note: 'perdida' }))]} linesLabel="Ver fechadas" />
          <Kpi label="Novo recorrente vendido" value={brl(h.newMrr)} hint="Valor mensal das vendas ganhas — entra na receita quando o contrato estiver na carteira" lines={h.won} />
          <Kpi label="Ticket médio (vendas)" value={brl(h.ticket)} hint="Valor ganho ÷ vendas ganhas" />
          <Kpi label="Ticket médio (avulso)" value={brl(h.avulso.ticket)} hint={`${h.avulso.won.length} faturado(s) · conversão ${pctTxt(h.avulso.conversion)}`} lines={h.avulso.won} />
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <TagTable title="Por serviço (tag) — vendas" rows={h.byTag} />
          <TagTable title="Por serviço (tag) — avulso" rows={h.avulso.byTag} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Funil aberto (hoje)" value={brl(h.openValue)} hint={`${h.open.length} oportunidade(s) em andamento`} lines={h.open} />
          <Kpi label="Oportunidades paradas (hoje)" value={String(h.stale.length)} hint="Mais tempo na etapa que o prazo (SLA) dela" tone={h.stale.length ? 'warn' : 'good'} lines={h.stale} empty="Nenhuma parada." />
          <Kpi label="Avulsos em andamento" value={String(h.avulso.open.length)} lines={h.avulso.open} />
          <Kpi label={`Leads ${noPeriodo}`} value={String(h.leadsNew)} hint={`${h.leadsConverted} já convertido(s)`} />
        </div>
      </Section>

      {/* ── Farmer ────────────────────────────────────────────────── */}
      <Section agent="farmer" title="Carteira" subtitle="Contratos no funil de Gestão de Contratos">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Receita recorrente da carteira" value={brl(f.mrr)} hint={`${f.active.length} contrato(s) ativos · início do período: ${brl(f.mrrStart)}`} lines={f.active} />
          <Kpi
            label="Churn (rescisões)"
            value={String(f.churned.length)}
            hint={<>
              {f.churnMrr > 0 ? <span className="font-medium text-red-700">Perdemos {brl(f.churnMrr)} de receita mensal</span> : 'Nenhuma receita perdida'}
              <span className="block">{pctTxt(f.churnRate)} dos contratos · {pctTxt(f.revenueChurnRate)} da receita</span>
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
              <span className={f.renewDelta > 0 ? 'font-medium text-emerald-700' : f.renewDelta < 0 ? 'font-medium text-red-700' : ''}>
                ({f.renewDelta >= 0 ? '+' : ''}{brl(f.renewDelta)}{f.renewDeltaPct !== null ? ` · ${fmtPct(f.renewDeltaPct, { signed: true })}` : ''})
              </span>
              <span className="block">▲ {f.renewUp} aumentaram · ▼ {f.renewDown} reduziram · = {f.renewFlat} mantiveram</span>
            </> : `Nenhuma renovação ${noPeriodo}`}
            tone={f.renewDelta < 0 ? 'bad' : f.renewDelta > 0 ? 'good' : 'neutral'}
            lines={f.renewed}
            empty={`Nenhuma renovação ${noPeriodo}.`}
          />
          <Kpi label="Taxa de renovação" value={pctTxt(f.renewalRate)} hint={`Renovados ÷ (renovados + rescindidos) ${noPeriodo}`} tone={f.renewalRate === null ? 'neutral' : f.renewalRate >= 90 ? 'good' : f.renewalRate >= 70 ? 'warn' : 'bad'} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Potencial perdido na medição" value={brl(f.lostPotential)} hint={`Valor dos contratos − medido (com glosa) ${noPeriodo}`} tone={f.lostPotential > 0 ? 'bad' : 'neutral'} />
          <Kpi label="Medições pendentes" value={String(f.measurePending.length)} hint={`Prazo: dia ${input.measurementDueDay} do mês seguinte`} tone={f.measurePending.length ? 'warn' : 'good'} lines={f.measurePending} linesLabel="Ver contratos" empty="Nenhuma pendente." />
          <Kpi label="NPS (12 meses)" value={f.nps === null ? '—' : String(f.nps)} hint={`${f.npsAnswers} resposta(s)`} tone={f.nps === null ? 'neutral' : f.nps >= 50 ? 'good' : f.nps >= 0 ? 'warn' : 'bad'} />
          <Kpi label="Chamados abertos (hoje)" value={String(f.openTickets)} hint={`${f.overdueTickets} fora do prazo`} tone={f.overdueTickets ? 'warn' : 'neutral'} />
        </div>
      </Section>

      <details className="rounded-2xl border border-gray-200 bg-white p-4 text-xs text-gray-600">
        <summary className="cursor-pointer font-medium text-gray-800">Como os números são calculados</summary>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          <li><strong>Consolidado:</strong> marque os meses que quiser (soltos ou em sequência); receita, meta, Hunter e Farmer passam a contar só esses meses.</li>
          <li><strong>Em contrato x faturado:</strong> em contrato é o valor (potencial) de todos os contratos ativos no mês. Apurado = recorrente confirmado pelo consultor (valor − desconto) + medição validada (medido − glosa). Enviado = o que o comercial mandou para faturamento (tela Financeiro). Faturado = o que voltou do sistema de faturamento (ou lançado pelo Admin). A diferença mostra de onde veio: confirmações e medições pendentes, descontos, glosas, medido abaixo, não enviado e aguardando faturamento.</li>
          <li><strong>$ Recorrente:</strong> contrato ativo no funil de Gestão de Contratos, pelo valor mensal vigente, menos os descontos do mês. Vencer sem renovar não tira da receita; só a rescisão. O mês da rescisão ainda conta.</li>
          <li><strong>📏 Medição:</strong> só a medição validada do mês (com relatório ou aprovada pelo administrador), já descontada a glosa.</li>
          <li><strong>Avulso:</strong> serviço marcado como Faturamento (ganho), com o relatório final.</li>
          <li><strong>Conversão:</strong> ganhas ÷ (ganhas + perdidas) fechadas no período. <strong>Ticket médio:</strong> valor ganho ÷ quantidade ganha, por tag.</li>
          <li><strong>Churn:</strong> contratos marcados como perdidos (rescisão) no período, sobre a carteira do início do período.</li>
          <li><strong>Renovação:</strong> valor mensal antes x depois, informado ao marcar Renovado.</li>
          <li>Indicadores marcados “hoje” (funil aberto, paradas, chamados) mostram a situação atual, não o período.</li>
        </ul>
      </details>
    </div>
  )
}

function TagTable({ title, rows }: { title: string; rows: { tagId: string | null; name: string; color: string | null; won: number; lost: number; wonValue: number; ticket: number | null; conversion: number | null }[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
      <p className="border-b border-gray-100 px-4 py-2.5 text-xs font-semibold text-gray-700">{title}</p>
      {rows.length === 0 ? (
        <p className="px-4 py-4 text-xs text-gray-400">Nenhum fechamento no período.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Serviço</th>
                <th className="px-3 py-2 text-right font-medium">Ganhas</th>
                <th className="px-3 py-2 text-right font-medium">Perdidas</th>
                <th className="px-3 py-2 text-right font-medium">Conversão</th>
                <th className="px-3 py-2 text-right font-medium">Ticket médio</th>
                <th className="px-3 py-2 text-right font-medium">Total ganho</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(r => (
                <tr key={r.tagId ?? 'none'} className="hover:bg-gray-50/60">
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-2 w-2 rounded-full" style={{ background: r.color ?? '#d1d5db' }} />
                      <span className={r.tagId ? 'text-gray-800' : 'italic text-gray-400'}>{r.name}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.won}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.lost}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{pctTxt(r.conversion)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{brl(r.ticket)}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">{brl(r.wonValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function YearTable({ year, series, selected }: {
  year: number
  selected: number[]
  series: { month: number; total: number | null; recurring: number | null; metered: number | null; avulso: number | null; lostPotential: number | null; pending: number | null; potential: number | null; billed: number | null; sent: number | null; invoiced: number | null; contractGap: number | null; goal: number; goalPct: number | null }[]
}) {
  const sel = new Set(selected)
  const rows = series.filter(s => sel.has(s.month))
  const done = rows.filter(s => s.total !== null)
  const sum = (k: 'total' | 'recurring' | 'metered' | 'avulso' | 'lostPotential' | 'potential' | 'billed' | 'sent' | 'invoiced' | 'contractGap') => done.reduce((a, s) => a + (s[k] ?? 0), 0)
  const goalSel = rows.reduce((a, s) => a + s.goal, 0)
  const goalDone = done.reduce((a, s) => a + s.goal, 0)
  const pctDone = goalDone > 0 ? Math.round((sum('total') / goalDone) * 1000) / 10 : null
  const tone = (p: number | null, g: number) => (g <= 0 || p === null ? 'text-gray-400' : p >= 100 ? 'text-emerald-700' : p >= 80 ? 'text-amber-700' : 'text-red-700')
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
        <p className="text-xs font-semibold text-gray-700">Mês a mês — meses escolhidos</p>
        <p className="text-[11px] text-gray-400">Clique no mês para abrir a visão do mês</p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Mês</th>
              <th className="px-3 py-2 text-right font-medium">Em contrato</th>
              <th className="px-3 py-2 text-right font-medium">Enviado</th>
              <th className="px-3 py-2 text-right font-medium">Faturado</th>
              <th className="px-3 py-2 text-right font-medium">Diferença</th>
              <th className="px-3 py-2 text-right font-medium">Avulso</th>
              <th className="px-3 py-2 text-right font-medium">Faturado total</th>
              <th className="px-3 py-2 text-right font-medium">Meta</th>
              <th className="px-3 py-2 text-right font-medium">% meta</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map(s => {
              const future = s.total === null
              return (
                <tr key={s.month} className={future ? 'text-gray-300' : 'hover:bg-gray-50/60'}>
                  <td className="px-3 py-2">
                    {future ? <span>{MONTHS_LONG[s.month - 1]} <span className="text-[10px]">(ainda não chegou)</span></span> : (
                      <Link href={`/painel?ano=${year}&mes=${s.month}`} className="font-medium text-gray-800 hover:text-[#1B556B] hover:underline">{MONTHS_LONG[s.month - 1]}</Link>
                    )}
                    {!future && (s.pending ?? 0) > 0 && <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-px text-[10px] text-amber-800">{s.pending} medição(ões) pendente(s)</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{future ? '—' : brl(s.potential)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-brand-700">{future ? '—' : brl(s.sent)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-positive-700">{future ? '—' : brl(s.invoiced)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${(s.contractGap ?? 0) > 0 ? 'text-red-700' : ''}`}>{future ? '—' : (s.contractGap ?? 0) > 0 ? `− ${brl(s.contractGap)}` : brl(0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{future ? '—' : brl(s.avulso)}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-gray-900">{future ? '—' : brl(s.total)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.goal > 0 ? brl(s.goal) : '—'}</td>
                  <td className={`px-3 py-2 text-right font-medium tabular-nums ${tone(s.goalPct, s.goal)}`}>{future || s.goal <= 0 ? '—' : pctTxt(s.goalPct)}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="border-t border-gray-200 bg-gray-50 font-semibold text-gray-900">
            <tr>
              <td className="px-3 py-2.5">Total do período</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{brl(sum('potential'))}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-brand-700">{brl(sum('sent'))}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-positive-700">{brl(sum('invoiced'))}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-red-700">{sum('contractGap') > 0 ? `− ${brl(sum('contractGap'))}` : brl(0)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{brl(sum('avulso'))}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{brl(sum('total'))}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{goalSel > 0 ? brl(goalSel) : '—'}</td>
              <td className={`px-3 py-2.5 text-right tabular-nums ${tone(pctDone, goalDone)}`}>{pctDone !== null ? pctTxt(pctDone) : '—'}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
