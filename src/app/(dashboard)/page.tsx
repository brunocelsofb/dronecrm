import { createClientForTenant } from '@/lib/supabase/server'
import { PremiumDashboard } from '@/components/dashboard/premium-dashboard'

function getPeriodRange(period: string) {
  const now = new Date()
  switch (period) {
    case 'week': {
      const from = new Date(now)
      from.setDate(now.getDate() - 7)
      return { from: from.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) }
    }
    case 'quarter': {
      const from = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)
      return { from: from.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) }
    }
    case 'year': {
      return { from: `${now.getFullYear()}-01-01`, to: now.toISOString().slice(0, 10) }
    }
    default: { // month
      const from = new Date(now.getFullYear(), now.getMonth(), 1)
      const to = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }
    }
  }
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const { period = 'month' } = await searchParams
  const { client: supabase, tenantId } = await createClientForTenant()
  const { from: periodFrom, to: periodTo } = getPeriodRange(period)

  // Funil — busca o pipeline de vendas padrão
  let dashPipelinesQ = supabase.from('pipelines').select('id, type, is_default').order('name')
  if (tenantId) dashPipelinesQ = dashPipelinesQ.eq('tenant_id', tenantId)
  const { data: pipelines } = await dashPipelinesQ
  const salesPipeline = pipelines?.find(p => p.type === 'vendas' && p.is_default) ?? pipelines?.find(p => p.type === 'vendas') ?? pipelines?.[0]
  const gestaoPipeline = pipelines?.find(p => p.type === 'gestao_contratos' && p.is_default) ?? pipelines?.find(p => p.type === 'gestao_contratos')
  const mainPipelineId = salesPipeline?.id ?? gestaoPipeline?.id

  // Busca TODOS os pipelines de vendas (não só o padrão)
  const allSalesPipelineIds = (pipelines ?? []).filter(p => p.type === 'vendas').map(p => p.id)

  const [
    { data: stages },
    { data: openRuns },
    { data: wonInPeriod },
    { data: lostInPeriod },
    { data: allWonRuns },
    { data: activities },
    { data: profiles },
    { data: leads },
    { data: gestaoRuns },
  ] = await Promise.all([
    mainPipelineId ? supabase.from('stages').select('id, name, order_index').eq('pipeline_id', mainPipelineId).order('order_index') : Promise.resolve({ data: [] as any[] }),
    // Oportunidades abertas — todos os funis de vendas
    allSalesPipelineIds.length ? supabase.from('pipeline_runs').select('stage_id, value, started_at, pipeline_id').in('pipeline_id', allSalesPipelineIds).eq('status', 'open') : Promise.resolve({ data: [] as any[] }),
    // Ganhos no período — todos os funis de vendas
    allSalesPipelineIds.length ? supabase.from('pipeline_runs').select('value, started_at, ended_at, created_by').in('pipeline_id', allSalesPipelineIds).eq('status', 'won').gte('ended_at', `${periodFrom}T00:00:00`).lte('ended_at', `${periodTo}T23:59:59`) : Promise.resolve({ data: [] as any[] }),
    // Perdidos no período
    allSalesPipelineIds.length ? supabase.from('pipeline_runs').select('value').in('pipeline_id', allSalesPipelineIds).eq('status', 'lost').gte('ended_at', `${periodFrom}T00:00:00`).lte('ended_at', `${periodTo}T23:59:59`) : Promise.resolve({ data: [] as any[] }),
    // Histórico completo de ganhos/perdidos (últimos 6 meses para o gráfico)
    allSalesPipelineIds.length ? supabase.from('pipeline_runs').select('value, started_at, ended_at, created_by').in('pipeline_id', allSalesPipelineIds).in('status', ['won', 'lost']).gte('ended_at', new Date(new Date().setMonth(new Date().getMonth() - 6)).toISOString().slice(0, 10)) : Promise.resolve({ data: [] as any[] }),
    (() => { let aQ = supabase.from('activities').select('user_id, type, created_at').not('type', 'eq', 'system').not('user_id', 'is', null).gte('created_at', `${periodFrom}T00:00:00`).lte('created_at', `${periodTo}T23:59:59`); if (tenantId) aQ = aQ.eq('tenant_id', tenantId); return aQ })(),
    supabase.from('profiles').select('id, full_name'),
    (() => { let lQ = supabase.from('leads').select('source'); if (tenantId) lQ = lQ.eq('tenant_id', tenantId); return lQ })(),
    // MRR da carteira de contratos ativos
    gestaoPipeline ? supabase.from('pipeline_runs').select('contract_id, value').eq('pipeline_id', gestaoPipeline.id).eq('status', 'open') : Promise.resolve({ data: [] as any[] }),
  ])

  console.log('[dash] allSalesPipelineIds:', allSalesPipelineIds)
  console.log('[dash] openRuns:', openRuns?.length, 'wonInPeriod:', wonInPeriod?.length, 'gestaoRuns:', gestaoRuns?.length)
  console.log('[dash] wonInPeriod errors - period:', periodFrom, 'to', periodTo)
  const stageMap = new Map((stages ?? []).map((s: any) => [s.id, s.name]))
  const stageOrder = (stages ?? []).map((s: any) => s.id)
  const mrrCarteira = (gestaoRuns ?? []).reduce((s: number, r: any) => s + Number(r.value || 0), 0)

  // Para o funil: agrupa openRuns (todos os funis de vendas) por stage do pipeline principal
  // Se não há pipeline padrão, usa a distribuição de todos os runs
  const funnelByStage = new Map<string, { value: number; count: number }>()
  for (const run of openRuns ?? []) {
    const cur = funnelByStage.get(run.stage_id) ?? { value: 0, count: 0 }
    funnelByStage.set(run.stage_id, { value: cur.value + Number(run.value || 0), count: cur.count + 1 })
  }
  const funnel = stageOrder.slice(0, 4).map((id: string) => ({
    label: stageMap.get(id) ?? 'Etapa',
    value: funnelByStage.get(id)?.value ?? 0,
    count: funnelByStage.get(id)?.count ?? 0,
  })).filter((f: any) => f.value > 0 || f.count > 0)

  // KPIs
  const receitaAtual = (wonInPeriod ?? []).reduce((s: number, r: any) => s + Number(r.value || 0), 0)
  const churnValue = (lostInPeriod ?? []).reduce((s: number, r: any) => s + Number(r.value || 0), 0)
  const totalOpen = (openRuns ?? []).reduce((s: number, r: any) => s + Number(r.value || 0), 0)
  const meta = totalOpen > 0 ? totalOpen * 0.85 : 0
  // meta = 85% do valor total em pipeline aberto (estimativa interna)
  const wonRuns = (allWonRuns ?? []).filter((r: any) => r.status === undefined || true)
  const avgTicket = wonInPeriod && wonInPeriod.length > 0 ? receitaAtual / wonInPeriod.length : 0
  const cycleDays = (wonInPeriod ?? []).filter((r: any) => r.ended_at).map((r: any) => (new Date(r.ended_at).getTime() - new Date(r.started_at).getTime()) / 86400000)
  const avgCycle = cycleDays.length ? Math.round(cycleDays.reduce((a: number, b: number) => a + b, 0) / cycleDays.length) : null
  const churnPct = receitaAtual + churnValue > 0 ? Math.round((churnValue / (receitaAtual + churnValue)) * 100 * 10) / 10 : null

  // Série histórica dos últimos 6 meses
  const series = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date()
    d.setMonth(d.getMonth() - i)
    const mFrom = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
    const mTo = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10)
    const monthWon = (allWonRuns ?? []).filter((r: any) => r.ended_at && r.ended_at >= mFrom && r.ended_at <= mTo + 'T23:59:59')
    const realizado = monthWon.reduce((s: number, r: any) => s + Number(r.value || 0), 0)
    series.push({ month: d.toLocaleDateString('pt-BR', { month: 'short' }), realizado, meta: Math.max(meta, realizado * 1.1) })
  }

  // Origem dos leads
  const sourceCount: Record<string, number> = {}
  for (const l of leads ?? []) {
    const src = l.source || 'Outros'
    sourceCount[src] = (sourceCount[src] ?? 0) + 1
  }
  const totalLeads = Object.values(sourceCount).reduce((a, b) => a + b, 0)
  const SOURCE_LABELS: Record<string, string> = { manual: 'Manual', whatsapp: 'WhatsApp', site: 'Site', indicacao: 'Indicação', google_ads: 'Google Ads', redes_sociais: 'Redes Sociais' }
  const leadSources = totalLeads > 0
    ? Object.entries(sourceCount).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => ({ label: SOURCE_LABELS[k] ?? k, pct: Math.round((v / totalLeads) * 100) }))
    : []

  // Ranking da equipe — combina atividades + receita do período
  const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p.full_name as string]))
  const actByUser = new Map<string, number>()
  for (const a of activities ?? []) {
    if (a.user_id) actByUser.set(a.user_id, (actByUser.get(a.user_id) ?? 0) + 1)
  }
  const revByUser = new Map<string, number>()
  for (const r of wonInPeriod ?? []) {
    if (r.created_by) revByUser.set(r.created_by, (revByUser.get(r.created_by) ?? 0) + Number(r.value || 0))
  }
  const allUserIds = [...new Set([...actByUser.keys(), ...revByUser.keys()])]
  const team = allUserIds.slice(0, 3).map(id => {
    const name = profileMap.get(id) ?? 'Usuário'
    const initials = name.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase()
    return { initials, name, activities: actByUser.get(id) ?? 0, revenue: revByUser.get(id) ?? 0 }
  }).sort((a, b) => b.revenue - a.revenue)

  return (
    <PremiumDashboard
      period={period}
      kpi={{ receita: receitaAtual, meta, ticketMedio: avgTicket, ticketDelta: null, cicloMedio: avgCycle, churnPct, mrrCarteira }}
      funnel={funnel}
      series={series}
      leadSources={leadSources}
      team={team}
    />
  )
}
