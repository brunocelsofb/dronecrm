'use client'

import { useEffect, useRef } from 'react'

declare global { interface Window { Chart: any } }

type Props = {
  totalEntradas: number
  totalLeads: number
  totalConvertidos: number
  totalVinculados: number
  totalOptOut: number
  funnelData: { label: string; value: number; color: string }[]
  historyData: { day: string; entradas: number; leads: number }[]
}

export function WhatsAppCharts({ totalEntradas, totalLeads, totalConvertidos, totalVinculados, totalOptOut, funnelData, historyData }: Props) {
  const barRef = useRef<HTMLCanvasElement>(null)
  const lineRef = useRef<HTMLCanvasElement>(null)
  const barChart = useRef<any>(null)
  const lineChart = useRef<any>(null)

  const conversionRate = totalEntradas > 0 ? Math.round((totalLeads / totalEntradas) * 100) : 0

  useEffect(() => {
    const load = () => {
      if (!window.Chart) return
      barChart.current?.destroy()
      lineChart.current?.destroy()

      if (barRef.current) {
        barChart.current = new window.Chart(barRef.current, {
          type: 'bar',
          data: {
            labels: funnelData.map(f => f.label),
            datasets: [{
              data: funnelData.map(f => f.value),
              backgroundColor: funnelData.map(f => f.color),
              borderRadius: 6,
              borderWidth: 0,
            }]
          },
          options: {
            responsive: true, maintainAspectRatio: false, indexAxis: 'y',
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c: any) => ` ${c.parsed.x} conversa${c.parsed.x !== 1 ? 's' : ''}` } } },
            scales: {
              x: { grid: { color: '#f1f3f8' }, ticks: { font: { size: 10 }, color: '#8892a4' }, border: { display: false } },
              y: { grid: { display: false }, ticks: { font: { size: 10 }, color: '#52514e' } }
            }
          }
        })
      }

      if (lineRef.current && historyData.length > 0) {
        lineChart.current = new window.Chart(lineRef.current, {
          type: 'line',
          data: {
            labels: historyData.map(h => h.day),
            datasets: [
              { label: 'Entradas', data: historyData.map(h => h.entradas), borderColor: '#1b556b', backgroundColor: 'rgba(27,85,107,0.08)', borderWidth: 2, pointRadius: 3, fill: true, tension: 0.4 },
              { label: 'Leads', data: historyData.map(h => h.leads), borderColor: '#1f8c7d', backgroundColor: 'rgba(26,124,62,0.06)', borderWidth: 2, pointRadius: 3, fill: true, tension: 0.4 },
            ]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
            scales: {
              x: { grid: { display: false }, ticks: { font: { size: 10 }, color: '#8892a4', maxTicksLimit: 7 } },
              y: { grid: { color: '#f1f3f8' }, ticks: { font: { size: 10 }, color: '#8892a4', precision: 0 }, border: { display: false } }
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
    return () => { barChart.current?.destroy(); lineChart.current?.destroy() }
  }, [funnelData, historyData])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
        {[
          { label: 'Entradas totais', value: totalEntradas, sub: 'conversas iniciadas', color: '#1a1f36' },
          { label: 'Viraram leads', value: totalLeads, sub: `${conversionRate}% de conversão`, color: '#524e9c' },
          { label: 'Convertidos', value: totalConvertidos, sub: 'viraram oportunidade', color: '#1f8c7d' },
          { label: 'Vinculados', value: totalVinculados, sub: 'em conta existente', color: '#5f38c9' },
          { label: 'Opt-out', value: totalOptOut, sub: 'pediram pra sair', color: totalOptOut > 0 ? '#8e4550' : '#8892a4' },
        ].map(k => (
          <div key={k.label} style={{ background: '#fff', borderRadius: 12, padding: '14px 16px', border: '0.5px solid #e8edf5' }}>
            <p style={{ fontSize: 10, color: '#8892a4', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 6 }}>{k.label}</p>
            <p style={{ fontSize: 22, fontWeight: 500, color: k.color, letterSpacing: '-0.5px', margin: 0 }}>{k.value}</p>
            <p style={{ fontSize: 11, color: '#8892a4', marginTop: 3 }}>{k.sub}</p>
          </div>
        ))}
      </div>

      {/* Gráficos */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 12 }}>
        <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #e8edf5', padding: 20 }}>
          <p style={{ fontSize: 13, fontWeight: 500, color: '#1a1f36', margin: 0, marginBottom: 4 }}>Funil de conversão WhatsApp</p>
          <p style={{ fontSize: 11, color: '#8892a4', marginBottom: 14 }}>Da entrada ao fechamento</p>
          {totalEntradas > 0 ? (
            <div style={{ position: 'relative', height: 160 }}>
              <canvas ref={barRef} role="img" aria-label="Funil de conversão do WhatsApp" />
            </div>
          ) : (
            <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#b0b8c8' }}>
              Sem dados ainda
            </div>
          )}
        </div>

        <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #e8edf5', padding: 20 }}>
          <p style={{ fontSize: 13, fontWeight: 500, color: '#1a1f36', margin: 0, marginBottom: 4 }}>Evolução diária</p>
          <p style={{ fontSize: 11, color: '#8892a4', marginBottom: 14 }}>Entradas vs leads gerados · últimos 14 dias</p>
          {historyData.length > 0 ? (
            <>
              <div style={{ position: 'relative', height: 140 }}>
                <canvas ref={lineRef} role="img" aria-label="Evolução diária de entradas e leads no WhatsApp" />
              </div>
              <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
                {[{ color: '#1b556b', label: 'Entradas' }, { color: '#1f8c7d', label: 'Leads' }].map(l => (
                  <span key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#8892a4' }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: l.color }} />
                    {l.label}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <div style={{ height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#b0b8c8' }}>
              Sem dados ainda
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
