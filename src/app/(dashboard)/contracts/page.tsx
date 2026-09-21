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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 500, color: '#1a1f36', margin: 0 }}>Oportunidades</h1>
          <p style={{ fontSize: 12, color: '#8892a4', marginTop: 3 }}>Todas as oportunidades e contratos ativos</p>
        </div>
        <Link href={`/contracts/new${defaultSalesPipeline ? `?pipeline=${defaultSalesPipeline}` : ''}`}
          style={{ padding: '7px 14px', fontSize: 12, borderRadius: 8, background: '#1a1f36', color: '#fff', textDecoration: 'none', fontWeight: 500 }}>
          + Nova oportunidade
        </Link>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {[
          { label: 'Valor total', value: fmt(total), sub: `${enriched.length} oportunidades` },
          { label: 'Em andamento', value: String(open), sub: 'oportunidades abertas' },
          { label: 'Ganhas', value: String(won), sub: 'oportunidades fechadas' },
          { label: 'Perdidas', value: String(lost), sub: 'oportunidades perdidas' },
        ].map(k => (
          <div key={k.label} style={{ background: '#fff', borderRadius: 12, padding: '14px 16px', border: '0.5px solid #e8edf5' }}>
            <p style={{ fontSize: 10, color: '#8892a4', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 6 }}>{k.label}</p>
            <p style={{ fontSize: 20, fontWeight: 500, color: '#1a1f36', letterSpacing: '-0.5px' }}>{k.value}</p>
            <p style={{ fontSize: 11, color: '#8892a4', marginTop: 3 }}>{k.sub}</p>
          </div>
        ))}
      </div>

      <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #e8edf5', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 16px', borderBottom: '0.5px solid #f1f3f8', flexWrap: 'wrap' }}>
          {FILTERS.map(f => (
            <Link key={f.value} href={`/contracts?status=${f.value}${q ? `&q=${q}` : ''}`}
              style={{ padding: '4px 12px', fontSize: 11, borderRadius: 20, border: '0.5px solid', textDecoration: 'none',
                borderColor: activeFilter === f.value ? '#1a1f36' : '#d1d8e8',
                background: activeFilter === f.value ? '#1a1f36' : '#fff',
                color: activeFilter === f.value ? '#fff' : '#8892a4' }}>
              {f.label}
            </Link>
          ))}
          <div style={{ flex: 1 }} />
          <form method="GET" style={{ display: 'flex', gap: 6 }}>
            {status && <input type="hidden" name="status" value={status} />}
            <input type="text" name="q" defaultValue={q ?? ''} placeholder="Buscar empresa ou processo…"
              style={{ padding: '6px 10px', fontSize: 12, borderRadius: 8, border: '0.5px solid #d1d8e8', background: '#f8f9fb', color: '#1a1f36', outline: 'none', width: 220 }} />
            <button type="submit" style={{ padding: '6px 12px', fontSize: 11, borderRadius: 8, border: '0.5px solid #d1d8e8', background: '#fff', color: '#52514e', cursor: 'pointer' }}>Buscar</button>
            {q && <Link href="/contracts" style={{ padding: '6px 10px', fontSize: 11, color: '#8892a4', textDecoration: 'none', alignSelf: 'center' }}>Limpar</Link>}
          </form>
        </div>

        <ContractsTable contracts={enriched} q={q} />
      </div>
    </div>
  )
}
