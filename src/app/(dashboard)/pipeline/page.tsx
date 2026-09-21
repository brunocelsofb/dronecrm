import Link from 'next/link'
import { createClientForTenant } from '@/lib/supabase/server'
import { KanbanBoard, type RunCard } from '@/components/pipeline/kanban-board'
import { PipelineSelect } from '@/components/pipeline/pipeline-select'
import { PipelineDashboard } from '@/components/pipeline/pipeline-dashboard'
import { isCurrentUserAdmin } from '@/lib/auth/role'
import { checkAndTriggerRenewals } from '@/lib/actions/pipeline'

const DEFAULT_SLA_DAYS = 7 // usado quando a etapa não tem SLA configurado

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ pipeline?: string; dash?: string; tag?: string }>
}) {
  const { pipeline: pipelineIdParam, dash, tag: tagFilter } = await searchParams
  const showDash = dash === '1'
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
    vendas: { bg: '#eaf5ee', color: '#1a7c3e' },
    gestao_contratos: { bg: '#eef3ff', color: '#3b5bdb' },
    servico_avulso: { bg: '#fff8e6', color: '#92400e' },
  }
  const typeBadge = TYPE_COLOR[pipelineType] ?? TYPE_COLOR.vendas

  // Busca dados do funil selecionado (para o Kanban)
  const [{ data: stages }, { data: runs }] = await Promise.all([
    selectedPipeline
      ? supabase.from('stages').select('id, name, order_index, sla_days').eq('pipeline_id', selectedPipeline).order('order_index')
      : Promise.resolve({ data: [] as { id: string; name: string; order_index: number; sla_days: number | null }[] }),
    selectedPipeline
      ? supabase.from('pipeline_runs').select('id, contract_id, stage_id, stage_entered_at, value, status').eq('pipeline_id', selectedPipeline).in('status', ['open', 'won', 'lost'])
      : Promise.resolve({ data: [] as any[] }),
  ])

  // Para o Dashboard: busca TODOS os runs de todos os funis de vendas
  const salesPipelineIds = (pipelines ?? []).filter(p => p.type === 'vendas').map(p => p.id)
  const [{ data: allSalesRuns }, { data: lostReasons }] = await Promise.all([
    salesPipelineIds.length
      ? supabase.from('pipeline_runs').select('id, contract_id, stage_id, stage_entered_at, value, status, pipeline_id').in('pipeline_id', salesPipelineIds).in('status', ['open', 'won', 'lost'])
      : Promise.resolve({ data: [] as any[] }),
    (() => { let lrQ = supabase.from('lost_reasons').select('id, name').eq('active', true).order('display_order'); if (tenantId) lrQ = lrQ.eq('tenant_id', tenantId); return lrQ })(),
  ])

  const allContractIds = [...new Set([
    ...(runs ?? []).map((r: any) => r.contract_id),
    ...(allSalesRuns ?? []).map((r: any) => r.contract_id),
  ])]

  const [{ data: contractsData }, { data: latestActivityRows }, { data: contractTagRows }, { data: allStagesData }, { data: allPipelineStages }, { data: proposalAgg }] = await Promise.all([
    allContractIds.length
      ? supabase.from('contracts').select('id, process_number, title, client_name, company_id').in('id', allContractIds)
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
    const sla = stageById.get(stageId)?.sla_days ?? allStagesById.get(stageId)?.sla_days ?? DEFAULT_SLA_DAYS
    const ratio = daysSince / sla
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
    }
  }

  const cards: RunCard[] = (runs ?? []).map(makeCard)
  const allSalesCards: RunCard[] = (allSalesRuns ?? []).map(makeCard)

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
  const fmtCurrency = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Cards de seleção de funil — premium, um por funil */}
      {pipelines && pipelines.length > 1 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {pipelines.map(p => {
            const isActive = p.id === selectedPipeline
            const badge = TYPE_COLOR[p.type] ?? TYPE_COLOR.vendas
            return (
              <Link key={p.id} href={`/pipeline?pipeline=${p.id}`} style={{ textDecoration: 'none' }}>
                <div style={{
                  padding: '10px 16px', borderRadius: 10, minWidth: 160, cursor: 'pointer',
                  border: `0.5px solid ${isActive ? '#1a1f36' : '#e8edf5'}`,
                  background: isActive ? '#1a1f36' : '#fff',
                  transition: 'all 0.15s',
                }}>
                  <span style={{
                    display: 'inline-block', fontSize: 10, fontWeight: 500, padding: '1px 7px', borderRadius: 20, marginBottom: 5,
                    background: isActive ? 'rgba(255,255,255,0.12)' : badge.bg,
                    color: isActive ? '#fff' : badge.color,
                  }}>
                    {TYPE_LABEL[p.type] ?? p.type}
                  </span>
                  <p style={{ fontSize: 13, fontWeight: 500, color: isActive ? '#fff' : '#1a1f36', margin: 0 }}>{p.name}</p>
                  {isActive && (
                    <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 3 }}>
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 18, fontWeight: 500, color: '#1a1f36', margin: 0 }}>{pipelineName}</h1>
          <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 500, background: typeBadge.bg, color: typeBadge.color }}>
            {TYPE_LABEL[pipelineType]}
          </span>
          {/* Filtro por tag */}
          {availableTags.length > 0 && (
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <Link href={`/pipeline?${selectedPipeline ? `pipeline=${selectedPipeline}&` : ''}`}
                style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, border: '0.5px solid', textDecoration: 'none', background: !tagFilter ? '#1a1f36' : '#fff', color: !tagFilter ? '#fff' : '#8892a4', borderColor: !tagFilter ? '#1a1f36' : '#d1d8e8' }}>
                Todos
              </Link>
              {availableTags.map(tag => (
                <Link key={tag.id} href={`/pipeline?${selectedPipeline ? `pipeline=${selectedPipeline}&` : ''}tag=${tag.id}`}
                  style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, border: '0.5px solid', textDecoration: 'none', fontWeight: 500, background: tagFilter === tag.id ? tag.color : '#fff', color: tagFilter === tag.id ? '#fff' : tag.color, borderColor: tag.color }}>
                  {tag.name}
                </Link>
              ))}
              {tagFilter && (
                <span style={{ fontSize: 11, color: '#8892a4' }}>
                  {filteredCards.filter(c => c.status === 'open').length} de {cards.filter(c => c.status === 'open').length} oportunidades
                </span>
              )}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {showDash ? (
            <Link href={`/pipeline${selectedPipeline ? `?pipeline=${selectedPipeline}` : ''}`}
              style={{ whiteSpace: 'nowrap', borderRadius: 8, border: '0.5px solid #d1d8e8', background: '#fff', padding: '7px 14px', fontSize: 12, fontWeight: 500, color: '#52514e', textDecoration: 'none' }}>
              ← Kanban
            </Link>
          ) : (
            <Link href={`/pipeline?${selectedPipeline ? `pipeline=${selectedPipeline}&` : ''}dash=1`}
              style={{ whiteSpace: 'nowrap', borderRadius: 8, background: '#3b5bdb', padding: '7px 16px', fontSize: 12, fontWeight: 500, color: '#fff', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 14 }}>📊</span> Gestão à vista
            </Link>
          )}
          {!showDash && (
            <Link
              href={`/contracts/new${selectedPipeline ? `?pipeline=${selectedPipeline}` : ''}`}
              style={{ whiteSpace: 'nowrap', borderRadius: 8, background: '#1a1f36', padding: '7px 14px', fontSize: 12, fontWeight: 500, color: '#fff', textDecoration: 'none' }}
            >
              + {pipelineType === 'vendas' ? 'Nova Oportunidade' : 'Novo Contrato'}
            </Link>
          )}
        </div>
      </div>

      {showDash ? (
        <PipelineDashboard
          pipelineId={selectedPipeline as string}
          pipelineName={pipelineName}
          stages={stages ?? []}
          cards={cards}
          allSalesCards={allSalesCards}
          allStages={allStagesData ?? []}
          salesPipelines={(pipelines ?? []).filter(p => p.type === 'vendas')}
          lostReasons={lostReasons ?? []}
          selectedPipeline={selectedPipeline as string}
        />
      ) : stages && stages.length > 0 ? (
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
        <p style={{ fontSize: 13, color: '#8892a4' }}>Nenhuma etapa cadastrada para este pipeline.</p>
      )}
    </div>
  )
}
