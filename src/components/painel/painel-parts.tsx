// Peças do Painel gerencial (Server Components, sem JS no navegador).
// Todo número abre a lista de contratos/oportunidades que o compõem.

import { fmtPct, fmtNum1 } from '@/lib/format'
import Link from 'next/link'
import type { ContractLine } from '@/lib/revenue/dashboard-compute'

export const brl = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
export const brl2 = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
export const pctTxt = (v: number | null | undefined) => fmtPct(v)

// Cores fixas por tipo de receita (mesmas no gráfico, na barra e nas legendas)
// Paleta primária da marca: azul petróleo, coral e verde-água (separação validada para daltonismo)
export const REV_COLORS = { recurring: '#1b556b', metered: '#e98c5f', avulso: '#32af9d' } as const

const AGENT_STYLE = {
  hunter: { bg: 'bg-warn-100', ring: 'ring-warn-600', chip: 'bg-warn-600', text: 'text-amber-900', icon: '🎯' },
  farmer: { bg: 'bg-positive-100', ring: 'ring-positive-600', chip: 'bg-positive-600', text: 'text-emerald-900', icon: '🌱' },
} as const

export function Section({ title, subtitle, agent, children }: { title: string; subtitle?: string; agent?: 'hunter' | 'farmer'; children: React.ReactNode }) {
  const st = agent ? AGENT_STYLE[agent] : null
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2.5">
        {st && (
          <span className={`inline-flex items-center gap-1 rounded-full ${st.chip} px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white`}>
            <span aria-hidden="true">{st.icon}</span>{agent === 'hunter' ? 'Hunter' : 'Farmer'}
          </span>
        )}
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
      </div>
      {children}
    </section>
  )
}

export function DrillList({ lines, empty = 'Nenhum item.' }: { lines: (ContractLine & { previous?: number | null })[]; empty?: string }) {
  if (lines.length === 0) return <p className="px-1 py-2 text-xs text-gray-400">{empty}</p>
  return (
    <ul className="mt-2 max-h-64 divide-y divide-gray-100 overflow-auto rounded-lg border border-gray-100 bg-white">
      {lines.map((l, i) => (
        <li key={`${l.contractId}-${i}`} className="flex items-start justify-between gap-3 px-2.5 py-1.5 text-xs">
          <Link href={`/contracts/${l.contractId}`} className="min-w-0 text-gray-800 hover:text-[#1B556B] hover:underline">
            <span className="font-medium">{l.client}</span>
            {l.number && <span className="ml-1.5 font-mono text-[10px] text-gray-400">{l.number}</span>}
            {l.note && <span className="block text-[11px] text-gray-500">{l.note}</span>}
          </Link>
          <span className="shrink-0 tabular-nums text-gray-700">{brl2(l.value)}</span>
        </li>
      ))}
    </ul>
  )
}

