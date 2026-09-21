import Link from 'next/link'
import { createClientForTenant } from '@/lib/supabase/server'
import { PeriodSelector } from '@/components/dashboard/period-selector'
import { MetricCard } from '@/components/dashboard/metric-card'
import { TicketBreakdownChart } from '@/components/tickets/ticket-breakdown-chart'
import { TicketTrendChart } from '@/components/tickets/ticket-trend-chart'
import { ExpandableRow } from '@/components/surveys/expandable-row'
import { PRIORITY_LABELS, GRAVITY_CATEGORIES } from '@/lib/utils/gut-matrix'
import { Ticket, CheckCircle2, Clock, ShieldCheck, Star } from 'lucide-react'

function currentQuarterRange() {
  const now = new Date()
  const quarter = Math.floor(now.getMonth() / 3)
  const from = new Date(now.getFullYear(), quarter * 3, 1)
  const to = new Date(now.getFullYear(), quarter * 3 + 3, 0)
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }
}

const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(GRAVITY_CATEGORIES.map((c) => [c.value, c.label]))
const MONTH_SHORT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

export default async function TicketsDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  const params = await searchParams
  const defaultRange = currentQuarterRange()
  const from = params.from ?? defaultRange.from
  const to = params.to ?? defaultRange.to

  const { client: supabase, tenantId } = await createClientForTenant()

  let ticketsDashQ = supabase
    .from('tickets')
    .select('id, ticket_number, subject, status, priority, category, assigned_to, contract_id, sla_due_at, resolved_at, created_at, satisfaction_rating, satisfaction_comment, satisfaction_responded_at')
    .gte('created_at', `${from}T00:00:00`)
    .lte('created_at', `${to}T23:59:59`)
  if (tenantId) ticketsDashQ = ticketsDashQ.eq('tenant_id', tenantId)
  const { data: tickets } = await ticketsDashQ

  const { data: allProfiles } = await supabase.from('profiles').select('id, full_name')
  const profileById = new Map((allProfiles ?? []).map((p) => [p.id, p.full_name]))

  const total = tickets?.length ?? 0
  const resolved = (tickets ?? []).filter((t) => t.status === 'resolvido' || t.status === 'fechado')

  const resolutionTimes = resolved
    .filter((t) => t.resolved_at)
    .map((t) => (new Date(t.resolved_at!).getTime() - new Date(t.created_at).getTime()) / 86_400_000)
  const avgResolutionDays = resolutionTimes.length > 0 ? resolutionTimes.reduce((a, b) => a + b, 0) / resolutionTimes.length : null

  const resolvedWithSla = resolved.filter((t) => t.sla_due_at && t.resolved_at)
  const withinSla = resolvedWithSla.filter((t) => new Date(t.resolved_at!) <= new Date(t.sla_due_at!))
  const slaComplianceRate = resolvedWithSla.length > 0 ? Math.round((withinSla.length / resolvedWithSla.length) * 100) : null

  const satisfactionRatings = (tickets ?? []).filter((t) => t.satisfaction_responded_at).map((t) => t.satisfaction_rating as number)
  const avgSatisfaction = satisfactionRatings.length > 0 ? satisfactionRatings.reduce((a, b) => a + b, 0) / satisfactionRatings.length : null
  const satisfactionResponses = (tickets ?? [])
    .filter((t) => t.satisfaction_responded_at)
    .sort((a, b) => new Date(b.satisfaction_responded_at!).getTime() - new Date(a.satisfaction_responded_at!).getTime())

  const satisfactionContractIds = [...new Set(satisfactionResponses.map((t) => t.contract_id).filter((id): id is string => !!id))]
  const { data: satisfactionContracts } = satisfactionContractIds.length
    ? await supabase.from('contracts').select('id, client_name').in('id', satisfactionContractIds)
    : { data: [] as { id: string; client_name: string }[] }
  const contractNameById = new Map((satisfactionContracts ?? []).map((c) => [c.id, c.client_name]))

  const categoryCounts = new Map<string, number>()
  for (const t of tickets ?? []) {
    const key = t.category ?? 'sem_categoria'
    categoryCounts.set(key, (categoryCounts.get(key) ?? 0) + 1)
  }
  const categoryData = [...categoryCounts.entries()]
    .map(([key, count]) => ({ label: CATEGORY_LABELS[key] ?? 'Sem categoria', count }))
    .sort((a, b) => b.count - a.count)

  const assigneeCounts = new Map<string, number>()
  for (const t of tickets ?? []) {
    const key = t.assigned_to ?? 'sem_responsavel'
    assigneeCounts.set(key, (assigneeCounts.get(key) ?? 0) + 1)
  }
  const assigneeData = [...assigneeCounts.entries()]
    .map(([key, count]) => ({ label: key === 'sem_responsavel' ? 'Sem responsável' : profileById.get(key) ?? 'Alguém', count }))
    .sort((a, b) => b.count - a.count)

  const monthBuckets: { year: number; month: number }[] = []
  const toDate = new Date(to)
  for (let i = 5; i >= 0; i--) {
    const d = new Date(toDate.getFullYear(), toDate.getMonth() - i, 1)
    monthBuckets.push({ year: d.getFullYear(), month: d.getMonth() + 1 })
  }

  const { data: trendTickets } = await supabase
    .from('tickets')
    .select('status, created_at')
    .gte('created_at', `${monthBuckets[0].year}-${String(monthBuckets[0].month).padStart(2, '0')}-01`)

  const trendData = monthBuckets.map(({ year, month }) => {
    const inMonth = (trendTickets ?? []).filter((t) => {
      const d = new Date(t.created_at)
      return d.getFullYear() === year && d.getMonth() + 1 === month
    })
    return {
      label: `${MONTH_SHORT[month - 1]}/${String(year).slice(2)}`,
      abertos: inMonth.filter((t) => t.status !== 'resolvido' && t.status !== 'fechado').length,
      resolvidos: inMonth.filter((t) => t.status === 'resolvido' || t.status === 'fechado').length,
    }
  })

  const slaAlert = slaComplianceRate !== null && slaComplianceRate < 80

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 500, color: '#1a1f36', margin: 0 }}>Dashboard de Atendimento</h1>
          <p style={{ fontSize: 12, color: '#8892a4', marginTop: 3 }}>Visão consolidada dos chamados — dados de gestão à vista.</p>
        </div>
        <Link href="/tickets" style={{ padding: '7px 14px', fontSize: 12, borderRadius: 8, border: '0.5px solid #d1d8e8', background: '#fff', color: '#52514e', textDecoration: 'none' }}>
          ← Ver lista de tickets
        </Link>
      </div>

      <PeriodSelector from={from} to={to} basePath="/tickets/dashboard" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
        {[
          { label: 'Total de tickets', value: String(total), sub: 'no período' },
          { label: 'Resolvidos', value: String(resolved.length), sub: total > 0 ? `${Math.round((resolved.length / total) * 100)}% do total` : '—' },
          { label: 'Tempo médio resolução', value: avgResolutionDays !== null ? `${avgResolutionDays.toFixed(1)}d` : '—', sub: 'dias até resolução' },
          { label: 'SLA dentro do prazo', value: slaComplianceRate !== null ? `${slaComplianceRate}%` : '—', sub: `${resolvedWithSla.length} avaliados`, alert: slaAlert },
          { label: 'Satisfação média', value: avgSatisfaction !== null ? `${avgSatisfaction.toFixed(1)}/5` : '—', sub: `${satisfactionRatings.length} avaliações` },
        ].map(k => (
          <div key={k.label} style={{ background: '#fff', borderRadius: 12, padding: '14px 16px', border: `0.5px solid ${(k as any).alert ? '#fca5a5' : '#e8edf5'}` }}>
            <p style={{ fontSize: 10, color: '#8892a4', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 6 }}>{k.label}</p>
            <p style={{ fontSize: 20, fontWeight: 500, color: (k as any).alert ? '#b91c1c' : '#1a1f36', letterSpacing: '-0.5px', margin: 0 }}>{k.value}</p>
            <p style={{ fontSize: 11, color: (k as any).alert ? '#b91c1c' : '#8892a4', marginTop: 3 }}>{k.sub}</p>
          </div>
        ))}
      </div>

      <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #e8edf5', padding: 20 }}>
        <p style={{ fontSize: 13, fontWeight: 500, color: '#1a1f36', marginBottom: 14 }}>Abertos vs Resolvidos — últimos 6 meses</p>
        <TicketTrendChart data={trendData} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #e8edf5', padding: 20 }}>
          <p style={{ fontSize: 13, fontWeight: 500, color: '#1a1f36', marginBottom: 14 }}>Por categoria</p>
          {categoryData.length > 0 ? <TicketBreakdownChart data={categoryData} /> : <p style={{ fontSize: 12, color: '#8892a4' }}>Sem dados no período.</p>}
        </div>
        <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #e8edf5', padding: 20 }}>
          <p style={{ fontSize: 13, fontWeight: 500, color: '#1a1f36', marginBottom: 14 }}>Por responsável</p>
          {assigneeData.length > 0 ? <TicketBreakdownChart data={assigneeData} /> : <p style={{ fontSize: 12, color: '#8892a4' }}>Sem dados no período.</p>}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {(['nao_critica', 'pouco_critica', 'critica', 'muito_critica'] as const).map((p) => {
          const count = (tickets ?? []).filter((t) => t.priority === p).length
          const isCrit = p === 'critica' || p === 'muito_critica'
          return (
            <div key={p} style={{ background: '#fff', borderRadius: 12, padding: '14px 16px', border: `0.5px solid ${isCrit && count > 0 ? '#fca5a5' : '#e8edf5'}` }}>
              <p style={{ fontSize: 10, color: '#8892a4', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 6 }}>{PRIORITY_LABELS[p]}</p>
              <p style={{ fontSize: 20, fontWeight: 500, color: isCrit && count > 0 ? '#b91c1c' : '#1a1f36', letterSpacing: '-0.5px', margin: 0 }}>{count}</p>
            </div>
          )
        })}
      </div>

      <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #e8edf5', overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', borderBottom: '0.5px solid #f1f3f8' }}>
          <p style={{ fontSize: 13, fontWeight: 500, color: '#1a1f36', margin: 0 }}>Avaliações de satisfação</p>
          <p style={{ fontSize: 11, color: '#8892a4', marginTop: 2 }}>{satisfactionResponses.length} avaliações no período</p>
        </div>
        <div style={{ padding: '0 16px 8px' }}>
          {satisfactionResponses.map((t) => {
            const rating = t.satisfaction_rating ?? 0
            const ratingStyle = rating >= 4
              ? { bg: '#eaf5ee', color: '#1a7c3e' }
              : rating === 3 ? { bg: '#fff8e6', color: '#92400e' }
              : { bg: '#fdecea', color: '#b91c1c' }
            return (
              <ExpandableRow
                key={t.id}
                summary={
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div>
                      <span style={{ fontSize: 13, fontWeight: 500, color: '#1a1f36' }}>{t.contract_id ? contractNameById.get(t.contract_id) ?? '—' : 'Sem conta vinculada'}</span>
                      <span style={{ marginLeft: 8, fontSize: 11, color: '#8892a4' }}>{t.ticket_number} · {t.subject}</span>
                    </div>
                    <span style={{ flexShrink: 0, padding: '3px 8px', borderRadius: 20, fontSize: 11, fontWeight: 500, background: ratingStyle.bg, color: ratingStyle.color }}>
                      {rating}/5
                    </span>
                  </div>
                }
              >
                {t.satisfaction_comment && <p style={{ fontSize: 13, color: '#52514e', fontStyle: 'italic' }}>&ldquo;{t.satisfaction_comment}&rdquo;</p>}
                <p style={{ fontSize: 11, color: '#8892a4', marginTop: 4 }}>
                  Avaliado em {new Date(t.satisfaction_responded_at!).toLocaleDateString('pt-BR')}
                </p>
                <Link href={`/tickets/${t.id}`} style={{ fontSize: 11, color: '#4f86f7', textDecoration: 'none' }}>Ver ticket →</Link>
              </ExpandableRow>
            )
          })}
          {satisfactionResponses.length === 0 && (
            <p style={{ padding: '32px 0', textAlign: 'center', fontSize: 13, color: '#8892a4' }}>
              Nenhuma avaliação recebida ainda neste período.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
