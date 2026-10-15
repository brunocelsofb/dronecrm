'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { RunCard } from './kanban-board'

type Stage = { id: string; name: string; order_index: number; sla_days: number | null; pipeline_id?: string }
type Pipeline = { id: string; name: string; type: string }
type LostReason = { id: string; name: string }

function fmt(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v)
}
function daysSince(d: string | null): number {
  if (!d) return 0
  return Math.floor((Date.now() - new Date(d).getTime()) / 86400000)
}

// Paleta ORBIS
const ORBIS = {
  navy:    '#1a1f36',
  blue:    '#524e9c',
  green:   '#1f8c7d',
  amber:   '#c2683d',
  red:     '#8e4550',
  muted:   '#8892a4',
  surface: '#f1f3f8',
  white:   '#ffffff',
  border:  '#e8edf5',
}

const BAR_COLORS = ['#524e9c', '#1f8c7d', '#7c3aed', '#0891b2', '#b45309']

export function PipelineDashboard({
  stages, cards, allSalesCards, allStages, salesPipelines, lostReasons, selectedPipeline,
}: {
  pipelineId: string
  pipelineName: string
  stages: Stage[]
  cards: RunCard[]
  allSalesCards: RunCard[]
  allStages: Stage[]
  salesPipelines: Pipeline[]
  lostReasons: LostReason[]
  selectedPipeline: string
}) {
  const [activePipeline, setActivePipeline] = useState<string>('all')

  // Filtra cards conforme seleção
  const filtered = activePipeline === 'all'
    ? allSalesCards
    : allSalesCards.filter(c => {
        // Descobre o pipeline_id do run via stageId → allStages
        const st = allStages.find(s => s.id === c.stageId)
        return st?.pipeline_id === activePipeline
      })

  const open = filtered.filter(c => c.status === 'open')
  const lost = filtered.filter(c => c.status === 'lost')
  const won  = filtered.filter(c => c.status === 'won')
  const total = open.length + lost.length + won.length
  const convRate = total > 0 ? Math.round((won.length / total) * 100) : 0
  const totalPipeline = open.reduce((s, c) => s + c.value, 0)

  // Ciclo médio (dias desde abertura) — usa stageEnteredAt como proxy
  const avgCycle = open.length > 0
    ? Math.round(open.reduce((s, c) => s + daysSince(c.stageEnteredAt), 0) / open.length)
    : 0

  // Estagnadas — usa lastActivityAt (data da última atividade)
  const stagnated = open
    .map(c => ({ ...c, dias: daysSince(c.lastActivityAt ?? c.stageEnteredAt) }))
    .filter(c => c.dias >= 10)
    .sort((a, b) => b.dias - a.dias)
    .slice(0, 6)

  // Estágios relevantes para este contexto
  const ctxStages = activePipeline === 'all'
    ? allStages
    : stages

  // Negócios quentes: nas últimas 2 etapas ordenadas
  const orderedStages = [...ctxStages].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
  const lastTwo = orderedStages.slice(-2).map(s => s.id)
  const hot = open
    .filter(c => lastTwo.includes(c.stageId))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6)

  // Volume por etapa (de todos os funis agrupados por nome)
  const stageNames = activePipeline === 'all'
    ? [...new Map(allStages.map(s => [s.name, s])).values()].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
    : orderedStages
  const byStage = stageNames.map(s => {
    const matching = open.filter(c => {
      if (activePipeline === 'all') {
        return allStages.find(st => st.id === c.stageId)?.name === s.name
      }
      return c.stageId === s.id
    })
    return { name: s.name, n: matching.length, val: matching.reduce((sum, c) => sum + c.value, 0) }
  })
  const maxN = Math.max(...byStage.map(s => s.n), 1)

  // Motivos de perda
  const lostCounts: Record<string, number> = {}
  for (const c of lost) {
    const key = c.lostReasonName ?? 'Não informado'
    lostCounts[key] = (lostCounts[key] ?? 0) + 1
  }
  const lostEntries = Object.entries(lostCounts).sort((a, b) => b[1] - a[1])
  const maxLost = Math.max(...lostEntries.map(e => e[1]), 1)

  const card = (extra?: React.CSSProperties): React.CSSProperties => ({
    background: ORBIS.white, borderRadius: 12, border: `0.5px solid ${ORBIS.border}`, padding: '16px 20px', ...extra,
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Seletor de funil — visão unificada ou por funil */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button onClick={() => setActivePipeline('all')}
          style={{ padding: '5px 14px', borderRadius: 20, fontSize: 12, border: '0.5px solid', cursor: 'pointer', fontWeight: activePipeline === 'all' ? 500 : 400, background: activePipeline === 'all' ? ORBIS.navy : ORBIS.white, color: activePipeline === 'all' ? '#fff' : ORBIS.muted, borderColor: activePipeline === 'all' ? ORBIS.navy : ORBIS.border }}>
          Todos os funis
        </button>
        {salesPipelines.map(p => (
          <button key={p.id} onClick={() => setActivePipeline(p.id)}
            style={{ padding: '5px 14px', borderRadius: 20, fontSize: 12, border: '0.5px solid', cursor: 'pointer', fontWeight: activePipeline === p.id ? 500 : 400, background: activePipeline === p.id ? ORBIS.navy : ORBIS.white, color: activePipeline === p.id ? '#fff' : ORBIS.muted, borderColor: activePipeline === p.id ? ORBIS.navy : ORBIS.border }}>
            {p.name}
          </button>
        ))}
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
        {[
          { label: 'Valor em pipeline', value: fmt(totalPipeline), sub: `${open.length} oportunidades abertas`, accent: ORBIS.blue },
          { label: 'Taxa de conversão', value: `${convRate}%`, sub: `${won.length} ganhas · ${lost.length} perdidas`, accent: convRate >= 20 ? ORBIS.green : ORBIS.amber },
          { label: 'Estagnadas +10d', value: String(stagnated.length), sub: 'sem atividade recente', accent: stagnated.length > 0 ? ORBIS.amber : ORBIS.green },
          { label: 'Ciclo médio', value: `${avgCycle}d`, sub: 'desde entrada na etapa', accent: ORBIS.navy },
        ].map(k => (
          <div key={k.label} style={{ ...card(), padding: '14px 16px', borderLeft: `3px solid ${k.accent}` }}>
            <p style={{ fontSize: 10, color: ORBIS.muted, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 6 }}>{k.label}</p>
            <p style={{ fontSize: 24, fontWeight: 500, color: ORBIS.navy, letterSpacing: '-0.5px', margin: 0 }}>{k.value}</p>
            <p style={{ fontSize: 11, color: ORBIS.muted, marginTop: 4 }}>{k.sub}</p>
          </div>
        ))}
      </div>

      {/* Funil + Motivos de perda */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 14 }}>

        {/* Barras por etapa */}
        <div style={card()}>
          <p style={{ fontSize: 13, fontWeight: 500, color: ORBIS.navy, marginBottom: 16 }}>
            Volume por etapa
            <span style={{ fontSize: 11, color: ORBIS.muted, fontWeight: 400, marginLeft: 6 }}>oportunidades abertas · valor</span>
          </p>
          {byStage.length === 0 && <p style={{ fontSize: 12, color: ORBIS.muted }}>Nenhuma etapa encontrada.</p>}
          {byStage.map((s, i) => {
            const pct = s.n > 0 ? Math.round((s.n / maxN) * 100) : 0
            const nextN = byStage[i + 1]?.n ?? 0
            const passRate = s.n > 0 && i < byStage.length - 1
              ? Math.round((nextN / s.n) * 100) : null
            return (
              <div key={s.name} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 11, color: '#52514e', minWidth: 110 }}>{s.name}</span>
                  {passRate !== null && (
                    <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20, background: '#e8e7f4', color: ORBIS.blue }}>{passRate}% avançam</span>
                  )}
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: ORBIS.muted }}>
                    {s.n} · {fmt(s.val)}
                  </span>
                </div>
                <div style={{ height: 10, background: ORBIS.surface, borderRadius: 5, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: BAR_COLORS[i % BAR_COLORS.length], borderRadius: 5, transition: 'width 0.4s' }} />
                </div>
              </div>
            )
          })}
        </div>

        {/* Motivos de perda */}
        <div style={card()}>
          <p style={{ fontSize: 13, fontWeight: 500, color: ORBIS.navy, marginBottom: lost.length === 0 ? 8 : 16 }}>
            Motivos de perda
            <span style={{ fontSize: 11, color: ORBIS.muted, fontWeight: 400, marginLeft: 4 }}>({lost.length})</span>
          </p>
          {lost.length === 0 && <p style={{ fontSize: 12, color: ORBIS.muted }}>Nenhuma perda no período.</p>}
          {lostEntries.map(([name, count], i) => (
            <div key={name} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{ fontSize: 11, color: '#52514e' }}>{name}</span>
                <span style={{ fontSize: 11, fontWeight: 500, color: ORBIS.navy }}>{count}</span>
              </div>
              <div style={{ height: 6, background: ORBIS.surface, borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.round((count / maxLost) * 100)}%`, background: ORBIS.red, borderRadius: 3, transition: 'width 0.4s' }} />
              </div>
            </div>
          ))}
          {lostEntries.length === 0 && lostReasons.length > 0 && (
            <p style={{ fontSize: 11, color: ORBIS.muted, marginTop: 4 }}>Configure os motivos em Configurações.</p>
          )}
        </div>
      </div>

      {/* Estagnadas + Quentes */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>

        <div style={card()}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <p style={{ fontSize: 13, fontWeight: 500, color: ORBIS.navy, margin: 0 }}>⚠ Estagnadas</p>
            <span style={{ fontSize: 10, padding: '2px 9px', borderRadius: 20, background: '#fbeee5', color: ORBIS.amber }}>sem atividade +10 dias</span>
          </div>
          {stagnated.length === 0 && <p style={{ fontSize: 12, color: ORBIS.muted }}>Nenhuma estagnada. Ótimo!</p>}
          {stagnated.map(c => (
            <div key={c.runId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: `0.5px solid ${ORBIS.surface}` }}>
              <div>
                <Link href={`/contracts/${c.contractId}`} style={{ fontSize: 12, fontWeight: 500, color: ORBIS.navy, textDecoration: 'none' }}>
                  {c.clientName || c.title || c.processNumber}
                </Link>
                <p style={{ fontSize: 10, color: ORBIS.muted, marginTop: 2 }}>
                  {(activePipeline === 'all' ? allStages : ctxStages).find(s => s.id === c.stageId)?.name ?? '—'} · {c.dias}d sem atividade
                </p>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <p style={{ fontSize: 12, color: ORBIS.navy, margin: 0 }}>{fmt(c.value)}</p>
                <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 20, background: '#fbeee5', color: ORBIS.amber }}>{c.dias}d</span>
              </div>
            </div>
          ))}
        </div>

        <div style={card()}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <p style={{ fontSize: 13, fontWeight: 500, color: ORBIS.navy, margin: 0 }}>🔥 Negócios quentes</p>
            <span style={{ fontSize: 10, padding: '2px 9px', borderRadius: 20, background: '#e3f5f1', color: ORBIS.green }}>alto valor · etapa final</span>
          </div>
          {hot.length === 0 && <p style={{ fontSize: 12, color: ORBIS.muted }}>Nenhum nas etapas finais ainda.</p>}
          {hot.map(c => (
            <div key={c.runId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: `0.5px solid ${ORBIS.surface}` }}>
              <div>
                <Link href={`/contracts/${c.contractId}`} style={{ fontSize: 12, fontWeight: 500, color: ORBIS.navy, textDecoration: 'none' }}>
                  {c.clientName || c.title || c.processNumber}
                </Link>
                <p style={{ fontSize: 10, color: ORBIS.muted, marginTop: 2 }}>
                  {(activePipeline === 'all' ? allStages : ctxStages).find(s => s.id === c.stageId)?.name ?? '—'}
                </p>
              </div>
              <p style={{ fontSize: 13, fontWeight: 500, color: ORBIS.green, margin: 0 }}>{fmt(c.value)}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
