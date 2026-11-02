'use client'
// Painel gerencial · Carteira e Novos negócios:
//   • Mapa da receita recorrente por estado (mais escuro = mais receita), com ranking e lista de contratos
//   • Receita recorrente da carteira por serviço, mês a mês (barras empilhadas)
//   • Novo recorrente vendido por mês (valor e quantidade)
// Tudo calculado com os dados da empresa no CRM (dashboard-compute).

import { useMemo, useState } from 'react'
import Link from 'next/link'
import brazil from '@svg-maps/brazil'
import { fmtBRL, fmtPct } from '@/lib/format'
import type { ContractLine } from '@/lib/revenue/dashboard-compute'

const compact = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', minimumFractionDigits: 0, maximumFractionDigits: 1 }).format(v)

// Escala sequencial só com cores da paleta (claro → escuro)
const RAMP = ['#83D0F5', '#00AFD1', '#1B556B', '#0e2933'] as const
const NO_DATA = '#e9eef0'
// Serviços sem cor própria: cores da paleta, em ordem
const SERIES = ['#1B556B', '#32AF9D', '#E98C5F', '#524E9C', '#00AFD1', '#AF5B65', '#83D0F5', '#FFE596'] as const

// Teto "redondo" para o eixo (1, 2, 2,5 ou 5 × 10^n)
function niceMax(v: number): number {
  if (v <= 0) return 1
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p
  return 10 * p
}

type UfRow = { uf: string; name: string; mrr: number; count: number; share: number | null; lines: ContractLine[] }

