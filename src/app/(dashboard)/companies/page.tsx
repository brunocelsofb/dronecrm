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
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#1B556B] tracking-tight">Empresas</h1>
          <p className="text-xs text-gray-400 mt-0.5">Base de clientes e parceiros cadastrados</p>
        </div>
        <div className="flex gap-2">
          <Link href="/companies/inactive" className="px-4 py-2 text-xs font-medium rounded-xl border border-gray-200 bg-white text-gray-600 no-underline">Inativos</Link>
          <Link href="/companies/import" className="px-4 py-2 text-xs font-medium rounded-xl border border-gray-200 bg-white text-gray-600 no-underline">Importar CSV</Link>
          <Link href="/companies/new" className="px-4 py-2 text-xs font-medium rounded-xl bg-[#1B556B] text-white no-underline">+ Nova Empresa</Link>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Total de empresas', value: String(total), sub: 'na base de clientes', alert: false },
          { label: 'Com contratos', value: String(comContratos), sub: 'clientes ativos', alert: false },
          { label: 'Sem contratos', value: String(total - comContratos), sub: 'sem oportunidade aberta', alert: false },
          { label: `⚠ Inativos +${inativoDias}d`, value: String(inactivos), sub: `sem compra há ${inativoDias}+ dias`, alert: inactivos > 0 },
        ].map(k => (
          <div key={k.label} className={`rounded-3xl p-5 bg-white shadow-[0_2px_16px_rgba(0,0,0,0.06)]${k.alert ? ' ring-1 ring-red-200' : ''}`}>
            <p className="text-xs font-medium uppercase tracking-wider text-gray-500 mb-3">{k.label}</p>
            <p className={`text-3xl font-bold tracking-tight${k.alert ? ' text-red-600' : ' text-[#1B556B]'}`}>{k.value}</p>
            <p className={`text-xs mt-1${k.alert ? ' text-red-500' : ' text-gray-400'}`}>{k.sub}</p>
          </div>
        ))}
      </div>

      <div className="rounded-3xl bg-white shadow-[0_2px_16px_rgba(0,0,0,0.06)] overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex items-center gap-2 flex-wrap">
          <form method="GET" className="flex gap-1.5 flex-1">
            {inativo && inativo !== '180' && <input type="hidden" name="inativo" value={inativo} />}
            <input type="text" name="q" defaultValue={q ?? ''} placeholder="Buscar empresa pelo nome…"
              className="px-3 py-1.5 text-xs rounded-xl border border-gray-200 bg-gray-50 text-gray-800 outline-none w-64" />
            <button type="submit" className="px-4 py-2 text-xs font-medium rounded-xl border border-gray-200 bg-white text-gray-600 cursor-pointer">Buscar</button>
            {q && <Link href="/companies" className="px-3 py-2 text-xs text-gray-400 no-underline self-center">Limpar</Link>}
          </form>
          <InativoDaysSelector current={inativoDias} />
        </div>

        {error && <p className="px-4 py-3 text-xs text-red-600">Erro: {error.message}</p>}

        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-gray-100">
              {['Empresa', 'CNPJ', 'Contratos', 'Cadastrada em', ''].map((h, i) => (
                <th key={h + i} className={`text-xs font-medium uppercase tracking-wider text-gray-400 py-3 px-4 ${i >= 2 && i < 4 ? 'text-right' : 'text-left'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(companies ?? []).map(c => {
              const cnt = countByCompany.get(c.id) ?? 0
              const isInativo = cnt > 0 && !recentCompanyIds.has(c.id)
              return (
                <tr key={c.id} className="border-b border-gray-50">
                  <td className="py-3 px-4">
                    <Link href={`/companies/${c.id}`} className="no-underline">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-gray-800 m-0">{c.name}</p>
                        {isInativo && (
                          <span className="inline-flex px-2.5 py-1 rounded-xl text-xs font-medium bg-amber-50 text-amber-800">⚠ Inativo +{inativoDias}d</span>
                        )}
                      </div>
                    </Link>
                  </td>
                  <td className="py-3 px-4 text-xs text-gray-400 font-mono">{c.cnpj || '—'}</td>
                  <td className="py-3 px-4 text-right">
                    <span className="inline-flex px-2.5 py-1 rounded-xl text-xs font-medium" style={{ background: cnt > 0 ? '#eef3ff' : '#f1f3f8', color: cnt > 0 ? '#3b5bdb' : '#8892a4' }}>
                      {cnt} contrato{cnt !== 1 ? 's' : ''}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right text-xs text-gray-400">{new Date(c.created_at).toLocaleDateString('pt-BR')}</td>
                  <td className="py-3 px-4">
                    <CompanyRowActions companyId={c.id} companyName={c.name} isAdmin={isAdmin} />
                  </td>
                </tr>
              )
            })}
            {(companies ?? []).length === 0 && (
              <tr><td colSpan={5} className="py-12 px-4 text-center text-sm text-gray-400">
                {q ? `Nenhuma empresa encontrada para "${q}".` : 'Nenhuma empresa cadastrada ainda.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
