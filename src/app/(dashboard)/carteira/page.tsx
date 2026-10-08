import Link from 'next/link'
import { createClientForTenant } from '@/lib/supabase/server'
import { CarteiraSelectFilters } from '@/components/carteira/carteira-select-filters'

const TYPE_LABEL: Record<string, string> = { fixo: 'Fixo', medicao: 'Por Medição' }
const TYPE_STYLE: Record<string, { bg: string; color: string }> = {
  fixo:    { bg: '#eaf5ee', color: '#1a7c3e' },
  medicao: { bg: '#eef3ff', color: '#3b5bdb' },
}
const ABC_STYLE: Record<string, { bg: string; color: string }> = {
  A: { bg: '#fdecea', color: '#b91c1c' },
  B: { bg: '#fff8e6', color: '#92400e' },
  C: { bg: '#f1f3f8', color: '#8892a4' },
}

function fmt(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v)
}

function diasAVencer(validUntil: string | null): number | null {
  if (!validUntil) return null
  return Math.ceil((new Date(validUntil).getTime() - Date.now()) / 86400000)
}

function alertaStyle(dias: number | null): { bg: string; color: string; label: string } {
  if (dias === null) return { bg: '#f1f3f8', color: '#8892a4', label: 'Sem vigência' }
  if (dias < 0)    return { bg: '#fdecea', color: '#b91c1c', label: `Vencido há ${Math.abs(dias)}d` }
  if (dias <= 30)  return { bg: '#fdecea', color: '#b91c1c', label: `${dias}d ⚠` }
  if (dias <= 60)  return { bg: '#fff8e6', color: '#92400e', label: `${dias}d` }
  if (dias <= 90)  return { bg: '#fff8e6', color: '#92400e', label: `${dias}d` }
  return { bg: '#eaf5ee', color: '#1a7c3e', label: `${dias}d` }
}

