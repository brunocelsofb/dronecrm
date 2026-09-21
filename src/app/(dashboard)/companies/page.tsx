import Link from 'next/link'
import { createClientForTenant } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/auth/role'
import { CompanyRowActions, InativoDaysSelector } from '@/components/companies/company-row-actions'

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<{ q?: string; inativo?: string }> }) {
  const { q, inativo } = await searchParams
  const inativoDias = Math.max(30, Math.min(730, parseInt(inativo ?? '180') || 180))
  const { client: supabase, tenantId } = await createClientForTenant()
  const profile = await getCurrentProfile()
  const isAdmin = profile?.role === 'admin'

  let query = supabase.from('companies').select('id, name, cnpj, created_at').order('name')
  if (tenantId) query = query.eq('tenant_id', tenantId)
  if (q?.trim()) query = query.ilike('name', `%${q.trim().replace(/[%_]/g, '')}%`)

  const { data: companies, error } = await query
  const companyIds = (companies ?? []).map(c => c.id)
  // Conta contratos ATIVOS em funil de gestão de contratos (não oportunidades em vendas)
  const gestaoPipelineIds = (companyIds.length
    ? await (() => {
        let pQ = supabase.from('pipelines').select('id').eq('type', 'gestao_contratos')
        if (tenantId) pQ = pQ.eq('tenant_id', tenantId)
        return pQ
      })()
    : { data: [] as any[] }
  ).data?.map((p: any) => p.id) ?? []

  const { data: activeContractRuns } = companyIds.length && gestaoPipelineIds.length
    ? await supabase
        .from('pipeline_runs')
        .select('contract_id, contracts(company_id)')
        .in('pipeline_id', gestaoPipelineIds)
        .eq('status', 'open')
    : { data: [] as any[] }

  const countByCompany = new Map<string, number>()
  for (const r of activeContractRuns ?? []) {
    const companyId = Array.isArray((r as any).contracts)
      ? (r as any).contracts[0]?.company_id
      : (r as any).contracts?.company_id
    if (!companyId) continue
    countByCompany.set(companyId, (countByCompany.get(companyId) ?? 0) + 1)
  }

  const total = companies?.length ?? 0
  const comContratos = (companies ?? []).filter(c => (countByCompany.get(c.id) ?? 0) > 0).length

  // Clientes inativos — configurável pelo usuário (padrão 180 dias)
  const { data: recentContracts } = await supabase
    .from('contracts')
    .select('company_id, created_at')
    .not('company_id', 'is', null)
    .gte('created_at', new Date(Date.now() - inativoDias * 86400000).toISOString())

  const recentCompanyIds = new Set((recentContracts ?? []).map((c: any) => c.company_id))
  const inactivos = (companies ?? []).filter(c =>
    (countByCompany.get(c.id) ?? 0) > 0 && !recentCompanyIds.has(c.id)
  ).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 500, color: '#1a1f36', margin: 0 }}>Empresas</h1>
          <p style={{ fontSize: 12, color: '#8892a4', marginTop: 3 }}>Base de clientes e parceiros cadastrados</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link href="/companies/inactive" style={{ padding: '7px 14px', fontSize: 12, borderRadius: 8, border: '0.5px solid #d1d8e8', background: '#fff', color: '#52514e', textDecoration: 'none' }}>Inativos</Link>
          <Link href="/companies/import" style={{ padding: '7px 14px', fontSize: 12, borderRadius: 8, border: '0.5px solid #d1d8e8', background: '#fff', color: '#52514e', textDecoration: 'none' }}>Importar CSV</Link>
          <Link href="/companies/new" style={{ padding: '7px 14px', fontSize: 12, borderRadius: 8, background: '#1a1f36', color: '#fff', textDecoration: 'none', fontWeight: 500 }}>+ Nova Empresa</Link>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {[
          { label: 'Total de empresas', value: String(total), sub: 'na base de clientes' },
          { label: 'Com contratos', value: String(comContratos), sub: 'clientes ativos' },
          { label: 'Sem contratos', value: String(total - comContratos), sub: 'sem oportunidade aberta' },
          { label: `⚠ Inativos +${inativoDias}d`, value: String(inactivos), sub: `sem compra há ${inativoDias}+ dias`, alert: inactivos > 0 },
        ].map(k => (
          <div key={k.label} style={{ background: '#fff', borderRadius: 12, padding: '14px 16px', border: `0.5px solid ${(k as any).alert ? '#fca5a5' : '#e8edf5'}` }}>
            <p style={{ fontSize: 10, color: '#8892a4', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 6 }}>{k.label}</p>
            <p style={{ fontSize: 20, fontWeight: 500, color: (k as any).alert ? '#b91c1c' : '#1a1f36', letterSpacing: '-0.5px' }}>{k.value}</p>
            <p style={{ fontSize: 11, color: (k as any).alert ? '#b91c1c' : '#8892a4', marginTop: 3 }}>{k.sub}</p>
          </div>
        ))}
      </div>

      <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #e8edf5', overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', borderBottom: '0.5px solid #f1f3f8', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <form method="GET" style={{ display: 'flex', gap: 6, flex: 1 }}>
            {inativo && inativo !== '180' && <input type="hidden" name="inativo" value={inativo} />}
            <input type="text" name="q" defaultValue={q ?? ''} placeholder="Buscar empresa pelo nome…"
              style={{ padding: '6px 10px', fontSize: 12, borderRadius: 8, border: '0.5px solid #d1d8e8', background: '#f8f9fb', color: '#1a1f36', outline: 'none', width: 260 }} />
            <button type="submit" style={{ padding: '6px 12px', fontSize: 11, borderRadius: 8, border: '0.5px solid #d1d8e8', background: '#fff', color: '#52514e', cursor: 'pointer' }}>Buscar</button>
            {q && <Link href="/companies" style={{ padding: '6px 10px', fontSize: 11, color: '#8892a4', textDecoration: 'none', alignSelf: 'center' }}>Limpar</Link>}
          </form>
          <InativoDaysSelector current={inativoDias} />
        </div>

        {error && <p style={{ padding: '12px 16px', fontSize: 12, color: '#b91c1c' }}>Erro: {error.message}</p>}

        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Empresa', 'CNPJ', 'Contratos', 'Cadastrada em', ''].map((h, i) => (
                <th key={h + i} style={{ padding: '10px 16px', fontSize: 10, color: '#8892a4', textTransform: 'uppercase', letterSpacing: '0.7px', fontWeight: 500, textAlign: i >= 2 && i < 4 ? 'right' : 'left', borderBottom: '0.5px solid #f1f3f8' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(companies ?? []).map(c => {
              const cnt = countByCompany.get(c.id) ?? 0
              const isInativo = cnt > 0 && !recentCompanyIds.has(c.id)
              return (
                <tr key={c.id} style={{ borderBottom: '0.5px solid #f8f9fb' }}>
                  <td style={{ padding: '12px 16px' }}>
                    <Link href={`/companies/${c.id}`} style={{ textDecoration: 'none' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <p style={{ fontSize: 13, fontWeight: 500, color: '#1a1f36', margin: 0 }}>{c.name}</p>
                        {isInativo && (
                          <span style={{ padding: '2px 7px', borderRadius: 20, fontSize: 10, fontWeight: 500, background: '#fff8e6', color: '#92400e' }}>⚠ Inativo +{inativoDias}d</span>
                        )}
                      </div>
                    </Link>
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 12, color: '#8892a4', fontFamily: 'monospace' }}>{c.cnpj || '—'}</td>
                  <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                    <span style={{ display: 'inline-flex', padding: '3px 8px', borderRadius: 20, fontSize: 10, fontWeight: 500, background: cnt > 0 ? '#eef3ff' : '#f1f3f8', color: cnt > 0 ? '#3b5bdb' : '#8892a4' }}>
                      {cnt} contrato{cnt !== 1 ? 's' : ''}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'right', fontSize: 11, color: '#8892a4' }}>{new Date(c.created_at).toLocaleDateString('pt-BR')}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <CompanyRowActions companyId={c.id} companyName={c.name} isAdmin={isAdmin} />
                  </td>
                </tr>
              )
            })}
            {(companies ?? []).length === 0 && (
              <tr><td colSpan={5} style={{ padding: '48px 16px', textAlign: 'center', fontSize: 13, color: '#8892a4' }}>
                {q ? `Nenhuma empresa encontrada para "${q}".` : 'Nenhuma empresa cadastrada ainda.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
