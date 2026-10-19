import Link from 'next/link'
import { createClientForTenant } from '@/lib/supabase/server'
import { KanbanBoard, type RunCard } from '@/components/pipeline/kanban-board'
import { PipelineSelect } from '@/components/pipeline/pipeline-select'
import { isCurrentUserAdmin } from '@/lib/auth/role'
import { checkAndTriggerRenewals } from '@/lib/actions/pipeline'
import { pendingReference, todayBrasilia } from '@/lib/revenue/measurement'

const DEFAULT_SLA_DAYS = 7 // usado quando a etapa não tem SLA configurado

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ pipeline?: string; tag?: string }>
}) {
  const { pipeline: pipelineIdParam, tag: tagFilter } = await searchParams
  const { client: supabase, tenantId } = await createClientForTenant()
  const isAdmin = await isCurrentUserAdmin()

  // Roda "no fundo" (sem await) — antes isso travava o carregamento da
  // tela toda vez que alguém visitava o Funil, mesmo quando não tinha
  // nada pra mover. Se algo for movido agora, aparece na PRÓXIMA
  // visita/atualização, não nesta — troca deliberada de "sempre
  // atualizado na hora" por "tela rápida agora".
  void checkAndTriggerRenewals()

  let pipelinesQ = supabase
    .from('pipelines')
    .select('id, name, is_default, type, won_label, lost_label')
    .order('name')
  if (tenantId) pipelinesQ = pipelinesQ.eq('tenant_id', tenantId)
  const { data: pipelinesRaw } = await pipelinesQ

  // Ordena: funis de vendas primeiro (Novos Negócios), gestao_contratos depois
  const TYPE_ORDER: Record<string, number> = { vendas: 0, gestao_contratos: 1, servico_avulso: 2 }
  const pipelines = (pipelinesRaw ?? []).sort((a, b) => {
    const ao = TYPE_ORDER[a.type] ?? 9
    const bo = TYPE_ORDER[b.type] ?? 9
    if (ao !== bo) return ao - bo
    return a.name.localeCompare(b.name, 'pt-BR')
  })

  const selectedPipeline =
    pipelineIdParam ?? pipelines?.find((p) => p.is_default)?.id ?? pipelines?.[0]?.id

  const selectedPipelineData = pipelines?.find(p => p.id === selectedPipeline)
  const pipelineName = selectedPipelineData?.name ?? 'Funil'
  const pipelineType = selectedPipelineData?.type ?? 'gestao_contratos'

  const TYPE_LABEL: Record<string, string> = {
    vendas: 'Novos Negócios',
    gestao_contratos: 'Gestão de Contratos',
    servico_avulso: 'Serviço Avulso',
  }
  const TYPE_COLOR: Record<string, { bg: string; color: string }> = {
    vendas: { bg: '#e3f5f1', color: '#1f8c7d' },
    gestao_contratos: { bg: '#e8e7f4', color: '#524e9c' },
    servico_avulso: { bg: '#fbeee5', color: '#c2683d' },
  }
  const typeBadge = TYPE_COLOR[pipelineType] ?? TYPE_COLOR.vendas

  // Busca dados do funil selecionado (para o Kanban)
  const [{ data: stages }, { data: runs }] = await Promise.all([
    selectedPipeline
      ? supabase.from('stages').select('id, name, order_index, sla_days').eq('pipeline_id', selectedPipeline).order('order_index')
      : Promise.resolve({ data: [] as { id: string; name: string; order_index: number; sla_days: number | null }[] }),
    selectedPipeline
      ? supabase.from('pipeline_runs').select('id, contract_id, stage_id, stage_entered_at, value, status, lost_reason_id').eq('pipeline_id', selectedPipeline).in('status', ['open', 'won', 'lost'])
      : Promise.resolve({ data: [] as any[] }),
  ])

  // Motivos de perda (nome no cartão de perdido; inclui inativos para não perder o histórico)
  const salesPipelineIds = (pipelines ?? []).filter(p => p.type === 'vendas').map(p => p.id)
  const { data: lostReasons } = await (() => { let lrQ = supabase.from('lost_reasons').select('id, name'); if (tenantId) lrQ = lrQ.eq('tenant_id', tenantId); return lrQ })()

  const allContractIds = [...new Set((runs ?? []).map((r: any) => r.contract_id))]

  const [{ data: contractsData }, { data: latestActivityRows }, { data: contractTagRows }, { data: allStagesData }, { data: allPipelineStages }, { data: proposalAgg }] = await Promise.all([
    allContractIds.length
      ? supabase.from('contracts').select('id, process_number, title, client_name, company_id, billing_type, monthly_value').in('id', allContractIds)
      : Promise.resolve({ data: [] as any[] }),
    allContractIds.length
      ? supabase.from('activities').select('contract_id, created_at').in('contract_id', allContractIds).order('created_at', { ascending: false })
      : Promise.resolve({ data: [] as any[] }),
    allContractIds.length
      ? supabase.from('contract_tags').select('contract_id, tags(id, name, color)').in('contract_id', allContractIds)
      : Promise.resolve({ data: [] as any[] }),
    salesPipelineIds.length
      ? supabase.from('stages').select('id, name, order_index, pipeline_id, sla_days').in('pipeline_id', salesPipelineIds).order('order_index')
      : Promise.resolve({ data: [] as any[] }),
    supabase.from('stages').select('id, name, order_index, pipeline_id').in('pipeline_id', (pipelines ?? []).map(p => p.id)).order('order_index'),
    // Soma de propostas ativas por contract_id (exclui recusadas)
    allContractIds.length
      ? supabase.from('proposals').select('contract_id, proposal_value, workflow_status').in('contract_id', allContractIds).is('deleted_at', null).not('workflow_status', 'in', '("cliente_recusado","declinada")')
      : Promise.resolve({ data: [] as any[] }),
  ])

  const contractById = new Map((contractsData ?? []).map((c: any) => [c.id, c]))

  // Contratos (Gestão de Contratos): selo Recorrente/Medição e, na medição,
  // o último mês lançado e quanto do potencial foi perdido.
  const isContractsPipeline = pipelineType === 'gestao_contratos'
  const meteredIds = isContractsPipeline ? [...new Set((runs ?? []).map((r: any) => r.contract_id as string))] : []
  const [{ data: measureRows }, { data: orgRow }] = await Promise.all([
    meteredIds.length
      ? supabase.from('billing_records').select('contract_id, year, month, amount, contract_value, status, discount_amount').in('contract_id', meteredIds)
      : Promise.resolve({ data: [] as any[] }),
    isContractsPipeline
      ? supabase.from('organization_settings').select('measurement_due_day').limit(1).maybeSingle()
      : Promise.resolve({ data: null as any }),
  ])
  const ref = pendingReference(todayBrasilia(), Number(orgRow?.measurement_due_day ?? 5))
  const lastMeasureByContract = new Map<string, any>()
  const refMeasureByContract = new Map<string, any>()
  for (const m of measureRows ?? []) {
    const prev = lastMeasureByContract.get(m.contract_id)
    if (!prev || m.year * 12 + m.month > prev.year * 12 + prev.month) lastMeasureByContract.set(m.contract_id, m)
    if (m.year === ref.year && m.month === ref.month) refMeasureByContract.set(m.contract_id, m)
  }
  function revenueInfo(contractId: string): RunCard['revenue'] {
    if (!isContractsPipeline) return undefined
    const c = contractById.get(contractId)
    const contractValue = Number(c?.monthly_value) || 0
    if (c?.billing_type !== 'metered') {
      // Recorrente: desconto do mês atual (ou do mês anterior), se houver
      const t = todayBrasilia()
      const cur = { y: t.getFullYear(), m: t.getMonth() + 1 }
      const recs = (measureRows ?? []).filter((b: any) => b.contract_id === contractId && Number(b.discount_amount) > 0)
      const hit = recs.find((b: any) => b.year === cur.y && b.month === cur.m) ?? recs.find((b: any) => b.year === ref.year && b.month === ref.month)
      return { type: 'fixed', contractValue, discount: hit ? { year: hit.year, month: hit.month, value: Number(hit.discount_amount) } : null }
    }
    const last = lastMeasureByContract.get(contractId)
    const refRec = refMeasureByContract.get(contractId)
    const lastInfo = last ? (() => {
      const cv = Number(last.contract_value ?? contractValue) || 0
      const net = Number(last.amount) || 0
      const lost = cv - net > 0 ? Math.round((cv - net) * 100) / 100 : 0
      return { year: last.year, month: last.month, net, lost, lostPct: cv > 0 ? Math.round((lost / cv) * 1000) / 10 : null, pending: last.status === 'aguardando_aprovacao' }
    })() : null
    return {
      type: 'metered',
      contractValue,
      last: lastInfo,
      refMissing: !refRec || refRec.status !== 'validado' ? { year: ref.year, month: ref.month, overdue: ref.overdue } : null,
    }
  }
  const stageById = new Map((stages ?? []).map((s) => [s.id, s]))
  const allStagesById = new Map((allStagesData ?? []).map((s: any) => [s.id, s]))
  const lostReasonById = new Map((lostReasons ?? []).map((r: any) => [r.id, r.name]))

  // Soma das propostas ativas por contract_id
  const proposalSumByContract = new Map<string, number>()
  for (const p of proposalAgg ?? []) {
    const prev = proposalSumByContract.get(p.contract_id) ?? 0
    proposalSumByContract.set(p.contract_id, prev + Number(p.proposal_value ?? 0))
  }

  const tagByContract = new Map<string, { id: string; name: string; color: string }>()
  for (const row of contractTagRows ?? []) {
    const tagValue = Array.isArray((row as any).tags) ? (row as any).tags[0] : (row as any).tags
    if (tagValue) tagByContract.set((row as any).contract_id, tagValue)
  }

  const lastActivityByContract = new Map<string, string>()
  for (const a of latestActivityRows ?? []) {
    if (!lastActivityByContract.has((a as any).contract_id)) lastActivityByContract.set((a as any).contract_id, (a as any).created_at)
  }

  function computeFreshness(contractId: string, stageEnteredAt: string, stageId: string): 'fresh' | 'warning' | 'stale' {
    const lastInteraction = lastActivityByContract.get(contractId) ?? stageEnteredAt
    const daysSince = (Date.now() - new Date(lastInteraction).getTime()) / 86_400_000
    const raw = stageById.get(stageId)?.sla_days ?? allStagesById.get(stageId)?.sla_days ?? DEFAULT_SLA_DAYS
    if (raw <= 0) return 'fresh'   // prazo 0 = etapa sem prazo
    const ratio = daysSince / raw
    if (ratio < 0.5) return 'fresh'
    if (ratio < 1) return 'warning'
    return 'stale'
  }

  function makeCard(r: any): RunCard {
    const contract = contractById.get(r.contract_id)
    return {
      runId: r.id,
      contractId: r.contract_id,
      companyId: contract?.company_id ?? null,
      stageId: r.stage_id,
      status: r.status as 'open' | 'won' | 'lost',
      processNumber: contract?.process_number ?? '',
      clientName: contract?.client_name ?? '',
      title: contract?.title ?? '',
      value: Number(r.value) || 0,
      stageEnteredAt: r.stage_entered_at,
      lastActivityAt: lastActivityByContract.get(r.contract_id) ?? null,
      validUntil: null,
      freshness: computeFreshness(r.contract_id, r.stage_entered_at, r.stage_id),
      tag: tagByContract.get(r.contract_id) ?? null,
      lostReasonName: r.lost_reason_id ? lostReasonById.get(r.lost_reason_id) ?? null : null,
      revenue: revenueInfo(r.contract_id),
    }
  }

  const cards: RunCard[] = (runs ?? []).map(makeCard)

  // Filtro por tag — aplica nos cards do Kanban atual
  const filteredCards = tagFilter
    ? cards.filter(c => c.tag?.id === tagFilter)
    : cards

  // Tags disponíveis nos cards do pipeline atual (para o seletor de filtro)
  const availableTags = [...new Map(
    cards.filter(c => c.tag).map(c => [c.tag!.id, c.tag!])
  ).values()]

  const openCards = cards.filter(c => c.status === 'open')
  const totalOpen = openCards.reduce((s, c) => s + c.value, 0)
  const fmtCurrency = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)

  return (
    <div className="flex flex-col gap-5">

      {/* Cards de seleção de funil — premium, um por funil */}
      {pipelines && pipelines.length > 1 && (
        <div className="flex gap-3 flex-wrap">
          {pipelines.map(p => {
            const isActive = p.id === selectedPipeline
            const badge = TYPE_COLOR[p.type] ?? TYPE_COLOR.vendas
            return (
              <Link key={p.id} href={`/pipeline?pipeline=${p.id}`} className="no-underline">
                <div className={`rounded-3xl p-4 bg-white shadow-[0_2px_16px_rgba(0,0,0,0.06)] cursor-pointer min-w-[160px] transition-all ${isActive ? 'ring-2 ring-[#1B556B] bg-[#1B556B]' : 'hover:shadow-md'}`}
                  style={isActive ? { background: '#1B556B' } : undefined}>
                  <span className="inline-block text-[10px] font-medium px-2 py-0.5 rounded-full mb-1.5"
                    style={{
                      background: isActive ? 'rgba(255,255,255,0.15)' : badge.bg,
                      color: isActive ? '#fff' : badge.color,
                    }}>
                    {TYPE_LABEL[p.type] ?? p.type}
                  </span>
                  <p className={`text-sm font-semibold m-0 ${isActive ? 'text-white' : 'text-[#1B556B]'}`}>{p.name}</p>
                  {isActive && (
                    <p className="text-[11px] text-white/60 mt-1">
                      {openCards.length} aberta{openCards.length !== 1 ? 's' : ''} · {fmtCurrency(totalOpen)}
                    </p>
                  )}
                </div>
              </Link>
            )
          })}
        </div>
      )}

      {/* Header do funil ativo */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-xl font-semibold text-[#1B556B] tracking-tight m-0">{pipelineName}</h1>
          <span className="px-2.5 py-0.5 rounded-full text-xs font-medium" style={{ background: typeBadge.bg, color: typeBadge.color }}>
            {TYPE_LABEL[pipelineType]}
          </span>
          {/* Filtro por tag */}
          {availableTags.length > 0 && (
            <div className="flex gap-1 items-center">
              <Link href={`/pipeline?${selectedPipeline ? `pipeline=${selectedPipeline}&` : ''}`}
                className={!tagFilter
                  ? 'px-3.5 py-1.5 text-xs font-medium rounded-xl bg-[#1B556B] text-white shadow-sm no-underline'
                  : 'px-3.5 py-1.5 text-xs font-medium rounded-xl text-gray-500 hover:text-gray-700 no-underline'}>
                Todos
              </Link>
              {availableTags.map(tag => (
                <Link key={tag.id} href={`/pipeline?${selectedPipeline ? `pipeline=${selectedPipeline}&` : ''}tag=${tag.id}`}
                  className="px-3.5 py-1.5 text-xs font-medium rounded-xl no-underline border"
                  style={{
                    background: tagFilter === tag.id ? tag.color : '#fff',
                    color: tagFilter === tag.id ? '#fff' : tag.color,
                    borderColor: tag.color,
                  }}>
                  {tag.name}
                </Link>
              ))}
              {tagFilter && (
                <span className="text-xs text-gray-400">
                  {filteredCards.filter(c => c.status === 'open').length} de {cards.filter(c => c.status === 'open').length} oportunidades
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Link
            href={`/contracts/new${selectedPipeline ? `?pipeline=${selectedPipeline}` : ''}`}
            className="px-4 py-2 text-xs font-medium rounded-xl bg-[#1B556B] text-white no-underline whitespace-nowrap"
          >
            + {pipelineType === 'vendas' ? 'Nova Oportunidade' : 'Novo Contrato'}
          </Link>
        </div>
      </div>

      {stages && stages.length > 0 ? (
        <KanbanBoard
          pipelineId={selectedPipeline as string}
          stages={stages}
          initialCards={filteredCards}
          showValidity={pipelineType === 'gestao_contratos'}
          wonLabel={pipelines?.find((p) => p.id === selectedPipeline)?.won_label ?? 'Ganho'}
          lostLabel={pipelines?.find((p) => p.id === selectedPipeline)?.lost_label ?? 'Perdido'}
          isAdmin={isAdmin}
          isGestao={pipelineType === 'gestao_contratos'}
          otherPipelines={
            (() => {
              const allPipelines = pipelines ?? []
              let targets: typeof allPipelines = []
              // Qualquer funil pode transferir para qualquer outro funil
              targets = allPipelines.filter(p => p.id !== selectedPipeline)
              return targets.length > 0
                ? targets.map(p => ({
                    id: p.id,
                    name: p.name,
                    stages: (allPipelineStages ?? allStagesData ?? []).filter((s: any) => s.pipeline_id === p.id).sort((a: any, b: any) => a.order_index - b.order_index),
                  }))
                : undefined
            })()
          }
        />
      ) : (
        <p className="text-sm text-gray-400">Nenhuma etapa cadastrada para este pipeline.</p>
      )}
    </div>
  )
}