// ── Mapa ─────────────────────────────────────────────────────────────────────
export function UfMap({ rows, noUf, noUfMrr, total }: { rows: UfRow[]; noUf: ContractLine[]; noUfMrr: number; total: number }) {
  const byUf = useMemo(() => new Map(rows.map(r => [r.uf, r])), [rows])
  const [sel, setSel] = useState<string | null>(rows[0]?.uf ?? null)
  const [hover, setHover] = useState<string | null>(null)
  // Faixas por posição no ranking (estados com receita), para o mapa não ficar "todo claro" com um estado muito maior
  const bucketOf = useMemo(() => {
    const sorted = [...rows].sort((a, b) => a.mrr - b.mrr)
    const m = new Map<string, number>()
    sorted.forEach((r, i) => m.set(r.uf, sorted.length === 1 ? RAMP.length - 1 : Math.min(RAMP.length - 1, Math.floor((i / (sorted.length - 1)) * (RAMP.length - 1) + 0.5))))
    return m
  }, [rows])
  const focus = hover ?? sel
  const cur = focus ? byUf.get(focus) ?? null : null
  const max = Math.max(1, ...rows.map(r => r.mrr))

  if (!rows.length && !noUf.length) {
    return <p className="rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-sm text-gray-500">Nenhum contrato ativo na carteira.</p>
  }

  return (
    <div className="grid gap-4 rounded-2xl border border-gray-200 bg-white p-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-gray-900">Receita recorrente por estado</p>
        <p className="text-xs text-gray-500">{rows.length} {rows.length === 1 ? 'estado' : 'estados'} com contrato ativo · passe o mouse ou clique no estado</p>
        <svg viewBox={brazil.viewBox} className="mx-auto mt-2 h-auto w-full max-w-md" role="img" aria-label="Mapa do Brasil com a receita recorrente por estado">
          {(brazil.locations as { id: string; name: string; path: string }[]).map(loc => {
            const uf = loc.id.toUpperCase()
            const r = byUf.get(uf)
            const fill = r ? RAMP[bucketOf.get(uf) ?? 0] : NO_DATA
            const active = focus === uf
            return (
              <path key={loc.id} d={loc.path} fill={fill} stroke={active ? '#E98C5F' : '#ffffff'} strokeWidth={active ? 2.5 : 1}
                className={r ? 'cursor-pointer' : ''} tabIndex={r ? 0 : -1} aria-label={r ? `${r.name}: ${fmtBRL(r.mrr)}` : loc.name}
                onMouseEnter={() => setHover(uf)} onMouseLeave={() => setHover(null)}
                onClick={() => r && setSel(uf)} onKeyDown={e => { if (r && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setSel(uf) } }}>
                <title>{r ? `${r.name}: ${fmtBRL(r.mrr)} · ${r.count} contrato(s) · ${fmtPct(r.share)} da carteira` : `${loc.name}: sem contrato ativo`}</title>
              </path>
            )
          })}
        </svg>
        <div className="mt-2 flex items-center justify-center gap-2 text-[11px] text-gray-500">
          <span>menos</span>
          {RAMP.map(c => <span key={c} className="h-2.5 w-6 rounded-sm" style={{ background: c }} />)}
          <span>mais receita</span>
          <span className="ml-2 inline-flex items-center gap-1"><span className="h-2.5 w-4 rounded-sm border border-gray-200" style={{ background: NO_DATA }} />sem contrato</span>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        {cur ? (
          <div className="rounded-xl bg-brand-100 p-3">
            <p className="text-xs font-medium text-brand-700">{cur.name}</p>
            <p className="text-xl font-semibold tabular-nums text-brand-900">{fmtBRL(cur.mrr)}<span className="text-xs font-normal text-gray-500"> /mês</span></p>
            <p className="text-xs text-gray-600">{cur.count} contrato(s) · {fmtPct(cur.share)} da receita recorrente</p>
            <ul className="mt-2 max-h-32 space-y-0.5 overflow-y-auto text-xs">
              {cur.lines.map(l => (
                <li key={l.contractId} className="flex justify-between gap-2">
                  <Link href={`/contracts/${l.contractId}`} className="min-w-0 truncate text-gray-700 hover:text-brand-700 hover:underline">{l.client}{l.number ? ` · ${l.number}` : ''}</Link>
                  <span className="shrink-0 tabular-nums text-gray-600">{fmtBRL(l.value)}</span>
                </li>
              ))}
            </ul>
            <Link href={`/carteira?uf=${cur.uf}`} className="mt-2 inline-block text-xs font-medium text-brand-700 hover:underline">Ver na Gestão de Carteira ›</Link>
          </div>
        ) : (
          <p className="rounded-xl bg-gray-50 p-3 text-xs text-gray-500">Escolha um estado no mapa.</p>
        )}

        <ol className="space-y-1.5">
          {rows.map((r, i) => (
            <li key={r.uf}>
              <button type="button" onClick={() => setSel(r.uf)} onMouseEnter={() => setHover(r.uf)} onMouseLeave={() => setHover(null)}
                className={`grid w-full grid-cols-[1.25rem_2rem_minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-1.5 py-1 text-left text-xs ${focus === r.uf ? 'bg-gray-50' : 'hover:bg-gray-50'}`}>
                <span className="tabular-nums text-gray-400">{i + 1}</span>
                <span className="font-semibold text-gray-800">{r.uf}</span>
                <span className="h-2 overflow-hidden rounded-full bg-gray-100"><span className="block h-full rounded-full bg-brand-700" style={{ width: `${(r.mrr / max) * 100}%` }} /></span>
                <span className="tabular-nums text-gray-700">{compact(r.mrr)} · {fmtPct(r.share)}</span>
              </button>
            </li>
          ))}
        </ol>

        {noUf.length > 0 && (
          <details className="rounded-xl border border-warn-100 bg-warn-100/50 p-3 text-xs text-warn-700">
            <summary className="cursor-pointer font-medium">Sem estado: {noUf.length} contrato(s) · {fmtBRL(noUfMrr)} ({fmtPct(total > 0 ? Math.round((noUfMrr / total) * 1000) / 10 : null)})</summary>
            <p className="mt-1 text-gray-600">Preencha o estado (UF) no contrato ou na empresa para aparecer no mapa.</p>
            <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto">
              {noUf.map(l => <li key={l.contractId}><Link href={`/contracts/${l.contractId}`} className="text-gray-700 hover:underline">{l.client}{l.number ? ` · ${l.number}` : ''}</Link></li>)}
            </ul>
          </details>
        )}
        <p className="mt-auto text-[10px] text-gray-400">Mapa: svg-maps/brazil (CC BY 4.0)</p>
      </div>
    </div>
  )
}

