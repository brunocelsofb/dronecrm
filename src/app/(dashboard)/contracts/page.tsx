import Link from 'next/link'
import { createClientForTenant } from '@/lib/supabase/server'
import { ContractsTable } from '@/components/contracts/contracts-table'

function fmt(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v)
}

export default async function ContractsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>
}) {
  const { q, status } = await searchParams
  const { client: supabase, tenantId } = await createClientForTenant()

  // Busca só pipelines de tipo 'vendas' — Oportunidades são exclusivamente
  // negócios em negociação, não contratos de gestão de carteira.
  let salesPipelinesQ = supabase
    .from('pipelines').select('id, is_default').eq('type', 'vendas')
  if (tenantId) salesPipelinesQ = salesPipelinesQ.eq('tenant_id', tenantId)
  const { data: salesPipelines } = await salesPipelinesQ
  const salesPipelineIds = (salesPipelines ?? []).map(p => p.id)
  const defaultSalesPipeline = salesPipelines?.find(p => p.is_default)?.id ?? salesPipelineIds[0]

  let query = salesPipelineIds.length
    ? supabase
        .from('pipeline_runs')
        .select('contract_id, status, value, stage_id, pipeline_id, started_at, ended_at')
        .in('pipeline_id', salesPipelineIds)
        .order('started_at', { ascending: false })
    : supabase
        .from('pipeline_runs')
        .select('contract_id, status, value, stage_id, pipeline_id, started_at, ended_at')
        .eq('pipeline_id', '00000000-0000-0000-0000-000000000000')

  if (status && status !== 'all') query = query.eq('status', status)

  const { data: runs } = await query

  // Deduplica por contract_id — prioriza open/won/lost sobre moved
  const latestRunByContract = new Map<string, any>()
  for (const r of (runs ?? [])) {
    const existing = latestRunByContract.get(r.contract_id)
    const rActive = r.status !== 'moved'
    const exActive = existing?.status !== 'moved'
    if (!existing) { latestRunByContract.set(r.contract_id, r); continue }
    // Ativo sempre vence moved
    if (rActive && !exActive) { latestRunByContract.set(r.contract_id, r); continue }
    if (!rActive && exActive) continue
    // Entre dois do mesmo tipo, pega o mais recente
    if (new Date(r.started_at) > new Date(existing.started_at)) {
      latestRunByContract.set(r.contract_id, r)
    }
  }
  const deduplicatedRuns = Array.from(latestRunByContract.values())

  // Pega os contratos correspondentes
  const runContractIds = [...new Set(deduplicatedRuns.map(r => r.contract_id))]
  const { data: contractsData } = runContractIds.length
    ? await supabase.from('contracts').select('id, process_number, title, client_name, created_at').in('id', runContractIds)
    : { data: [] as any[] }

  const contractById = new Map((contractsData ?? []).map(c => [c.id, c]))

  // Filtra por texto se necessário
  const filteredRuns = q?.trim()
    ? deduplicatedRuns.filter(r => {
        const c = contractById.get(r.contract_id)
        const term = q.trim().toLowerCase()
        return c?.client_name?.toLowerCase().includes(term) || c?.title?.toLowerCase().includes(term) || c?.process_number?.toLowerCase().includes(term)
      })
    : deduplicatedRuns

  const stageIds = [...new Set(filteredRuns.map(r => r.stage_id).filter(Boolean))]
  const contractIds = [...new Set(filteredRuns.map(r => r.contract_id))]

  const [{ data: stages }, { data: validityData }] = await Promise.all([
    stageIds.length ? supabase.from('stages').select('id, name, color').in('id', stageIds) : Promise.resolve({ data: [] as any[] }),
    contractIds.length ? supabase.from('contracts').select('id, valid_until').in('id', contractIds) : Promise.resolve({ data: [] as any[] }),
  ])

  const stageById = new Map((stages ?? []).map((s: any) => [s.id, s]))
  const validUntilById = new Map((validityData ?? []).map((c: any) => [c.id, c.valid_until]))

  // Busca a soma das propostas ativas por contract_id
  // Exclui: cliente_recusado (recusada), deleted_at não null
  const EXCLUDED_STATUSES = ['cliente_recusado', 'declinada']
  const proposalSumByContract = new Map<string, number>()
  if (contractIds.length > 0) {
    const { data: proposalAgg } = await supabase
      .from('proposals')
      .select('contract_id, proposal_value, workflow_status')
      .in('contract_id', contractIds)
      .is('deleted_at', null)
      .not('workflow_status', 'in', `(${EXCLUDED_STATUSES.map(s => `"${s}"`).join(',')})`)

    for (const p of proposalAgg ?? []) {
      const prev = proposalSumByContract.get(p.contract_id) ?? 0
      proposalSumByContract.set(p.contract_id, prev + Number(p.proposal_value ?? 0))
    }
  }

  const enriched = filteredRuns.map(r => {
    const c = contractById.get(r.contract_id) ?? { id: r.contract_id, process_number: '', title: '', client_name: '', created_at: '' }
    // Usa soma de propostas ativas; fallback para pipeline_run.value se não houver propostas
    const proposalSum = proposalSumByContract.get(r.contract_id)
    const value = proposalSum !== undefined ? proposalSum : Number(r.value ?? 0)
    return {
      id: c.id,
      process_number: c.process_number,
      title: c.title,
      client_name: c.client_name,
      value,
      run_status: r.status,
      stage_id: r.stage_id,
      pipeline_id: r.pipeline_id,
      stage: r.stage_id ? stageById.get(r.stage_id) ?? null : null,
      valid_until: validUntilById.get(c.id) ?? null,
    }
  })

  const total = enriched.reduce((s, c) => s + Number(c.value || 0), 0)
  const open = enriched.filter(c => c.run_status === 'open').length
  const won = enriched.filter(c => c.run_status === 'won').length
  const lost = enriched.filter(c => c.run_status === 'lost').length

  const FILTERS = [
    { label: 'Todas', value: 'all' },
    { label: 'Em andamento', value: 'open' },
    { label: 'Ganhas', value: 'won' },
    { label: 'Perdidas', value: 'lost' },
  ]
  const activeFilter = status ?? 'all'

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#1B556B] tracking-tight">Oportunidades</h1>
          <p className="text-xs text-gray-400 mt-0.5">Todas as oportunidades e contratos ativos</p>
        </div>
        <Link href={`/contracts/new${defaultSalesPipeline ? `?pipeline=${defaultSalesPipeline}` : ''}`}
          className="px-4 py-2 text-xs font-medium rounded-xl bg-[#1B556B] text-white no-underline">
          + Nova oportunidade
        </Link>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Valor total', value: fmt(total), sub: `${enriched.length} oportunidades` },
          { label: 'Em andamento', value: String(open), sub: 'oportunidades abertas' },
          { label: 'Ganhas', value: String(won), sub: 'oportunidades fechadas' },
          { label: 'Perdidas', value: String(lost), sub: 'oportunidades perdidas' },
        ].map(k => (
          <div key={k.label} className="rounded-3xl p-5 bg-white shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
            <p className="text-xs font-medium uppercase tracking-wider text-gray-500 mb-3">{k.label}</p>
            <p className="text-3xl font-bold text-[#1B556B] tracking-tight">{k.value}</p>
            <p className="text-xs text-gray-400 mt-1">{k.sub}</p>
          </div>
        ))}
      </div>

      <div className="rounded-3xl bg-white shadow-[0_2px_16px_rgba(0,0,0,0.06)] overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 flex-wrap">
          <div className="flex gap-1.5 bg-gray-100 rounded-2xl p-1">
            {FILTERS.map(f => (
              <Link key={f.value} href={`/contracts?status=${f.value}${q ? `&q=${q}` : ''}`}
                className={activeFilter === f.value
                  ? 'px-3.5 py-1.5 text-xs font-medium rounded-xl bg-[#1B556B] text-white shadow-sm no-underline'
                  : 'px-3.5 py-1.5 text-xs font-medium rounded-xl text-gray-500 hover:text-gray-700 no-underline'}>
                {f.label}
              </Link>
            ))}
          </div>
          <div className="flex-1" />
          <form method="GET" className="flex gap-2">
            {status && <input type="hidden" name="status" value={status} />}
            <div className="relative">
              <input type="text" name="q" defaultValue={q ?? ''} placeholder="Buscar empresa ou processo…"
                className="w-full pl-9 pr-4 py-2 text-sm rounded-2xl border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-[#1B556B]/20" />
            </div>
            <button type="submit" className="px-4 py-2 text-xs font-medium rounded-xl border border-gray-200 bg-white text-gray-600 no-underline cursor-pointer">Buscar</button>
            {q && <Link href="/contracts" className="px-4 py-2 text-xs font-medium rounded-xl text-gray-500 no-underline self-center">Limpar</Link>}
          </form>
        </div>

        <ContractsTable contracts={enriched} q={q} />
      </div>
    </div>
  )
}
