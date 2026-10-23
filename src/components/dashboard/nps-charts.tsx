'use client'

import { useEffect, useRef } from 'react'

declare global { interface Window { Chart: any } }

type Props = {
  nps: number | null
  promoters: number
  passives: number
  detractors: number
  total: number
  history: { month: string; nps: number | null; total: number }[]
}

export function NpsCharts({ nps, promoters, passives, detractors, total, history }: Props) {
  const donutRef = useRef<HTMLCanvasElement>(null)
  const lineRef = useRef<HTMLCanvasElement>(null)
  const donutChart = useRef<any>(null)
  const lineChart = useRef<any>(null)

  const npsColor = nps === null ? '#d1d8e8' : nps >= 50 ? '#1f8c7d' : nps >= 0 ? '#f59e0b' : '#ef4444'
  const npsLabel = nps === null ? 'Sem dados' : nps >= 75 ? 'Excelente' : nps >= 50 ? 'Ótimo' : nps >= 0 ? 'Bom' : 'Crítico'

  useEffect(() => {
    const load = () => {
      if (!window.Chart) return

      donutChart.current?.destroy()
      lineChart.current?.destroy()

      if (donutRef.current && total > 0) {
        donutChart.current = new window.Chart(donutRef.current, {
          type: 'doughnut',
          data: {
            labels: ['Promotores', 'Neutros', 'Detratores'],
            datasets: [{ data: [promoters, passives, detractors], backgroundColor: ['#1f8c7d', '#f59e0b', '#ef4444'], borderWidth: 0, hoverOffset: 4 }]
          },
          options: { responsive: true, maintainAspectRatio: false, cutout: '70%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c: any) => `${c.label}: ${c.parsed}` } } } }
        })
      }

      if (lineRef.current && history.length > 0) {
        lineChart.current = new window.Chart(lineRef.current, {
          type: 'line',
          data: {
            labels: history.map(h => h.month),
            datasets: [
              { label: 'NPS', data: history.map(h => h.nps), borderColor: '#1b556b', backgroundColor: 'rgba(27,85,107,0.08)', borderWidth: 2, pointRadius: 4, pointBackgroundColor: '#1b556b', fill: true, tension: 0.4, spanGaps: true },
              { label: 'Respostas', data: history.map(h => h.total), borderColor: '#e8edf5', borderWidth: 1.5, borderDash: [4, 4], pointRadius: 0, fill: false, tension: 0, yAxisID: 'y2' },
            ]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
            scales: {
              x: { grid: { display: false }, ticks: { font: { size: 10 }, color: '#8892a4' } },
              y: { grid: { color: '#f1f3f8' }, ticks: { font: { size: 10 }, color: '#8892a4' }, border: { display: false }, suggestedMin: -100, suggestedMax: 100 },
              y2: { display: false, position: 'right' }
            }
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
    return () => { donutChart.current?.destroy(); lineChart.current?.destroy() }
  }, [nps, promoters, passives, detractors, total, history])

  return (
    <div className="grid grid-cols-1 md:[grid-template-columns:1fr_1.6fr]" style={{ gap: 12 }}>
      {/* Score e Donut */}
      <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #e8edf5', padding: 20 }}>
        <p style={{ fontSize: 10, color: '#8892a4', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 12 }}>NPS do período</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{ position: 'relative', width: 110, height: 110, flexShrink: 0 }}>
            {total > 0 ? (
              <canvas ref={donutRef} role="img" aria-label={`Distribuição: ${promoters} promotores, ${passives} neutros, ${detractors} detratores`} />
            ) : (
              <div style={{ width: 110, height: 110, borderRadius: '50%', background: '#f1f3f8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#b0b8c8' }}>sem dados</div>
            )}
            {total > 0 && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                <span style={{ fontSize: 22, fontWeight: 500, color: npsColor, letterSpacing: '-1px' }}>{nps ?? '—'}</span>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div>
              <p style={{ fontSize: 18, fontWeight: 500, color: npsColor, margin: 0, letterSpacing: '-0.5px' }}>{npsLabel}</p>
              <p style={{ fontSize: 11, color: '#8892a4', marginTop: 2 }}>{total} resposta{total !== 1 ? 's' : ''}</p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {[
                { label: 'Promotores', value: promoters, color: '#1f8c7d', bg: '#e3f5f1' },
                { label: 'Neutros', value: passives, color: '#c2683d', bg: '#fbeee5' },
                { label: 'Detratores', value: detractors, color: '#8e4550', bg: '#f6e9ea' },
              ].map(item => (
                <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: item.color, flexShrink: 0 }} />
                  <span style={{ color: '#52514e' }}>{item.label}</span>
                  <span style={{ marginLeft: 'auto', fontWeight: 500, padding: '1px 6px', borderRadius: 20, background: item.bg, color: item.color }}>{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Evolução */}
      <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #e8edf5', padding: 20 }}>
        <p style={{ fontSize: 10, color: '#8892a4', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 4 }}>Evolução do NPS</p>
        <p style={{ fontSize: 11, color: '#b0b8c8', marginBottom: 14 }}>Últimos 6 meses</p>
        {history.length > 0 ? (
          <div style={{ position: 'relative', height: 130 }}>
            <canvas ref={lineRef} role="img" aria-label="Evolução do NPS nos últimos 6 meses" />
          </div>
        ) : (
          <div style={{ height: 130, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#b0b8c8' }}>
            Sem histórico suficiente
          </div>
        )}
      </div>
    </div>
  )
}
