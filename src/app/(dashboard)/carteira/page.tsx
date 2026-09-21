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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 500, color: '#1a1f36', margin: 0 }}>Gestão de Carteira</h1>
          <p style={{ fontSize: 12, color: '#8892a4', marginTop: 3 }}>Contratos ativos no funil de Gestão de Contratos.</p>
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
        {[
          { label: 'Valor mensal total', value: fmt(totalValorMensal), sub: `${filtered.length} contratos ativos` },
          { label: 'Fixos', value: String(fixos), sub: 'receita previsível' },
          { label: 'Por medição', value: String(medicoes), sub: 'variável por entrega' },
          { label: '🔴 Vencidos', value: String(vencido), sub: 'requer ação imediata', alert: vencido > 0 },
          { label: '⚠ Vencendo em 30d', value: String(vencendo30), sub: 'monitorar', alert: vencendo30 > 0 },
        ].map(k => (
          <div key={k.label} style={{ background: '#fff', borderRadius: 12, padding: '14px 16px', border: `0.5px solid ${(k as any).alert ? '#fca5a5' : '#e8edf5'}` }}>
            <p style={{ fontSize: 10, color: '#8892a4', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 6 }}>{k.label}</p>
            <p style={{ fontSize: 20, fontWeight: 500, color: (k as any).alert ? '#b91c1c' : '#1a1f36', letterSpacing: '-0.5px', margin: 0 }}>{k.value}</p>
            <p style={{ fontSize: 11, color: (k as any).alert ? '#b91c1c' : '#8892a4', marginTop: 3 }}>{k.sub}</p>
          </div>
        ))}
      </div>

      {/* ABC + Rankings */}
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 1fr', gap: 12 }}>
        {/* Curva ABC resumo */}
        <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #e8edf5', padding: 20, minWidth: 160 }}>
          <p style={{ fontSize: 13, fontWeight: 500, color: '#1a1f36', marginBottom: 16 }}>Curva ABC</p>
          {(['A', 'B', 'C'] as const).map(curve => (
            <div key={curve} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ padding: '2px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700, ...ABC_STYLE[curve] }}>Curva {curve}</span>
              <span style={{ fontSize: 14, fontWeight: 500, color: '#1a1f36' }}>{abcCount[curve]}</span>
            </div>
          ))}
          <p style={{ fontSize: 10, color: '#b0b8c8', marginTop: 8 }}>{enriched.filter(c => !c.abc_curve).length} sem classificação</p>
        </div>

        {/* Ranking Coordenadores */}
        <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #e8edf5', padding: 20 }}>
          <p style={{ fontSize: 13, fontWeight: 500, color: '#1a1f36', marginBottom: 16 }}>Carteira por Coordenador</p>
          {rankCoord.length === 0 && <p style={{ fontSize: 12, color: '#8892a4' }}>Nenhum coordenador atribuído ainda.</p>}
          {rankCoord.map(([name, val]) => (
            <div key={name} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 12, color: '#1a1f36', fontWeight: 500 }}>{name}</span>
                <span style={{ fontSize: 11, color: '#52514e' }}>{fmt(val)} · {countByCoord.get(name)} contratos</span>
              </div>
              <div style={{ height: 6, background: '#f1f3f8', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.round((val / maxCoord) * 100)}%`, background: 'linear-gradient(90deg, #4f86f7, #7c3aed)', borderRadius: 3 }} />
              </div>
            </div>
          ))}
        </div>

        {/* Ranking Engenheiros */}
        <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #e8edf5', padding: 20 }}>
          <p style={{ fontSize: 13, fontWeight: 500, color: '#1a1f36', marginBottom: 16 }}>Carteira por Engenheiro</p>
          {rankEng.length === 0 && <p style={{ fontSize: 12, color: '#8892a4' }}>Nenhum engenheiro atribuído ainda.</p>}
          {rankEng.map(([name, val]) => (
            <div key={name} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 12, color: '#1a1f36', fontWeight: 500 }}>{name}</span>
                <span style={{ fontSize: 11, color: '#52514e' }}>{fmt(val)} · {countByEng.get(name)} contratos</span>
              </div>
              <div style={{ height: 6, background: '#f1f3f8', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.round((val / maxEng) * 100)}%`, background: 'linear-gradient(90deg, #1a7c3e, #32af9d)', borderRadius: 3 }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tabela */}
      <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #e8edf5', overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', borderBottom: '0.5px solid #f1f3f8', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, color: '#8892a4', textTransform: 'uppercase' }}>Tipo:</span>
            {TIPOS.map(t => (
              <Link key={t.value} href={buildHref({ tipo: t.value })}
                style={{ padding: '4px 10px', fontSize: 11, borderRadius: 20, textDecoration: 'none', border: '0.5px solid', borderColor: (tipo ?? '') === t.value ? '#1a1f36' : '#d1d8e8', background: (tipo ?? '') === t.value ? '#1a1f36' : '#fff', color: (tipo ?? '') === t.value ? '#fff' : '#8892a4' }}>
                {t.label}
              </Link>
            ))}
            <span style={{ width: 1, height: 16, background: '#e8edf5', margin: '0 4px' }} />
            <span style={{ fontSize: 10, color: '#8892a4', textTransform: 'uppercase' }}>Vencimento:</span>
            {ALERTS.map(a => (
              <Link key={a.value} href={buildHref({ alerta: a.value })}
                style={{ padding: '4px 10px', fontSize: 11, borderRadius: 20, textDecoration: 'none', border: '0.5px solid', borderColor: (alerta ?? '') === a.value ? '#1a1f36' : '#d1d8e8', background: (alerta ?? '') === a.value ? '#1a1f36' : '#fff', color: (alerta ?? '') === a.value ? '#fff' : '#8892a4' }}>
                {a.label}
              </Link>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <form method="GET" style={{ display: 'flex', gap: 6 }}>
              {tipo && <input type="hidden" name="tipo" value={tipo} />}
              {alerta && <input type="hidden" name="alerta" value={alerta} />}
              <input type="text" name="q" defaultValue={q ?? ''} placeholder="Buscar cliente, nº contrato, coordenador..."
                style={{ padding: '6px 10px', fontSize: 12, borderRadius: 8, border: '0.5px solid #d1d8e8', background: '#f8f9fb', color: '#1a1f36', outline: 'none', width: 260 }} />
              <button type="submit" style={{ padding: '6px 12px', fontSize: 11, borderRadius: 8, border: '0.5px solid #d1d8e8', background: '#fff', color: '#52514e', cursor: 'pointer' }}>Buscar</button>
              {q && <Link href="/carteira" style={{ padding: '6px 10px', fontSize: 11, color: '#8892a4', textDecoration: 'none', alignSelf: 'center' }}>Limpar</Link>}
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

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead>
              <tr>
                {['Cliente', 'Natureza', 'Nº Contrato', 'Tipo', 'Valor/mês', 'Coordenador', 'Engenheiro', 'ABC', 'Vencimento', 'Alerta', ''].map((h, i) => (
                  <th key={h + i} style={{ padding: '10px 12px', fontSize: 10, color: '#8892a4', textTransform: 'uppercase', letterSpacing: '0.7px', fontWeight: 500, textAlign: 'left', borderBottom: '0.5px solid #f1f3f8', whiteSpace: 'nowrap' }}>{h}</th>
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
                  <tr key={c.id} style={{ borderBottom: '0.5px solid #f8f9fb', background: isVencido ? '#fff8f8' : undefined }}>
                    <td style={{ padding: '12px 12px' }}>
                      <Link href={`/contracts/${c.id}`} style={{ textDecoration: 'none' }}>
                        <p style={{ fontSize: 13, fontWeight: 500, color: isVencido ? '#b91c1c' : '#1a1f36', margin: 0 }}>{c.client_name}</p>
                        {c.municipality && <p style={{ fontSize: 11, color: '#8892a4', marginTop: 2 }}>{c.municipality}</p>}
                      </Link>
                    </td>
                    <td style={{ padding: '12px 12px' }}>
                      {c.naturezaLabel ? (
                        <span style={{
                          display: 'inline-flex', padding: '3px 8px', borderRadius: 20, fontSize: 10, fontWeight: 500,
                          background: c.naturezaLabel.includes('Hospit') ? '#eef3ff' : '#eaf5ee',
                          color: c.naturezaLabel.includes('Hospit') ? '#3b5bdb' : '#1a7c3e',
                        }}>
                          {c.naturezaLabel}
                        </span>
                      ) : <span style={{ fontSize: 11, color: '#d1d8e8' }}>—</span>}
                    </td>
                    <td style={{ padding: '12px 12px', fontSize: 11, fontFamily: 'monospace', color: '#8892a4' }}>
                      {c.contract_number ?? c.process_number}
                      {c.sankhya_code && <p style={{ fontSize: 10, color: '#b0b8c8', marginTop: 1 }}>{c.sankhya_code}</p>}
                    </td>
                    <td style={{ padding: '12px 12px' }}>
                      {typeSt ? <span style={{ display: 'inline-flex', padding: '3px 8px', borderRadius: 20, fontSize: 10, fontWeight: 500, background: typeSt.bg, color: typeSt.color }}>{TYPE_LABEL[c.contract_type!]}</span>
                        : <span style={{ fontSize: 11, color: '#d1d8e8' }}>—</span>}
                    </td>
                    <td style={{ padding: '12px 12px', fontSize: 13, fontWeight: 500, color: '#1a1f36' }}>
                      {c.monthly_value ? fmt(c.monthly_value) : <span style={{ color: '#d1d8e8', fontSize: 11 }}>—</span>}
                    </td>
                    <td style={{ padding: '12px 12px', fontSize: 12, color: '#52514e' }}>{c.coordinator_name ?? <span style={{ color: '#d1d8e8' }}>—</span>}</td>
                    <td style={{ padding: '12px 12px', fontSize: 12, color: '#52514e' }}>{c.engineer_name ?? <span style={{ color: '#d1d8e8' }}>—</span>}</td>
                    <td style={{ padding: '12px 12px' }}>
                      {abcSt ? <span style={{ display: 'inline-flex', padding: '3px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: abcSt.bg, color: abcSt.color }}>{c.abc_curve}</span>
                        : <span style={{ color: '#d1d8e8', fontSize: 11 }}>—</span>}
                      {c.score_weight ? <p style={{ fontSize: 9, color: '#b0b8c8', marginTop: 2 }}>Peso {c.score_weight}</p> : null}
                    </td>
                    <td style={{ padding: '12px 12px', fontSize: 11, color: isVencido ? '#b91c1c' : '#52514e' }}>
                      {c.valid_until ? new Date(c.valid_until + 'T12:00:00').toLocaleDateString('pt-BR') : <span style={{ color: '#d1d8e8' }}>—</span>}
                    </td>
                    <td style={{ padding: '12px 12px' }}>
                      <span style={{ display: 'inline-flex', padding: '3px 8px', borderRadius: 20, fontSize: 10, fontWeight: 500, background: alert.bg, color: alert.color, whiteSpace: 'nowrap' }}>{alert.label}</span>
                    </td>
                    <td style={{ padding: '12px 12px' }}>
                      <Link href={`/contracts/${c.id}`} style={{ fontSize: 11, color: '#4f86f7', textDecoration: 'none' }}>Ver</Link>
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={10} style={{ padding: '48px 16px', textAlign: 'center', fontSize: 13, color: '#8892a4' }}>
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