// ── Receita recorrente por serviço, mês a mês ────────────────────────────────
type TagMeta = { id: string; name: string; color: string | null }
export function MrrByServiceChart({ tags, months, labels, highlight }: {
  tags: TagMeta[]; months: ({ month: number; total: number; parts: Record<string, number> } | null)[]; labels: string[]; highlight?: number[]
}) {
  const colorOf = new Map(tags.map((t, i) => [t.id, t.id === '—' ? '#9ca3af' : t.color || SERIES[i % SERIES.length]]))
  const top = niceMax(Math.max(0, ...months.map(m => m?.total ?? 0)))
  const W = 720, H = 230, padL = 64, padR = 8, padT = 10, padB = 24
  const bw = (W - padL - padR) / 12
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / top)
  const hl = highlight ? new Set(highlight) : null
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <p className="text-sm font-semibold text-gray-900">Receita recorrente da carteira por serviço</p>
      <p className="mb-2 text-xs text-gray-500">Valor mensal dos contratos ativos no fim de cada mês, pelo serviço (tag) do contrato</p>
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
        {tags.map(t => <span key={t.id} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: colorOf.get(t.id) }} />{t.name}</span>)}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Receita recorrente por serviço, mês a mês">
        {[0, 0.25, 0.5, 0.75, 1].map(f => (
          <g key={f}>
            <line x1={padL} x2={W - padR} y1={y(top * f)} y2={y(top * f)} stroke="#eef1f3" />
            <text x={padL - 6} y={y(top * f) + 4} textAnchor="end" fontSize={10.5} fill="#6b7280">{compact(top * f)}</text>
          </g>
        ))}
        {months.map((m, i) => {
          const x = padL + i * bw
          const barW = Math.min(30, bw * 0.6)
          const bx = x + (bw - barW) / 2
          const dim = hl ? !hl.has(i + 1) : false
          let acc = 0
          return (
            <g key={i} opacity={dim ? 0.3 : 1}>
              {m && (
                <title>{`${labels[i]}: ${fmtBRL(m.total)}\n${tags.filter(t => (m.parts[t.id] ?? 0) > 0).map(t => `${t.name}: ${fmtBRL(m.parts[t.id])}`).join('\n')}`}</title>
              )}
              <rect x={x} y={padT} width={bw} height={H - padT - padB} fill="transparent" />
              {m && tags.map(t => {
                const v = m.parts[t.id] ?? 0
                if (v <= 0) return null
                const y0 = y(acc), y1 = y(acc + v)
                acc += v
                return <rect key={t.id} x={bx} y={y1} width={barW} height={Math.max(0, y0 - y1 - 1)} fill={colorOf.get(t.id)} />
              })}
              <text x={x + bw / 2} y={H - 7} textAnchor="middle" fontSize={11} fill={m ? '#4b5563' : '#c4c9cf'} fontWeight={m && !dim ? 600 : 400}>{labels[i]}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ── Novo recorrente vendido por mês ──────────────────────────────────────────
export function NewMrrChart({ months, labels, highlight }: {
  months: { month: number; value: number; count: number; lines: ContractLine[] }[]; labels: string[]; highlight?: number[]
}) {
  const top = niceMax(Math.max(0, ...months.map(m => m.value)))
  const W = 720, H = 230, padL = 64, padR = 8, padT = 26, padB = 24
  const bw = (W - padL - padR) / 12
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / top)
  const hl = highlight ? new Set(highlight) : null
  const total = months.reduce((a, m) => a + m.value, 0)
  const count = months.reduce((a, m) => a + m.count, 0)
  const withSales = months.filter(m => m.count > 0).length
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-gray-900">Novo recorrente vendido por mês</p>
          <p className="text-xs text-gray-500">Valor mensal das vendas ganhas no mês; o número em cima é a quantidade de contratos</p>
        </div>
        <p className="text-xs text-gray-600">No ano: <b className="tabular-nums text-gray-900">{fmtBRL(total)}</b> em {count} contrato(s){withSales ? <> · média de {fmtBRL(total / withSales)} nos meses com venda</> : null}</p>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-auto w-full" role="img" aria-label="Novo recorrente vendido por mês">
        {[0, 0.25, 0.5, 0.75, 1].map(f => (
          <g key={f}>
            <line x1={padL} x2={W - padR} y1={y(top * f)} y2={y(top * f)} stroke="#eef1f3" />
            <text x={padL - 6} y={y(top * f) + 4} textAnchor="end" fontSize={10.5} fill="#6b7280">{compact(top * f)}</text>
          </g>
        ))}
        {months.map((m, i) => {
          const x = padL + i * bw
          const barW = Math.min(30, bw * 0.6)
          const bx = x + (bw - barW) / 2
          const dim = hl ? !hl.has(i + 1) : false
          return (
            <g key={i} opacity={dim ? 0.3 : 1}>
              <title>{`${labels[i]}: ${fmtBRL(m.value)} em ${m.count} contrato(s)${m.lines.length ? `\n${m.lines.map(l => `${l.client}: ${fmtBRL(l.value)}`).join('\n')}` : ''}`}</title>
              <rect x={x} y={padT} width={bw} height={H - padT - padB} fill="transparent" />
              {m.value > 0 && <rect x={bx} y={y(m.value)} width={barW} height={Math.max(0, y(0) - y(m.value))} rx={3} fill="#1B556B" />}
              {m.count > 0 && <text x={x + bw / 2} y={y(m.value) - 6} textAnchor="middle" fontSize={11} fontWeight={700} fill="#E98C5F">{m.count}</text>}
              <text x={x + bw / 2} y={H - 7} textAnchor="middle" fontSize={11} fill="#4b5563" fontWeight={dim ? 400 : 600}>{labels[i]}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
