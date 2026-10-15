import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isCurrentUserAdmin } from '@/lib/auth/role'
import { DeleteCompanyButton } from '@/components/companies/delete-company-button'
import { CompanyTagSelect } from '@/components/companies/company-tag-select'
import { NewOpportunityButton } from '@/components/companies/new-opportunity-button'
import { AddContactForm } from '@/components/companies/add-contact-form'
import { RemoveContactButton } from '@/components/companies/remove-contact-button'
import { TimelineFeed } from '@/components/contracts/timeline-feed'

const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  lead:           { bg: '#e8e7f4', color: '#524e9c', label: 'Lead' },
  prospect:       { bg: '#f0eeff', color: '#5f38c9', label: 'Prospect' },
  cliente_ativo:  { bg: '#e3f5f1', color: '#1f8c7d', label: 'Cliente Ativo' },
  cliente_inativo:{ bg: '#fbeee5', color: '#c2683d', label: 'Cliente Inativo' },
  nao_qualificado:{ bg: '#f1f3f8', color: '#8892a4', label: 'Não qualificado' },
}

function fmt(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
}

function parseMulti(val: string | null | undefined): string[] {
  if (!val) return []
  try { return JSON.parse(val) } catch { return [val] }
}

export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: userProfile } = user ? await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle() : { data: null }
  const userRole = userProfile?.role ?? 'member'

  const [
    isAdmin,
    { data: company },
    { data: contacts },
    { data: contracts },
    { data: activities },
    { data: profiles },
    { data: salesPipelines },
    { data: allTags },
    { data: companyTagRow },
  ] = await Promise.all([
    isCurrentUserAdmin(),
    supabase.from('companies').select('*').eq('id', id).single(),
    supabase.from('contacts').select('id, name, role, email, phone, is_primary').eq('company_id', id).order('is_primary', { ascending: false }),
    supabase.from('contracts').select('id, process_number, title, created_at, company_id').eq('company_id', id).order('created_at', { ascending: false }),
    supabase.from('activities').select('id, type, activity_type, title, content, status, activity_date, activity_time, duration_minutes, created_at, user_id, assigned_to, is_pinned, contract_id').eq('company_id', id).order('is_pinned', { ascending: false }).order('created_at', { ascending: false }).limit(50),
    supabase.from('profiles').select('id, full_name').order('full_name'),
    supabase.from('pipelines').select('id, name, is_default').eq('type', 'vendas').order('name'),
    supabase.from('tags').select('id, name, color, context').order('name'),
    supabase.from('company_tags').select('tag_id').eq('company_id', id).maybeSingle(),
  ])

  if (!company) notFound()

  // Busca contratos por company_id OU pelo CNPJ/nome no client_name (contratos legados)
  const cnpjDigits = company?.cnpj?.replace(/\D/g, '') ?? null
  const cnpjRoot = cnpjDigits ? cnpjDigits.slice(0, 8) : null // primeiros 8 dígitos ex: "66378147"
  // Remove CNPJ do início do nome (formato "66.378.147 NOME DA EMPRESA")
  const namePart = company.name.replace(/^\d{2}\.\d{3}\.\d{3}\s*/, '').split(' ').slice(0, 3).join(' ')

  const [{ data: byCompanyId, error: e1 }, { data: byCnpj, error: e2 }, { data: byName, error: e3 }] = await Promise.all([
    supabase.from('contracts').select('id, process_number, title, client_name, created_at, company_id').eq('company_id', id).limit(50),
    cnpjRoot ? supabase.from('contracts').select('id, process_number, title, client_name, created_at, company_id').ilike('client_name', `%${cnpjRoot}%`).limit(20) : Promise.resolve({ data: [] as any[], error: null }),
    namePart.length > 3 ? supabase.from('contracts').select('id, process_number, title, client_name, created_at, company_id').ilike('client_name', `%${namePart}%`).limit(20) : Promise.resolve({ data: [] as any[], error: null }),
  ])

  if (e1) console.error('[empresa] byCompanyId error:', e1.message)
  if (e2) console.error('[empresa] byCnpj error:', e2.message)
  if (e3) console.error('[empresa] byName error:', e3.message)
  console.log('[empresa] byCompanyId:', byCompanyId?.length, 'byCnpj:', byCnpj?.length, 'byName:', byName?.length)

  // Une sem duplicatas
  const seenIds = new Set<string>()
  const allCompanyContracts = [...(byCompanyId ?? []), ...(byCnpj ?? []), ...(byName ?? [])].filter(c => {
    if (seenIds.has(c.id)) return false
    seenIds.add(c.id)
    return true
  }).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  // Auto-vincula contratos legados encontrados pelo nome/cnpj
  const legacyContracts = (allCompanyContracts ?? []).filter(c => !c.company_id)
  if (legacyContracts.length > 0) {
    await supabase.from('contracts').update({ company_id: id }).in('id', legacyContracts.map(c => c.id))
  }

  const contractIds = (allCompanyContracts ?? []).map(c => c.id)

  // Ponto 2: soma de propostas ativas por contract_id para a empresa
  const companyProposalAgg = contractIds.length
    ? await supabase.from('proposals').select('contract_id, proposal_value, workflow_status').in('contract_id', contractIds).is('deleted_at', null).not('workflow_status', 'in', '("cliente_recusado","declinada")')
    : { data: [] as any[] }

  const proposalSumByContractCompany = new Map<string, number>()
  for (const p of companyProposalAgg.data ?? []) {
    const prev = proposalSumByContractCompany.get(p.contract_id) ?? 0
    proposalSumByContractCompany.set(p.contract_id, prev + Number(p.proposal_value ?? 0))
  }

  const { data: companyRuns } = contractIds.length
    ? await supabase
        .from('pipeline_runs')
        .select('id, contract_id, status, value, started_at, ended_at, pipeline_id, pipelines(id, name, type)')
        .in('contract_id', contractIds)
        .order('started_at', { ascending: false })
    : { data: [] as any[] }

  // Busca atividades também pelo contract_id (além das da empresa)
  const { data: contractActivities } = contractIds.length
    ? await supabase
        .from('activities')
        .select('id, type, activity_type, title, content, status, activity_date, activity_time, duration_minutes, created_at, user_id, assigned_to, is_pinned, contract_id')
        .in('contract_id', contractIds)
        .order('created_at', { ascending: false })
        .limit(50)
    : { data: [] as any[] }

  const cnpjDigitsForLeads = cnpjDigits
  let leadsQuery = supabase.from('leads').select('id, name, email, status, score, created_at, source').order('created_at', { ascending: false }).limit(20)
  if (cnpjDigitsForLeads) {
    leadsQuery = supabase.from('leads').select('id, name, email, status, score, created_at, source')
      .or(`cnpj.eq.${cnpjDigitsForLeads},company_name.ilike.${company.name}`)
      .order('created_at', { ascending: false }).limit(20)
  } else if (company.name) {
    leadsQuery = supabase.from('leads').select('id, name, email, status, score, created_at, source')
      .ilike('company_name', company.name)
      .order('created_at', { ascending: false }).limit(20)
  }
  const { data: companyLeads } = await leadsQuery

  const defaultSalesPipeline = (salesPipelines ?? []).find(p => p.is_default)?.id ?? salesPipelines?.[0]?.id
  const salesPipelinesList = (salesPipelines ?? []).map(p => ({ id: p.id, name: p.name }))

  if (!company) notFound()

  const profileById = new Map((profiles ?? []).map(p => [p.id, p.full_name]))
  const st = STATUS_STYLE[(company as any).status ?? 'lead'] ?? STATUS_STYLE.lead
  const segmentos = parseMulti((company as any).segment)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Link href="/companies" style={{ fontSize: 12, color: '#8892a4', textDecoration: 'none' }}>← Empresas</Link>

      {/* Header */}
      <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #e8edf5', padding: '20px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
              <h1 style={{ fontSize: 20, fontWeight: 500, color: '#1a1f36', margin: 0 }}>{company.name}</h1>
              <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 500, background: st.bg, color: st.color }}>{st.label}</span>
              <CompanyTagSelect
                companyId={company.id}
                currentTagId={(companyTagRow as any)?.tag_id ?? null}
                tags={(allTags ?? []).filter((t: any) => t.context === 'empresa' || t.context === 'ambos' || !t.context)}
              />
              {segmentos.map(s => <span key={s} style={{ padding: '2px 8px', borderRadius: 20, fontSize: 10, background: '#f1f3f8', color: '#52514e' }}>{s}</span>)}
            </div>
            {(company as any).trade_name && <p style={{ fontSize: 13, color: '#52514e', marginBottom: 4 }}>{(company as any).trade_name}</p>}
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, color: '#8892a4' }}>
              {company.cnpj && <span>CNPJ: <strong style={{ color: '#1a1f36', fontFamily: 'monospace' }}>{company.cnpj}</strong></span>}
              {(company as any).city && <span>📍 {(company as any).city}{(company as any).state ? `/${(company as any).state}` : ''}</span>}
              {(company as any).phone && <span>📞 {(company as any).phone}</span>}
              {(company as any).email && <span>✉ {(company as any).email}</span>}
              {(company as any).capital_social && <span>💰 Capital: {fmt(Number((company as any).capital_social))}</span>}
              {(company as any).main_activity && <span>🏭 {(company as any).main_activity}</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <Link href={`/companies/${company.id}/edit`} style={{ padding: '7px 14px', fontSize: 12, borderRadius: 8, border: '0.5px solid #d1d8e8', background: '#fff', color: '#52514e', textDecoration: 'none' }}>Editar</Link>
            {isAdmin && <DeleteCompanyButton companyId={company.id} />}
          </div>
        </div>
        {/* Endereço */}
        {((company as any).street || (company as any).neighborhood) && (
          <p style={{ fontSize: 12, color: '#8892a4', marginTop: 8, borderTop: '0.5px solid #f1f3f8', paddingTop: 8 }}>
            {[(company as any).street, (company as any).street_number, (company as any).neighborhood, (company as any).zip_code].filter(Boolean).join(', ')}
          </p>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16 }}>
        {/* Coluna principal */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Visão Geral / Atividades */}
          <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #e8edf5', overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px', borderBottom: '0.5px solid #f1f3f8' }}>
              <p style={{ fontSize: 13, fontWeight: 500, color: '#1a1f36', margin: 0 }}>Histórico de Atividades</p>
            </div>
            <div style={{ padding: 16 }}>
              {(() => {
                const contractNameById = new Map((allCompanyContracts ?? []).map(c => [
                  c.id,
                  [c.process_number, c.title].filter(Boolean).join(' · ') || c.id.slice(0, 8)
                ]))
                const allEvents = [...(activities ?? []), ...(contractActivities ?? [])]
                  .sort((a, b) => {
                    const ap = (a as any).is_pinned ? 1 : 0
                    const bp = (b as any).is_pinned ? 1 : 0
                    if (bp !== ap) return bp - ap
                    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
                  })
                  .map(a => ({
                    ...a,
                    profiles: null,
                    metadata: null,
                    // Badge da oportunidade como campo separado — não muta o content
                    opportunity_badge: (a as any).contract_id && contractNameById.has((a as any).contract_id)
                      ? contractNameById.get((a as any).contract_id)
                      : null,
                  }))
                // company_id como contractId para o endpoint de nota
                return (
                  <TimelineFeed
                    events={allEvents}
                    contractId={company.id}
                    currentUserRole={userRole}
                    noteEndpointField="company_id"
                    notePlaceholder="Adicione uma nota no cadastro desta empresa..."
                  />
                )
              })()}
            </div>
          </div>

          {/* Leads vinculados */}
          {(companyLeads ?? []).length > 0 && (
            <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #e8edf5', overflow: 'hidden' }}>
              <div style={{ padding: '14px 16px', borderBottom: '0.5px solid #f1f3f8', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <p style={{ fontSize: 13, fontWeight: 500, color: '#1a1f36', margin: 0 }}>Leads ({(companyLeads ?? []).length})</p>
                <Link href="/leads" style={{ fontSize: 11, color: '#1b556b', textDecoration: 'none' }}>Ver todos os leads →</Link>
              </div>
              <div>
                {(companyLeads ?? []).map(l => {
                  const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
                    novo: { bg: '#e8e7f4', color: '#524e9c' },
                    em_qualificacao: { bg: '#fbeee5', color: '#c2683d' },
                    qualificado: { bg: '#e3f5f1', color: '#1f8c7d' },
                    convertido: { bg: '#f0eeff', color: '#5f38c9' },
                    descartado: { bg: '#f1f3f8', color: '#8892a4' },
                  }
                  const st = STATUS_STYLE[l.status] ?? STATUS_STYLE.novo
                  const STATUS_LABEL: Record<string, string> = { novo: 'Novo', em_qualificacao: 'Em Qualificação', qualificado: 'Qualificado', convertido: 'Convertido', descartado: 'Descartado' }
                  return (
                    <div key={l.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '0.5px solid #f8f9fb' }}>
                      <div>
                        <Link href={`/leads/${l.id}`} style={{ fontSize: 13, fontWeight: 500, color: '#1a1f36', textDecoration: 'none' }}>{l.name}</Link>
                        <p style={{ fontSize: 11, color: '#8892a4', marginTop: 2 }}>{l.email ?? '—'} · {new Date(l.created_at).toLocaleDateString('pt-BR')}</p>
                      </div>
                      <span style={{ padding: '3px 8px', borderRadius: 20, fontSize: 10, fontWeight: 500, background: st.bg, color: st.color }}>
                        {STATUS_LABEL[l.status] ?? l.status}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Oportunidades e Contratos vinculados */}
          <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #e8edf5', overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px', borderBottom: '0.5px solid #f1f3f8', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <p style={{ fontSize: 13, fontWeight: 500, color: '#1a1f36', margin: 0 }}>
                Histórico de funis ({(companyRuns ?? []).length} passagens · {(contracts ?? []).length} registro{(contracts ?? []).length !== 1 ? 's' : ''})
              </p>
              <NewOpportunityButton companyId={company.id} pipelines={salesPipelinesList} stagesByPipeline={{}} />
            </div>
            <div>
              {(companyRuns ?? []).map((run: any) => {
                const contract = (contracts ?? []).find(c => c.id === run.contract_id)
                const pipeline = Array.isArray(run.pipelines) ? run.pipelines[0] : run.pipelines
                const STATUS: Record<string, { label: string; bg: string; color: string }> = {
                  open:  { label: 'Em andamento', bg: '#e8e7f4', color: '#524e9c' },
                  won:   { label: 'Ganho',        bg: '#e3f5f1', color: '#1f8c7d' },
                  lost:  { label: 'Perdido',      bg: '#f6e9ea', color: '#8e4550' },
                  moved: { label: 'Movido',       bg: '#f1f3f8', color: '#8892a4' },
                }
                const s = STATUS[run.status] ?? STATUS.moved
                return (
                  <div key={run.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '0.5px solid #f8f9fb' }}>
                    <div>
                      <Link href={`/contracts/${run.contract_id}`} style={{ fontSize: 13, fontWeight: 500, color: '#1a1f36', textDecoration: 'none' }}>
                        {contract?.title || contract?.process_number || '—'}
                      </Link>
                      <div style={{ display: 'flex', gap: 8, marginTop: 3, alignItems: 'center' }}>
                        <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20, background: s.bg, color: s.color }}>{s.label}</span>
                        {pipeline && <span style={{ fontSize: 10, color: '#8892a4' }}>{pipeline.name}</span>}
                        <span style={{ fontSize: 10, color: '#b0b8c8' }}>{new Date(run.started_at).toLocaleDateString('pt-BR')}</span>
                      </div>
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 500, color: '#1a1f36' }}>
                      {(() => {
                        const pSum = proposalSumByContractCompany.get(run.contract_id)
                        const val = pSum !== undefined ? pSum : Number(run.value)
                        return val > 0 ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val) : '—'
                      })()}
                    </span>
                  </div>
                )
              })}
              {(companyRuns ?? []).length === 0 && (
                <p style={{ padding: '24px 16px', textAlign: 'center', fontSize: 12, color: '#b0b8c8' }}>Nenhuma oportunidade ou contrato vinculado ainda.</p>
              )}
            </div>
          </div>
        </div>

        {/* Coluna lateral — Contatos */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #e8edf5', overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px', borderBottom: '0.5px solid #f1f3f8' }}>
              <p style={{ fontSize: 13, fontWeight: 500, color: '#1a1f36', margin: 0 }}>Contatos ({(contacts ?? []).length})</p>
            </div>
            <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(contacts ?? []).map(c => (
                <div key={c.id} style={{ padding: '10px 12px', borderRadius: 8, background: '#f8f9fb', border: '0.5px solid #f1f3f8' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <p style={{ fontSize: 12, fontWeight: 500, color: '#1a1f36', margin: 0 }}>
                      {c.name} {c.is_primary && <span style={{ fontSize: 9, background: '#e8e7f4', color: '#524e9c', padding: '1px 5px', borderRadius: 20 }}>Principal</span>}
                    </p>
                    <RemoveContactButton contactId={c.id} companyId={company.id} />
                  </div>
                  {c.role && <p style={{ fontSize: 11, color: '#8892a4', marginTop: 2 }}>{c.role}</p>}
                  {c.email && <p style={{ fontSize: 11, color: '#1b556b', marginTop: 2 }}>{c.email}</p>}
                  {c.phone && <p style={{ fontSize: 11, color: '#8892a4', marginTop: 1 }}>{c.phone}</p>}
                </div>
              ))}
            </div>
            <div style={{ padding: '0 12px 12px' }}>
              <AddContactForm companyId={company.id} />
            </div>
          </div>

          {/* Notas */}
          {company.notes && (
            <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #e8edf5', padding: 16 }}>
              <p style={{ fontSize: 10, color: '#8892a4', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 8 }}>Observações</p>
              <p style={{ fontSize: 12, color: '#52514e', lineHeight: 1.5 }}>{company.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