export function Kpi({
  label, value, hint, tone = 'neutral', lines, linesLabel = 'Ver composição', empty, accent,
}: {
  label: string
  value: string
  hint?: React.ReactNode
  tone?: 'neutral' | 'good' | 'bad' | 'warn'
  lines?: (ContractLine & { previous?: number | null })[]
  linesLabel?: string
  empty?: string
  accent?: string            // cor da faixa lateral (identidade do tipo de receita)
}) {
  const toneCls = tone === 'good' ? 'text-emerald-700' : tone === 'bad' ? 'text-red-700' : tone === 'warn' ? 'text-amber-700' : 'text-gray-900'
  const dot = tone === 'good' ? 'bg-emerald-500' : tone === 'bad' ? 'bg-red-500' : tone === 'warn' ? 'bg-amber-500' : null
  return (
    <div className="relative overflow-hidden rounded-2xl border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      {accent && <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1" style={{ background: accent }} />}
      <div className="flex items-center gap-1.5">
        {dot && <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${dot}`} />}
        <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{label}</p>
      </div>
      <p className={`mt-1.5 text-2xl font-semibold tabular-nums tracking-tight ${toneCls}`}>{value}</p>
      {hint && <div className="mt-1 text-xs leading-relaxed text-gray-500">{hint}</div>}
      {lines && (
        <details className="group mt-2">
          <summary className="cursor-pointer list-none text-xs font-medium text-[#1B556B] hover:underline">
            {linesLabel} ({lines.length}) <span className="inline-block transition-transform group-open:rotate-90">›</span>
          </summary>
          <DrillList lines={lines} empty={empty} />
        </details>
      )}
    </div>
  )
}

// Destaque da receita: total, meta, progresso e composição por tipo
export function RevenueHero({
  label, total, goal, goalPct, gap, extra, parts, noGoal,
}: {
  label: string
  total: number
  goal: number
  goalPct: number | null
  gap: number
  extra?: React.ReactNode
  parts: { key: keyof typeof REV_COLORS; label: string; value: number }[]
  noGoal: React.ReactNode
}) {
  const sum = parts.reduce((s, p) => s + p.value, 0)
  const pctW = Math.min(100, goalPct ?? 0)
  const status = goal <= 0 ? null : (goalPct ?? 0) >= 100 ? { t: 'Meta atingida', c: 'bg-positive-600 text-white' } : (goalPct ?? 0) >= 80 ? { t: 'Perto da meta', c: 'bg-warn-600 text-white' } : { t: 'Abaixo da meta', c: 'bg-negative-600 text-white' }
  return (
    <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-[#1B556B] to-[#0e2933] p-5 text-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-white/70">{label}</p>
          <p className="mt-1 text-4xl font-semibold tabular-nums tracking-tight">{brl(total)}</p>
          {goal > 0 ? (
            <p className="mt-1 text-sm text-white/80">
              <span className="font-semibold text-white">{pctTxt(goalPct)}</span> da meta de {brl(goal)}
              {' · '}{gap > 0 ? `faltam ${brl(gap)}` : `superada em ${brl(-gap)}`}
            </p>
          ) : <div className="mt-1 text-sm text-[#FFE596]">{noGoal}</div>}
          {extra && <div className="mt-0.5 text-xs text-white/70">{extra}</div>}
        </div>
        {status && <span className={`rounded-full px-3 py-1 text-xs font-semibold ${status.c}`}>{status.t}</span>}
      </div>

      {goal > 0 && (
        <div className="mt-4">
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/15" role="progressbar" aria-valuenow={Math.round(pctW)} aria-valuemin={0} aria-valuemax={100} aria-label="Atingimento da meta">
            <div className="h-full rounded-full bg-white" style={{ width: `${pctW}%` }} />
          </div>
        </div>
      )}

      <div className="mt-5 rounded-xl bg-white p-3 text-gray-900">
        <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Composição</p>
        <div className="mt-2 flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-gray-100">
          {sum > 0 && parts.filter(p => p.value > 0).map(p => (
            <div key={p.key} title={`${p.label}: ${brl(p.value)}`} style={{ width: `${(p.value / sum) * 100}%`, background: REV_COLORS[p.key] }} />
          ))}
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {parts.map(p => (
            <div key={p.key} className="flex items-start gap-2 sm:block">
              <div className="flex items-center gap-1.5">
                <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: REV_COLORS[p.key] }} />
                <span className="whitespace-nowrap text-xs text-gray-600">{p.label}</span>
                <span className="text-[11px] tabular-nums text-gray-400">{sum > 0 ? fmtPct((p.value / sum) * 100) : '—'}</span>
              </div>
              <p className="ml-auto text-base font-semibold tabular-nums sm:ml-0 sm:mt-0.5">{brl(p.value)}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// Barras empilhadas da receita por mês (recorrente/medição/avulso) com a meta marcada.
// Meses fora do período escolhido ficam apagados.
export function RevenueGoalChart({
  series, monthLabels, highlight,
}: {
  series: { month: number; total: number | null; recurring?: number | null; metered?: number | null; avulso?: number | null; goal: number }[]
  monthLabels: string[]
  highlight?: number[]
}) {
  const max = Math.max(1, ...series.map(s => Math.max(s.total ?? 0, s.goal)))
  const W = 720, H = 220, padL = 8, padB = 24, padT = 12
  const bw = (W - padL * 2) / 12
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max)
  const hl = highlight ? new Set(highlight) : null
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="mb-2 flex flex-wrap items-center gap-4 text-xs text-gray-600">
        <span className="font-semibold text-gray-800">Receita x meta por mês</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: REV_COLORS.recurring }} />$ Recorrente</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: REV_COLORS.metered }} />📏 Medição</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: REV_COLORS.avulso }} />Avulso</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 bg-[#132c33]" />Meta</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Receita por tipo e meta, mês a mês">
        <line x1={padL} x2={W - padL} y1={y(0)} y2={y(0)} stroke="#e5e7eb" strokeWidth={1} />
        {series.map((s, i) => {
          const x = padL + i * bw
          const barW = Math.min(30, bw * 0.56)
          const bx = x + (bw - barW) / 2
          const dim = hl ? !hl.has(s.month) : false
          const segs = [
            { v: s.recurring ?? 0, c: REV_COLORS.recurring },
            { v: s.metered ?? 0, c: REV_COLORS.metered },
            { v: s.avulso ?? 0, c: REV_COLORS.avulso },
          ].filter(g => g.v > 0)
          // Sem quebra por tipo: barra única no total
          if (segs.length === 0 && (s.total ?? 0) > 0) segs.push({ v: s.total ?? 0, c: REV_COLORS.recurring })
          let acc = 0
          return (
            <g key={s.month} opacity={dim ? 0.25 : 1}>
              <title>{`${monthLabels[i]}: receita ${brl(s.total)} (recorrente ${brl(s.recurring ?? null)}, medição ${brl(s.metered ?? null)}, avulso ${brl(s.avulso ?? null)}) · meta ${brl(s.goal)}`}</title>
              <rect x={x} y={padT} width={bw} height={H - padT - padB} fill="transparent" />
              {segs.map((g, k) => {
                const y0 = y(acc), y1 = y(acc + g.v)
                acc += g.v
                const isTop = k === segs.length - 1
                const h = Math.max(0, y0 - y1 - (isTop ? 0 : 2))
                if (h <= 0) return null
                if (!isTop) return <rect key={k} x={bx} y={y1 + 2} width={barW} height={h} fill={g.c} />
                const r = Math.min(4, h / 2)
                return <path key={k} d={`M${bx},${y0} V${y1 + r} Q${bx},${y1} ${bx + r},${y1} H${bx + barW - r} Q${bx + barW},${y1} ${bx + barW},${y1 + r} V${y0} Z`} fill={g.c} />
              })}
              {s.goal > 0 && <line x1={bx - 5} x2={bx + barW + 5} y1={y(s.goal)} y2={y(s.goal)} stroke="#132c33" strokeWidth={2} strokeLinecap="round" />}
              <text x={x + bw / 2} y={H - 7} textAnchor="middle" fontSize={11} fill={dim ? '#9ca3af' : '#4b5563'} fontWeight={dim ? 400 : 600}>{monthLabels[i]}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// Em contrato (potencial) x faturado, com a origem da diferença
type GapPart = { total: number; lines: ContractLine[] }
export function ContractVsBilled({
  potential, billed, sent, invoiced, gap, invoicedPct, recurringPotential, meteredPotential, recurringBilled, meteredBilled, parts, periodo, flow,
}: {
  potential: number; billed: number; sent: number; invoiced: number; gap: number; invoicedPct: number | null
  recurringPotential: number; meteredPotential: number; recurringBilled: number; meteredBilled: number
  parts: Record<'discounts' | 'glosas' | 'below' | 'pending' | 'pendingConfirm' | 'above' | 'notSent' | 'notInvoiced' | 'invoiceDiff', GapPart>
  periodo: string
  flow: boolean
}) {
  // sign: 1 = tira do faturado; -1 = soma (medido acima). Valores negativos (ex.: enviado acima do apurado) somam.
  const rows: { key: string; label: string; hint: string; part: GapPart; sign: 1 | -1; tone: 'bad' | 'warn' | 'brand' }[] = [
    { key: 'pendingConfirm', label: 'Recorrência não confirmada', hint: 'Recorrente do mês ainda não confirmado pelo consultor', part: parts.pendingConfirm, sign: 1 as const, tone: 'warn' as const },
    { key: 'pending', label: 'Medições pendentes', hint: 'Sem medição validada (falta lançamento, relatório ou aprovação)', part: parts.pending, sign: 1 as const, tone: 'warn' as const },
    { key: 'discounts', label: 'Descontos concedidos', hint: 'Descontos registrados no mês, com o motivo', part: parts.discounts, sign: 1 as const, tone: 'bad' as const },
    { key: 'glosas', label: 'Glosas', hint: 'Valores glosados nas medições', part: parts.glosas, sign: 1 as const, tone: 'bad' as const },
    { key: 'below', label: 'Medido abaixo do potencial', hint: 'Medição menor que o valor do contrato', part: parts.below, sign: 1 as const, tone: 'bad' as const },
    { key: 'above', label: 'Medido acima do potencial', hint: 'Medição maior que o valor do contrato (soma ao faturado)', part: parts.above, sign: -1 as const, tone: 'bad' as const },
    { key: 'notSent', label: 'Apurado e não enviado', hint: 'Confirmado/validado, mas ainda não enviado para faturamento', part: parts.notSent, sign: 1 as const, tone: 'brand' as const },
    { key: 'notInvoiced', label: 'Enviado, aguardando faturamento', hint: 'Já está com o faturamento; falta voltar como faturado', part: parts.notInvoiced, sign: 1 as const, tone: 'brand' as const },
    { key: 'invoiceDiff', label: 'Faturado diferente do enviado', hint: 'Nota emitida com valor diferente do enviado', part: parts.invoiceDiff, sign: 1 as const, tone: 'bad' as const },
  ].filter(r => Math.abs(r.part.total) > 0.005 || r.key === 'discounts' || r.key === 'pending')
  const maxPart = Math.max(1, ...rows.map(r => Math.abs(r.part.total)))
  const w = (v: number) => (potential > 0 ? Math.min(100, Math.max(0, (v / potential) * 100)) : 0)
  const bar = { bad: 'bg-negative-600', warn: 'bg-warn-600', brand: 'bg-brand-700' }
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
      <div className="grid gap-0 divide-y divide-gray-100 md:grid-cols-4 md:divide-x md:divide-y-0">
        <div className="p-5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Em contrato (potencial)</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-gray-900">{brl(potential)}</p>
          <p className="mt-1.5 text-xs text-gray-500"><span className="block">$ Recorrente <span className="tabular-nums text-gray-700">{brl(recurringPotential)}</span></span><span className="block">📏 Medição <span className="tabular-nums text-gray-700">{brl(meteredPotential)}</span></span></p>
        </div>
        <div className="p-5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Enviado para faturamento</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-brand-700">{brl(sent)}</p>
          <p className="mt-1.5 text-xs text-gray-500">Apurado <span className="tabular-nums text-gray-700">{brl(billed)}</span><span className="block">$ {brl(recurringBilled)} · 📏 {brl(meteredBilled)}</span></p>
        </div>
        <div className="p-5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Faturado</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-positive-700">{brl(invoiced)}</p>
          <p className="mt-1.5 text-xs text-gray-500">{pctTxt(invoicedPct)} do que está em contrato{!flow && <span className="block text-gray-400">antes do fluxo: apurado = faturado</span>}</p>
        </div>
        <div className="p-5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Diferença {periodo}</p>
          <p className={`mt-1 text-2xl font-semibold tabular-nums tracking-tight ${gap > 0 ? 'text-negative-700' : 'text-positive-700'}`}>{gap > 0 ? `− ${brl(gap)}` : brl(-gap)}</p>
          <p className="mt-1 text-xs text-gray-500">em contrato − faturado</p>
        </div>
      </div>
      <div className="px-5 pb-2">
        <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-negative-100" role="progressbar" aria-valuenow={Math.round(w(invoiced))} aria-valuemin={0} aria-valuemax={100} aria-label="Faturado sobre o potencial">
          <div className="absolute inset-y-0 left-0 rounded-full bg-brand-100" style={{ width: `${w(sent)}%` }} />
          <div className="absolute inset-y-0 left-0 rounded-full bg-positive-600" style={{ width: `${w(invoiced)}%` }} />
        </div>
        <p className="mt-1 text-[10px] text-gray-400">Verde: faturado · azul claro: enviado · vermelho claro: ainda não enviado</p>
      </div>
      <div className="border-t border-gray-100 px-5 py-4">
        <p className="text-xs font-semibold text-gray-700">De onde veio a diferença</p>
        <div className="mt-2 divide-y divide-gray-50">
          {rows.map(r => {
            const adds = r.sign < 0 || r.part.total < 0
            const abs = Math.abs(r.part.total)
            return (
              <details key={r.key} className="group py-2">
                <summary className="flex cursor-pointer list-none items-center gap-3">
                  <span className="w-52 shrink-0 text-xs text-gray-700">
                    <span className="inline-block w-3 text-gray-400 transition-transform group-open:rotate-90">›</span>
                    {r.label}
                    {r.part.lines.length > 0 && <span className="ml-1 text-gray-400">({r.part.lines.length})</span>}
                  </span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
                    <span className={`block h-full rounded-full ${adds ? 'bg-positive-600' : bar[r.tone]}`} style={{ width: `${(abs / maxPart) * 100}%` }} />
                  </span>
                  <span className={`w-36 shrink-0 text-right text-sm font-semibold tabular-nums ${abs < 0.005 ? 'text-gray-300' : adds ? 'text-positive-700' : 'text-gray-900'}`}>
                    {abs < 0.005 ? brl(0) : `${adds ? '+ ' : '− '}${brl(abs)}`}
                  </span>
                </summary>
                <p className="ml-3 mt-1 text-[11px] text-gray-400">{r.hint}</p>
                <DrillList lines={r.part.lines} empty="Nada neste item." />
              </details>
            )
          })}
        </div>
      </div>
    </div>
  )
}
