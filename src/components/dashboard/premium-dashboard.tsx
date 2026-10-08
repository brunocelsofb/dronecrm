'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'

type KPI = { receita: number; meta: number; ticketMedio: number; ticketDelta: number | null; cicloMedio: number | null; churnPct: number | null; mrrCarteira?: number }
type FunnelStage = { label: string; value: number; count: number }
type MonthSeries = { month: string; realizado: number; meta: number }
type LeadSource = { label: string; pct: number }
type TeamMember = { initials: string; name: string; activities: number; revenue: number }

declare global { interface Window { Chart: any } }

// Paleta secundária oficial para gráficos
const CHART_COLORS = ['#E98C5F', '#32AF9D', '#83D0F5', '#524E9C']

function fmt(v: number) {
  if (v >= 1000) return 'R$ ' + Math.round(v / 1000) + 'k'
  return 'R$ ' + Math.round(v).toLocaleString('pt-BR')
}

function fmtFull(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v)
}

export function PremiumDashboard({ kpi, funnel, series, leadSources, team, period = 'month' }: {
  kpi: KPI
  funnel: FunnelStage[]
  series: MonthSeries[]
  leadSources: LeadSource[]
  team: TeamMember[]
  period?: string
}) {
  const areaRef = useRef<HTMLCanvasElement>(null)
  const donutRef = useRef<HTMLCanvasElement>(null)
  const areaChart = useRef<any>(null)
  const donutChart = useRef<any>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const load = () => {
      if (!window.Chart) return
      if (areaRef.current) {
        areaChart.current?.destroy()
        areaChart.current = new window.Chart(areaRef.current, {
          type: 'line',
          data: {
            labels: series.map(s => s.month),
            datasets: [
              { label: 'Meta', data: series.map(s => s.meta), borderColor: '#83D0F5', borderDash: [4, 4], borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0 },
              { label: 'Faturamento', data: series.map(s => s.realizado), borderColor: '#E98C5F', borderWidth: 2, pointRadius: 3, pointBackgroundColor: '#E98C5F', fill: true, backgroundColor: 'rgba(233,140,95,0.10)', tension: 0.4 },
            ]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false, callbacks: { label: (c: any) => c.dataset.label + ': ' + fmtFull(c.parsed.y) } } },
            scales: {
              x: { grid: { display: false }, ticks: { font: { size: 10 }, color: '#9ca3af' } },
              y: { grid: { color: '#f3f4f6' }, ticks: { font: { size: 10 }, color: '#9ca3af', callback: (v: number) => fmt(v) }, border: { display: false } }
            }
          }
        })
      }
      if (donutRef.current) {
        donutChart.current?.destroy()
        donutChart.current = new window.Chart(donutRef.current, {
          type: 'doughnut',
          data: {
            labels: leadSources.map(l => l.label),
            datasets: [{ data: leadSources.map(l => l.pct), backgroundColor: CHART_COLORS.slice(0, leadSources.length), borderWidth: 0, hoverOffset: 4 }]
          },
          options: {
            responsive: true, maintainAspectRatio: false, cutout: '68%',
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c: any) => c.label + ': ' + c.parsed + '%' } } }
          }
        })
      }
    }
    if (window.Chart) { load() } else {
      const s = document.createElement('script')
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js'
      s.onload = load
      document.head.appendChild(s)
    }
    return () => { areaChart.current?.destroy(); donutChart.current?.destroy() }
  }, [series, leadSources])

  const metaPct = kpi.meta > 0 ? Math.min(100, Math.round((kpi.receita / kpi.meta) * 100)) : 0
  const maxFunnelValue = funnel[0]?.value ?? 1

  const AVATAR_BG = ['bg-indigo-50', 'bg-teal-50', 'bg-red-50']
  const AVATAR_TEXT = ['text-indigo-700', 'text-teal-700', 'text-red-700']

  return (
    <div className="flex flex-col gap-5">

      {/* ── Header + Filtros de período ── */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-lg font-semibold text-[#1B556B] tracking-tight">Visão Geral Comercial</p>
          <p className="text-xs text-gray-400 mt-0.5">
            Atualizado agora · {new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
          </p>
        </div>
        <div className="flex gap-1.5 bg-gray-100 rounded-2xl p-1">
          {[
            { label: 'Semana', value: 'week' },
            { label: 'Este Mês', value: 'month' },
            { label: 'Trimestre', value: 'quarter' },
            { label: 'Ano', value: 'year' },
          ].map((f) => (
            <Link
              key={f.value}
              href={`/?period=${f.value}`}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-xl transition-all no-underline
                ${period === f.value
                  ? 'bg-[#1B556B] text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
                }`}
            >
              {f.label}
            </Link>
          ))}
        </div>
      </div>

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-4 gap-4">

        {/* Card em destaque: Ganhos */}
        <div className="rounded-3xl p-5 shadow-[0_4px_24px_rgba(27,85,107,0.18)] bg-gradient-to-br from-[#1B556B] to-[#0e3a4a] col-span-1">
          <p className="text-xs font-medium uppercase tracking-wider text-white/60 mb-3">Ganhos no período</p>
          <p className="text-3xl font-bold text-white tracking-tight">{fmt(kpi.receita)}</p>
          <div className="h-1.5 bg-white/20 rounded-full mt-4 overflow-hidden">
            <div
              className="h-full rounded-full bg-[#E98C5F] transition-all"
              style={{ width: `${metaPct}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-white/50 mt-1.5">
            <span>{metaPct}% da meta</span>
            <span>{fmt(kpi.meta)}</span>
          </div>
        </div>

        {/* MRR Carteira */}
        <div className="rounded-3xl p-5 bg-white shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
          <p className="text-xs font-medium uppercase tracking-wider text-gray-500 mb-3">MRR Carteira</p>
          <p className="text-3xl font-bold text-[#1B556B] tracking-tight">{kpi.mrrCarteira ? fmt(kpi.mrrCarteira) : '—'}</p>
          <p className="text-xs text-gray-400 mt-2">contratos ativos em gestão</p>
        </div>

        {/* Ticket Médio */}
        <div className="rounded-3xl p-5 bg-white shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
          <p className="text-xs font-medium uppercase tracking-wider text-gray-500 mb-3">Ticket Médio</p>
          <p className="text-3xl font-bold text-[#1B556B] tracking-tight">{kpi.ticketMedio > 0 ? fmt(kpi.ticketMedio) : '—'}</p>
          {kpi.cicloMedio !== null && (
            <p className="text-xs text-gray-400 mt-2">Ciclo médio: {kpi.cicloMedio} dias</p>
          )}
        </div>

        {/* Churn */}
        <div className="rounded-3xl p-5 bg-white shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
          <p className="text-xs font-medium uppercase tracking-wider text-gray-500 mb-3">Churn no período</p>
          <p className="text-3xl font-bold text-[#1B556B] tracking-tight">{kpi.churnPct !== null ? `${kpi.churnPct}%` : '—'}</p>
          {kpi.churnPct !== null && kpi.churnPct > 3 && (
            <span className="inline-flex items-center gap-1 text-xs mt-2 px-2.5 py-1 rounded-xl bg-[#FFE596] text-amber-800 font-medium">
              ⚠ atenção
            </span>
          )}
        </div>
      </div>

      {/* ── Gráficos centrais ── */}
      <div className="grid grid-cols-[1.4fr_1fr] gap-4">

        {/* Funil de Vendas */}
        <div className="rounded-3xl p-6 bg-white shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
          <p className="text-sm font-semibold text-[#1B556B] mb-0.5">Funil de Vendas</p>
          <p className="text-xs text-gray-400 mb-5">Volume por etapa · oportunidades ativas</p>

          <div className="flex flex-col gap-3">
            {funnel.map((f, i) => (
              <div key={f.label} className="flex items-center gap-3">
                <span className="text-xs text-gray-400 w-20 shrink-0">{f.label}</span>
                <div className="flex-1 h-6 bg-gray-100 rounded-lg overflow-hidden">
                  <div
                    className="h-full rounded-lg flex items-center pl-2.5 text-xs font-semibold text-white transition-all"
                    style={{
                      width: `${maxFunnelValue > 0 ? Math.round((f.value / maxFunnelValue) * 100) : 0}%`,
                      background: CHART_COLORS[i] ?? CHART_COLORS[3],
                      minWidth: f.value > 0 ? 40 : 0,
                    }}
                  >
                    {f.value > 0 ? fmt(f.value) : ''}
                  </div>
                </div>
                <span className="text-xs text-gray-400 w-6 text-right shrink-0">{f.count}</span>
              </div>
            ))}
            {funnel.length === 0 && (
              <p className="text-xs text-gray-400">Nenhuma oportunidade aberta.</p>
            )}
          </div>

          {funnel.length > 0 && (
            <div className="flex flex-wrap gap-3 mt-4">
              {funnel.map((f, i) => (
                <span key={f.label} className="flex items-center gap-1.5 text-xs text-gray-400">
                  <span className="w-2 h-2 rounded-sm" style={{ background: CHART_COLORS[i] ?? CHART_COLORS[3] }} />
                  {f.label}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Evolução Financeira */}
        <div className="rounded-3xl p-6 bg-white shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
          <p className="text-sm font-semibold text-[#1B556B] mb-0.5">Evolução Financeira</p>
          <p className="text-xs text-gray-400 mb-5">Faturamento vs meta · últimos 6 meses</p>
          <div className="relative h-44">
            <canvas ref={areaRef} role="img" aria-label="Gráfico de área comparando faturamento e meta mensal" />
          </div>
          <div className="flex gap-4 mt-3">
            <span className="flex items-center gap-1.5 text-xs text-gray-400">
              <span className="w-5 h-0.5 rounded" style={{ background: '#E98C5F', display: 'inline-block' }} />
              Faturamento
            </span>
            <span className="flex items-center gap-1.5 text-xs text-gray-400">
              <span className="w-5 border-t border-dashed border-[#83D0F5]" />
              Meta
            </span>
          </div>
        </div>
      </div>

      {/* ── Linha inferior ── */}
      <div className="grid grid-cols-2 gap-4">

        {/* Origem dos Leads */}
        <div className="rounded-3xl p-6 bg-white shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
          <p className="text-sm font-semibold text-[#1B556B] mb-0.5">Origem dos Leads</p>
          <p className="text-xs text-gray-400 mb-5">Distribuição por canal de aquisição</p>
          {leadSources.length > 0 ? (
            <div className="flex items-center gap-6">
              <div className="relative w-28 h-28 shrink-0">
                <canvas ref={donutRef} role="img" aria-label="Gráfico de rosca com origem dos leads" />
              </div>
              <div className="flex flex-col gap-2.5">
                {leadSources.map((l, i) => (
                  <div key={l.label} className="flex items-center gap-2 text-xs">
                    <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: CHART_COLORS[i] ?? CHART_COLORS[3] }} />
                    <span className="text-gray-700">{l.label}</span>
                    <span className="text-gray-400 ml-auto pl-3 font-medium">{l.pct}%</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-gray-400">Sem dados de origem ainda.</p>
          )}
        </div>

        {/* Ranking da Equipe */}
        <div className="rounded-3xl p-6 bg-white shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
          <p className="text-sm font-semibold text-[#1B556B] mb-0.5">Ranking da Equipe</p>
          <p className="text-xs text-gray-400 mb-5">Produtividade comercial · período atual</p>
          {team.length === 0 && (
            <p className="text-xs text-gray-400">Sem dados de equipe ainda.</p>
          )}
          <div className="flex flex-col divide-y divide-gray-50">
            {team.map((m, i) => (
              <div key={m.name} className="flex items-center gap-3 py-2.5">
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-lg ${i === 0 ? 'bg-[#FFE596] text-amber-800' : 'bg-gray-100 text-gray-500'}`}>
                  #{i + 1}
                </span>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${AVATAR_BG[i] ?? 'bg-gray-100'} ${AVATAR_TEXT[i] ?? 'text-gray-600'}`}>
                  {m.initials}
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-800 leading-tight">{m.name}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{m.activities} atividades</p>
                </div>
                <p className="text-xs font-bold text-[#1B556B] ml-auto">{fmt(m.revenue)}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

    </div>
  )
}