export default async function CarteiraPage({
  searchParams,
}: {
  searchParams: Promise<{ tipo?: string; alerta?: string; q?: string; coord?: string; eng?: string }>
}) {
  const { tipo, alerta, q, coord: coordFilter, eng: engFilter } = await searchParams
  const { client: supabase, tenantId } = await createClientForTenant()

  let portPipelinesQ = supabase.from('pipelines').select('id').eq('type', 'gestao_contratos')
  if (tenantId) portPipelinesQ = portPipelinesQ.eq('tenant_id', tenantId)
  const { data: portfolioPipelines } = await portPipelinesQ
  const pipelineIds = (portfolioPipelines ?? []).map(p => p.id)

  const { data: activeRuns } = pipelineIds.length
    ? await supabase.from('pipeline_runs').select('contract_id, value').in('pipeline_id', pipelineIds).eq('status', 'open')
    : { data: [] as any[] }

  const contractIds = [...new Set((activeRuns ?? []).map((r: any) => r.contract_id))]

  let contractQuery = supabase
    .from('contracts')
    .select('id, process_number, title, client_name, contract_number, sankhya_code, cnpj_billing, contract_type, monthly_value, validity_months, valid_until, engineer_name, coordinator_name, abc_curve, sphere, segment, economic_group, nature, region, uf, score_weight, has_parts, has_audit, team_type, municipality, state, internal_notes, company_id, renewal_count')
    .in('id', contractIds.length ? contractIds : ['00000000-0000-0000-0000-000000000000'])

  if (tipo)        contractQuery = contractQuery.eq('contract_type', tipo)
  if (coordFilter) contractQuery = contractQuery.ilike('coordinator_name', `%${coordFilter}%`)
  if (engFilter)   contractQuery = contractQuery.ilike('engineer_name', `%${engFilter}%`)
  if (q?.trim())   contractQuery = contractQuery.or(`client_name.ilike.%${q.trim()}%,contract_number.ilike.%${q.trim()}%,coordinator_name.ilike.%${q.trim()}%`)

  const { data: contracts } = await contractQuery.order('client_name')
  const contractIdsForTags = (contracts ?? []).map((c: any) => c.id)

  // Busca tags dos contratos para exibir natureza (Eng. Clínica / Hospitalar)
  const { data: contractTagRows } = contractIdsForTags.length
    ? await supabase.from('contract_tags').select('contract_id, tags(id, name, color)').in('contract_id', contractIdsForTags)
    : { data: [] as any[] }

  const tagByContract = new Map<string, { name: string; color: string }>()
  for (const row of contractTagRows ?? []) {
    const tag = Array.isArray((row as any).tags) ? (row as any).tags[0] : (row as any).tags
    if (tag) tagByContract.set((row as any).contract_id, tag)
  }

  const valueByContract = new Map((activeRuns ?? []).map((r: any) => [r.contract_id, Number(r.value || 0)]))

  const enriched = (contracts ?? []).map((c: any) => ({
    ...c,
    pipelineValue: valueByContract.get(c.id) ?? 0,
    dias: diasAVencer(c.valid_until),
    tag: tagByContract.get(c.id) ?? null,
    // Natureza pelo campo nature ou pela tag
    naturezaLabel: (() => {
      const n = c.nature
      if (n === 'eng_clinica') return 'Eng. Clínica'
      if (n === 'eng_hospitalar') return 'Eng. Hospitalar'
      const tag = tagByContract.get(c.id)
      if (tag) {
        const t = tag.name.toLowerCase()
        if (t.includes('clínica') || t.includes('clinica')) return 'Eng. Clínica'
        if (t.includes('hospitalar')) return 'Eng. Hospitalar'
        return tag.name
      }
      return null
    })(),
  }))

  const filtered = alerta
    ? enriched.filter(c => {
        const d = c.dias
        if (alerta === 'vencido') return d !== null && d < 0
        if (alerta === '30')      return d !== null && d >= 0 && d <= 30
        if (alerta === '60')      return d !== null && d > 30 && d <= 60
        if (alerta === '90')      return d !== null && d > 60 && d <= 90
        return true
      })
    : enriched

  // KPIs
  const totalValorMensal = filtered.reduce((s, c) => s + (c.monthly_value ?? 0), 0)
  const vencendo30 = enriched.filter(c => c.dias !== null && c.dias >= 0 && c.dias <= 30).length
  const vencido = enriched.filter(c => c.dias !== null && c.dias < 0).length
  const fixos = filtered.filter(c => c.contract_type === 'fixo').length
  const medicoes = filtered.filter(c => c.contract_type === 'medicao').length

  // Rankings por nome livre
  const valueByCoord = new Map<string, number>()
  const countByCoord = new Map<string, number>()
  const valueByEng = new Map<string, number>()
  const countByEng = new Map<string, number>()
  for (const c of enriched) {
    if (c.coordinator_name) {
      valueByCoord.set(c.coordinator_name, (valueByCoord.get(c.coordinator_name) ?? 0) + (c.monthly_value ?? 0))
      countByCoord.set(c.coordinator_name, (countByCoord.get(c.coordinator_name) ?? 0) + 1)
    }
    if (c.engineer_name) {
      valueByEng.set(c.engineer_name, (valueByEng.get(c.engineer_name) ?? 0) + (c.monthly_value ?? 0))
      countByEng.set(c.engineer_name, (countByEng.get(c.engineer_name) ?? 0) + 1)
    }
  }
  const rankCoord = [...valueByCoord.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  const rankEng = [...valueByEng.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  const maxCoord = rankCoord[0]?.[1] ?? 1
  const maxEng = rankEng[0]?.[1] ?? 1

  // Curva ABC
  const abcCount: Record<'A' | 'B' | 'C', number> = { A: 0, B: 0, C: 0 }
  for (const c of enriched) {
    const curve = c.abc_curve as 'A' | 'B' | 'C' | null
    if (curve === 'A' || curve === 'B' || curve === 'C') abcCount[curve]++
  }

  const ALERTS = [
    { label: 'Todos', value: '' },
    { label: '🔴 Vencido', value: 'vencido' },
    { label: '🔴 30 dias', value: '30' },
    { label: '🟡 60 dias', value: '60' },
    { label: '🟢 90 dias', value: '90' },
  ]
  const TIPOS = [
    { label: 'Todos', value: '' },
    { label: 'Fixo', value: 'fixo' },
    { label: 'Por Medição', value: 'medicao' },
  ]

  function buildHref(overrides: Record<string, string>) {
    const params = new URLSearchParams({
      ...(tipo ? { tipo } : {}),
      ...(alerta ? { alerta } : {}),
      ...(q ? { q } : {}),
      ...(coordFilter ? { coord: coordFilter } : {}),
      ...(engFilter ? { eng: engFilter } : {}),
      ...overrides,
    })
    return `/carteira${params.toString() ? '?' + params.toString() : ''}`
  }

  return (
    <div className="flex flex-col gap-5">

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#1B556B] tracking-tight">Gestão de Carteira</h1>
          <p className="text-xs text-gray-400 mt-0.5">Contratos ativos no funil de Gestão de Contratos.</p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-5 gap-4">
        {[
          { label: 'Valor mensal total', value: fmt(totalValorMensal), sub: `${filtered.length} contratos ativos` },
          { label: 'Fixos', value: String(fixos), sub: 'receita previsível' },
          { label: 'Por medição', value: String(medicoes), sub: 'variável por entrega' },
          { label: '🔴 Vencidos', value: String(vencido), sub: 'requer ação imediata', alert: vencido > 0 },
          { label: '⚠ Vencendo em 30d', value: String(vencendo30), sub: 'monitorar', alert: vencendo30 > 0 },
        ].map(k => (
          <div key={k.label} className={`rounded-3xl p-5 bg-white shadow-[0_2px_16px_rgba(0,0,0,0.06)] ${(k as any).alert ? 'ring-1 ring-red-200' : ''}`}>
            <p className="text-xs font-medium uppercase tracking-wider text-gray-500 mb-3">{k.label}</p>
            <p className={`text-3xl font-bold tracking-tight mb-1 ${(k as any).alert ? 'text-red-700' : 'text-[#1B556B]'}`}>{k.value}</p>
            <p className={`text-xs ${(k as any).alert ? 'text-red-500' : 'text-gray-400'}`}>{k.sub}</p>
          </div>
        ))}
      </div>

      {/* ABC + Rankings */}
      <div className="grid gap-4" style={{ gridTemplateColumns: 'auto 1fr 1fr' }}>
        {/* Curva ABC resumo */}
        <div className="rounded-3xl p-5 bg-white shadow-[0_2px_16px_rgba(0,0,0,0.06)] min-w-[160px]">
          <p className="text-sm font-semibold text-[#1B556B] mb-4">Curva ABC</p>
          {(['A', 'B', 'C'] as const).map(curve => (
            <div key={curve} className="flex items-center justify-between mb-2">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold" style={{ background: ABC_STYLE[curve].bg, color: ABC_STYLE[curve].color }}>Curva {curve}</span>
              <span className="text-sm font-semibold text-[#1B556B]">{abcCount[curve]}</span>
            </div>
          ))}
          <p className="text-[10px] text-gray-300 mt-2">{enriched.filter(c => !c.abc_curve).length} sem classificação</p>
        </div>

        {/* Ranking Coordenadores */}
        <div className="rounded-3xl p-5 bg-white shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
          <p className="text-sm font-semibold text-[#1B556B] mb-4">Carteira por Coordenador</p>
          {rankCoord.length === 0 && <p className="text-xs text-gray-400">Nenhum coordenador atribuído ainda.</p>}
          {rankCoord.map(([name, val]) => (
            <div key={name} className="mb-3">
              <div className="flex justify-between mb-1">
                <span className="text-xs font-medium text-[#1B556B]">{name}</span>
                <span className="text-[11px] text-gray-500">{fmt(val)} · {countByCoord.get(name)} contratos</span>
              </div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${Math.round((val / maxCoord) * 100)}%`, background: 'linear-gradient(90deg, #1B556B, #32AF9D)' }} />
              </div>
            </div>
          ))}
        </div>

        {/* Ranking Engenheiros */}
        <div className="rounded-3xl p-5 bg-white shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
          <p className="text-sm font-semibold text-[#1B556B] mb-4">Carteira por Engenheiro</p>
          {rankEng.length === 0 && <p className="text-xs text-gray-400">Nenhum engenheiro atribuído ainda.</p>}
          {rankEng.map(([name, val]) => (
            <div key={name} className="mb-3">
              <div className="flex justify-between mb-1">
                <span className="text-xs font-medium text-[#1B556B]">{name}</span>
                <span className="text-[11px] text-gray-500">{fmt(val)} · {countByEng.get(name)} contratos</span>
              </div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${Math.round((val / maxEng) * 100)}%`, background: 'linear-gradient(90deg, #1B556B, #32AF9D)' }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tabela */}
      <div className="rounded-3xl bg-white shadow-[0_2px_16px_rgba(0,0,0,0.06)] overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex flex-col gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium uppercase tracking-wider text-gray-400">Tipo:</span>
            {TIPOS.map(t => (
              <Link key={t.value} href={buildHref({ tipo: t.value })}
                className={(tipo ?? '') === t.value
                  ? 'px-3.5 py-1.5 text-xs font-medium rounded-xl bg-[#1B556B] text-white shadow-sm no-underline'
                  : 'px-3.5 py-1.5 text-xs font-medium rounded-xl text-gray-500 hover:text-gray-700 no-underline'}>
                {t.label}
              </Link>
            ))}
            <span className="w-px h-4 bg-gray-200 mx-1" />
            <span className="text-xs font-medium uppercase tracking-wider text-gray-400">Vencimento:</span>
            {ALERTS.map(a => (
              <Link key={a.value} href={buildHref({ alerta: a.value })}
                className={(alerta ?? '') === a.value
                  ? 'px-3.5 py-1.5 text-xs font-medium rounded-xl bg-[#1B556B] text-white shadow-sm no-underline'
                  : 'px-3.5 py-1.5 text-xs font-medium rounded-xl text-gray-500 hover:text-gray-700 no-underline'}>
                {a.label}
              </Link>
            ))}
          </div>
          <div className="flex gap-2">
            <form method="GET" className="flex gap-1.5">
              {tipo && <input type="hidden" name="tipo" value={tipo} />}
              {alerta && <input type="hidden" name="alerta" value={alerta} />}
              <input type="text" name="q" defaultValue={q ?? ''} placeholder="Buscar cliente, nº contrato, coordenador..."
                className="px-3 py-1.5 text-xs rounded-xl border border-gray-200 bg-gray-50 text-[#1B556B] outline-none w-64 focus:ring-2 focus:ring-[#1B556B]/20" />
              <button type="submit" className="px-4 py-2 text-xs font-medium rounded-xl border border-gray-200 bg-white text-gray-600 no-underline cursor-pointer">Buscar</button>
              {q && <Link href="/carteira" className="px-3 py-1.5 text-xs text-gray-400 no-underline self-center">Limpar</Link>}
            </form>
            <CarteiraSelectFilters
              coords={[...valueByCoord.keys()].map(n => ({ id: n, name: n }))}
              engs={[...valueByEng.keys()].map(n => ({ id: n, name: n }))}
              currentCoord={coordFilter}
              currentEng={engFilter}
              baseUrl="/carteira"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse" style={{ minWidth: 900 }}>
            <thead>
              <tr className="border-b border-gray-100">
                {['Cliente', 'Natureza', 'Nº Contrato', 'Tipo', 'Valor/mês', 'Coordenador', 'Engenheiro', 'ABC', 'Vencimento', 'Alerta', ''].map((h, i) => (
                  <th key={h + i} className="text-xs font-medium uppercase tracking-wider text-gray-400 py-3 px-4 text-left whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => {
                const alert = alertaStyle(c.dias)
                const typeSt = c.contract_type ? TYPE_STYLE[c.contract_type] : null
                const abcSt = c.abc_curve ? ABC_STYLE[c.abc_curve] : null
                const isVencido = (c.dias ?? 0) < 0
                return (
                  <tr key={c.id} className={`border-b border-gray-50 ${isVencido ? 'bg-red-50/40' : ''}`}>
                    <td className="py-3 px-4">
                      <Link href={`/contracts/${c.id}`} className="no-underline">
                        <p className={`text-sm font-medium m-0 ${isVencido ? 'text-red-700' : 'text-[#1B556B]'}`}>{c.client_name}</p>
                        {c.municipality && <p className="text-[11px] text-gray-400 mt-0.5">{c.municipality}</p>}
                      </Link>
                    </td>
                    <td className="py-3 px-4">
                      {c.naturezaLabel ? (
                        <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium"
                          style={{
                            background: c.naturezaLabel.includes('Hospit') ? '#eef3ff' : '#eaf5ee',
                            color: c.naturezaLabel.includes('Hospit') ? '#3b5bdb' : '#1a7c3e',
                          }}>
                          {c.naturezaLabel}
                        </span>
                      ) : <span className="text-[11px] text-gray-200">—</span>}
                    </td>
                    <td className="py-3 px-4 text-[11px] font-mono text-gray-400">
                      {c.contract_number ?? c.process_number}
                      {c.sankhya_code && <p className="text-[10px] text-gray-300 mt-0.5">{c.sankhya_code}</p>}
                    </td>
                    <td className="py-3 px-4">
                      {typeSt ? <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium" style={{ background: typeSt.bg, color: typeSt.color }}>{TYPE_LABEL[c.contract_type!]}</span>
                        : <span className="text-[11px] text-gray-200">—</span>}
                    </td>
                    <td className="py-3 px-4 text-sm font-semibold text-[#1B556B]">
                      {c.monthly_value ? fmt(c.monthly_value) : <span className="text-gray-200 text-[11px]">—</span>}
                    </td>
                    <td className="py-3 px-4 text-xs text-gray-500">{c.coordinator_name ?? <span className="text-gray-200">—</span>}</td>
                    <td className="py-3 px-4 text-xs text-gray-500">{c.engineer_name ?? <span className="text-gray-200">—</span>}</td>
                    <td className="py-3 px-4">
                      {abcSt ? <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: abcSt.bg, color: abcSt.color }}>{c.abc_curve}</span>
                        : <span className="text-gray-200 text-[11px]">—</span>}
                      {c.score_weight ? <p className="text-[9px] text-gray-300 mt-0.5">Peso {c.score_weight}</p> : null}
                    </td>
                    <td className={`py-3 px-4 text-[11px] ${isVencido ? 'text-red-700' : 'text-gray-500'}`}>
                      {c.valid_until ? new Date(c.valid_until + 'T12:00:00').toLocaleDateString('pt-BR') : <span className="text-gray-200">—</span>}
                    </td>
                    <td className="py-3 px-4">
                      <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap" style={{ background: alert.bg, color: alert.color }}>{alert.label}</span>
                    </td>
                    <td className="py-3 px-4">
                      <Link href={`/contracts/${c.id}`} className="text-[11px] text-[#1B556B] no-underline font-medium">Ver</Link>
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={10} className="py-12 px-4 text-center text-sm text-gray-400">
                  {contractIds.length === 0 ? 'Nenhum contrato no funil de Gestão de Contratos ainda.' : 'Nenhum contrato com esses filtros.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
