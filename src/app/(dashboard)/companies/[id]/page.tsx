/* eslint-disable @typescript-eslint/no-explicit-any -- linhas de consultas com junções e seleção dinâmica */
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
import { ContractTabs } from '@/components/contracts/contract-tabs'
import { CompanyFilesSection } from '@/components/companies/company-files-section'
import { CompanyActivityForm } from '@/components/companies/company-activity-form'
import { ActivityDoneButton } from '@/components/companies/activity-done-button'

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

// Hoje em Brasília (aaaa-mm-dd)
function todayBrIso(): string {
  return new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)
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
    supabase.from('activities').select('id, type, activity_type, title, content, status, activity_date, activity_time, duration_minutes, created_at, user_id, assigned_to, is_pinned, contract_id, metadata').eq('company_id', id).order('is_pinned', { ascending: false }).order('created_at', { ascending: false }).limit(50),
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
        .select('id, type, activity_type, title, content, status, activity_date, activity_time, duration_minutes, created_at, user_id, assigned_to, is_pinned, contract_id, metadata')
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
  // ── Abas da conta ─────────────────────────────────────────────────────────
  const [{ data: companyEmails }, { data: companyProposals }, { data: contractMeta }, { data: companyFiles }, { data: oppFiles }] = await Promise.all([
    contractIds.length
      ? supabase.from('contract_emails').select('id, contract_id, subject, from_email, to_email, direction, sent_at, opened_at').in('contract_id', contractIds).order('sent_at', { ascending: false }).limit(100)
      : Promise.resolve({ data: [] as any[] }),
    contractIds.length
      ? supabase.from('proposals').select('id, contract_id, control_code, version, workflow_status, client_status, proposal_value, created_at').in('contract_id', contractIds).is('deleted_at', null).order('created_at', { ascending: false })
      : Promise.resolve({ data: [] as any[] }),
    contractIds.length
      ? supabase.from('contracts').select('id, monthly_value, owner_id, created_at').in('id', contractIds)
      : Promise.resolve({ data: [] as any[] }),
    supabase.from('company_files').select('id, file_name, file_size, created_at, description, uploaded_by').eq('company_id', id).order('created_at', { ascending: false }),
    contractIds.length
      ? supabase.from('contract_files').select('id, contract_id, file_name, file_size, created_at').in('contract_id', contractIds).order('created_at', { ascending: false }).limit(200)
      : Promise.resolve({ data: [] as any[] }),
  ])
  const contractNameById = new Map((allCompanyContracts ?? []).map(c => [
    c.id,
    [c.process_number, c.title].filter(Boolean).join(' · ') || c.id.slice(0, 8),
  ]))
  // A mesma atividade pode vir pela empresa e pela oportunidade: mostra uma vez só
  const allEvents = [...new Map([...(activities ?? []), ...(contractActivities ?? [])].map(a => [a.id, a])).values()]
    .sort((a, b) => {
      const ap = (a as any).is_pinned ? 1 : 0
      const bp = (b as any).is_pinned ? 1 : 0
      if (bp !== ap) return bp - ap
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })
    .map(a => ({
      ...a,
      profiles: (a as any).user_id && profileById.get((a as any).user_id) ? { full_name: profileById.get((a as any).user_id) as string } : null,
      metadata: (a as { metadata?: unknown }).metadata ?? null,
      opportunity_badge: (a as any).contract_id && contractNameById.has((a as any).contract_id) ? contractNameById.get((a as any).contract_id) : null,
    }))
  const noteEvents = allEvents.filter((a: any) => a.type === 'note' || (a.type === 'task' && a.activity_type === 'note'))
  const taskEvents = allEvents.filter((a: any) => a.type === 'task' && a.activity_type && a.activity_type !== 'note')
  const todayIso = todayBrIso()
  const ACT_LABEL: Record<string, string> = { task: 'Tarefa', call: 'Ligação', meeting: 'Reunião', whatsapp: 'WhatsApp', email: 'E-mail', visit: 'Visita' }
  const PROP_LABEL: Record<string, string> = {
    rascunho: 'Rascunho', em_aprovacao_tecnica: 'Em análise técnica', aprovado_tecnico: 'Aprovada tecnicamente',
    reprovado_tecnico: 'Em revisão', em_aprovacao_comercial: 'Em aprovação comercial', aprovado_comercial: 'Aguardando cliente',
    cliente_aprovado: 'Aprovada pelo cliente', cliente_recusado: 'Recusada pelo cliente', declinada: 'Declinada',
  }
  const runsList = (companyRuns ?? []) as any[]
  const carteiraOpen = runsList.filter(r => r.status === 'open' && (Array.isArray(r.pipelines) ? r.pipelines[0] : r.pipelines)?.type === 'gestao_contratos')
  const metaById = new Map((contractMeta ?? []).map((c: any) => [c.id, c]))
  const props = (companyProposals ?? []) as any[]
  const closedProp = new Set(['cliente_aprovado', 'cliente_recusado', 'declinada'])
  const summary = {
    won: runsList.filter(r => r.status === 'won').length,
    lost: runsList.filter(r => r.status === 'lost').length,
    open: runsList.filter(r => r.status === 'open').length,
    wonValue: runsList.filter(r => r.status === 'won').reduce((sum, r) => sum + (Number(r.value) || 0), 0),
    activeContracts: new Set(carteiraOpen.map(r => r.contract_id)).size,
    mrr: [...new Set(carteiraOpen.map(r => r.contract_id))].reduce((sum, id) => sum + (Number(metaById.get(id)?.monthly_value) || 0), 0),
    propApproved: props.filter(p => p.workflow_status === 'cliente_aprovado').length,
    propRejected: props.filter(p => p.workflow_status === 'cliente_recusado' || p.workflow_status === 'declinada').length,
    propOpen: props.filter(p => !closedProp.has(p.workflow_status)).length,
    propOpenValue: props.filter(p => !closedProp.has(p.workflow_status)).reduce((sum, p) => sum + (Number(p.proposal_value) || 0), 0),
    actPlanned: taskEvents.filter((a: any) => a.status !== 'done').length,
    actLate: taskEvents.filter((a: any) => a.status !== 'done' && a.activity_date && a.activity_date < todayIso).length,
    emailsSent: (companyEmails ?? []).filter((m: any) => m.direction !== 'recebido' && m.direction !== 'inbound').length,
    emailsReceived: (companyEmails ?? []).filter((m: any) => m.direction === 'recebido' || m.direction === 'inbound').length,
  }
  const latestWithOwner = [...(contractMeta ?? [])].filter((c: any) => c.owner_id).sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)))[0] as any
  const ownerId = (company as any).account_owner_id ?? latestWithOwner?.owner_id ?? (company as any).owner_id ?? null
  const ownerName = ownerId ? profileById.get(ownerId) ?? null : null

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
            <NewOpportunityButton companyId={company.id} pipelines={salesPipelinesList} stagesByPipeline={{}} />
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
        {/* Coluna principal: abas da conta */}
        <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #e8edf5', padding: '12px 16px 16px' }}>
          <ContractTabs tabs={[
            {
              id: 'resumo', label: 'Resumo',
              content: (
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-gray-200 p-4">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Responsável pela conta</p>
                      <p className="mt-1 text-sm font-semibold text-gray-900">{ownerName ?? 'Não informado'}</p>
                      <p className="text-xs text-gray-500">{ownerName ? 'Dono da conta na oportunidade mais recente' : 'Defina o dono da conta na oportunidade'}</p>
                    </div>
                    <div className="rounded-xl border border-gray-200 p-4">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Receita mensal ativa</p>
                      <p className="mt-1 text-sm font-semibold text-gray-900">{fmt(summary.mrr)}</p>
                      <p className="text-xs text-gray-500">{summary.activeContracts} contrato(s) ativo(s) na carteira</p>
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {[
                      ['Oportunidades ganhas', summary.won, 'good'], ['Oportunidades perdidas', summary.lost, 'bad'],
                      ['Em andamento', summary.open, 'neutral'], ['Propostas aprovadas', summary.propApproved, 'good'],
                      ['Propostas recusadas', summary.propRejected, 'bad'], ['Propostas em aberto', summary.propOpen, 'neutral'],
                      ['Atividades planejadas', summary.actPlanned, 'neutral'], ['Atividades atrasadas', summary.actLate, 'bad'],
                      ['E-mails enviados', summary.emailsSent, 'neutral'], ['E-mails recebidos', summary.emailsReceived, 'neutral'],
                    ].map(([label, n, tone]) => (
                      <div key={label as string} className="flex items-center gap-3 rounded-lg border border-gray-100 px-3 py-2">
                        <span className={`flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-xs font-bold text-white ${
                          Number(n) === 0 ? 'bg-gray-300' : tone === 'good' ? 'bg-positive-600' : tone === 'bad' ? 'bg-negative-600' : 'bg-brand-700'}`}>{n as number}</span>
                        <span className="text-sm text-gray-700">{label as string}</span>
                      </div>
                    ))}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-gray-200 p-4">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Valor ganho (oportunidades)</p>
                      <p className="mt-1 text-lg font-semibold text-gray-900">{fmt(summary.wonValue)}</p>
                    </div>
                    <div className="rounded-xl border border-gray-200 p-4">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Propostas em aberto (valor)</p>
                      <p className="mt-1 text-lg font-semibold text-gray-900">{fmt(summary.propOpenValue)}</p>
                    </div>
                  </div>
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
                </div>
              ),
            },
            {
              id: 'historico', label: 'Histórico',
              content: (
                <TimelineFeed events={allEvents} contractId={company.id} currentUserRole={userRole}
                  noteEndpointField="company_id" notePlaceholder="Adicione uma nota no cadastro desta empresa..." />
              ),
            },
            {
              id: 'notas', label: `Notas (${noteEvents.length})`,
              content: (
                <TimelineFeed events={noteEvents} contractId={company.id} currentUserRole={userRole}
                  noteEndpointField="company_id" notePlaceholder="Adicione uma nota no cadastro desta empresa..." />
              ),
            },
            {
              id: 'atividades', label: `Atividades (${taskEvents.length})`,
              content: (
                <div className="space-y-3">
                <CompanyActivityForm companyId={company.id} currentUserId={user?.id ?? null}
                  people={(profiles ?? []).map(p => ({ id: p.id as string, name: (p.full_name as string | null) ?? '—' }))} />
                {taskEvents.length === 0 ? <p className="text-sm text-gray-400">Nenhuma atividade nesta empresa nem nas oportunidades dela.</p> : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead className="text-left text-gray-500"><tr><th className="py-1.5 pr-3 font-medium">Atividade</th><th className="py-1.5 pr-3 font-medium">Tipo</th><th className="py-1.5 pr-3 font-medium">Data</th><th className="py-1.5 pr-3 font-medium">Responsável</th><th className="py-1.5 pr-3 font-medium">Situação</th><th className="py-1.5 pr-3 font-medium">Oportunidade</th><th /></tr></thead>
                    <tbody className="divide-y divide-gray-50">
                      {taskEvents.map((a: any) => {
                        const late = a.status !== 'done' && a.activity_date && a.activity_date < todayIso
                        return (
                          <tr key={a.id}>
                            <td className="py-2 pr-3 text-gray-900">{a.title || (a.content ?? '').slice(0, 80)}</td>
                            <td className="py-2 pr-3 text-gray-600">{ACT_LABEL[a.activity_type] ?? a.activity_type}</td>
                            <td className="py-2 pr-3 text-gray-600">{a.activity_date ? new Date(`${a.activity_date}T12:00:00Z`).toLocaleDateString('pt-BR') : '—'}</td>
                            <td className="py-2 pr-3 text-gray-600">{(a.assigned_to && profileById.get(a.assigned_to)) || '—'}</td>
                            <td className="py-2 pr-3">{a.status === 'done'
                              ? <span className="rounded-full bg-positive-100 px-2 py-0.5 text-positive-700">Concluída</span>
                              : late ? <span className="rounded-full bg-negative-100 px-2 py-0.5 text-negative-700">Atrasada</span>
                              : <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600">Planejada</span>}</td>
                            <td className="py-2 pr-3">{a.contract_id ? <Link href={`/contracts/${a.contract_id}?tab=atividades`} className="text-brand-700 hover:underline">{contractNameById.get(a.contract_id) ?? 'Abrir'}</Link> : <span className="text-gray-500">Empresa</span>}</td>
                            <td className="py-2"><ActivityDoneButton id={a.id} done={a.status === 'done'} /></td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                )}
                </div>
              ),
            },
            {
              id: 'emails', label: `E-mails (${(companyEmails ?? []).length})`,
              content: (companyEmails ?? []).length === 0 ? <p className="text-sm text-gray-400">Nenhum e-mail nas oportunidades desta empresa.</p> : (
                <ul className="divide-y divide-gray-50">
                  {(companyEmails ?? []).map((m: any) => (
                    <li key={m.id} className="py-2.5">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <Link href={`/contracts/${m.contract_id}?tab=email`} className="text-sm font-medium text-gray-900 hover:underline">{m.subject || '(sem assunto)'}</Link>
                        <span className="text-[11px] text-gray-400">{m.sent_at ? new Date(m.sent_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                      </div>
                      <p className="text-xs text-gray-500">
                        {m.direction === 'recebido' || m.direction === 'inbound' ? `Recebido de ${m.from_email ?? '—'}` : `Enviado para ${m.to_email ?? '—'}`}
                        {m.opened_at ? ' · aberto' : ''} · {contractNameById.get(m.contract_id) ?? ''}
                      </p>
                    </li>
                  ))}
                </ul>
              ),
            },
            {
              id: 'propostas', label: `Propostas (${(companyProposals ?? []).length})`,
              content: (companyProposals ?? []).length === 0 ? <p className="text-sm text-gray-400">Nenhuma proposta nas oportunidades desta empresa.</p> : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead className="text-left text-gray-500"><tr><th className="py-1.5 pr-3 font-medium">Proposta</th><th className="py-1.5 pr-3 font-medium">Situação</th><th className="py-1.5 pr-3 font-medium text-right">Valor</th><th className="py-1.5 pr-3 font-medium">Criada em</th><th className="py-1.5 font-medium">Oportunidade</th></tr></thead>
                    <tbody className="divide-y divide-gray-50">
                      {(companyProposals ?? []).map((p: any) => (
                        <tr key={p.id}>
                          <td className="py-2 pr-3 font-medium text-gray-900">{p.control_code ?? 'Proposta'}{p.version ? ` · v${p.version}` : ''}</td>
                          <td className="py-2 pr-3 text-gray-600">{PROP_LABEL[p.workflow_status] ?? p.workflow_status ?? '—'}</td>
                          <td className="py-2 pr-3 text-right tabular-nums text-gray-900">{Number(p.proposal_value) > 0 ? fmt(Number(p.proposal_value)) : '—'}</td>
                          <td className="py-2 pr-3 text-gray-600">{new Date(p.created_at).toLocaleDateString('pt-BR')}</td>
                          <td className="py-2"><Link href={`/contracts/${p.contract_id}/proposals`} className="text-brand-700 hover:underline">{contractNameById.get(p.contract_id) ?? 'Abrir'}</Link></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ),
            },
            {
              id: 'arquivos', label: `Arquivos (${(companyFiles ?? []).length + (oppFiles ?? []).length})`,
              content: (
                <CompanyFilesSection
                  companyId={company.id}
                  isAdmin={isAdmin}
                  files={(companyFiles ?? []).map((f: any) => ({ ...f, uploader: f.uploaded_by ? profileById.get(f.uploaded_by) ?? null : null }))}
                  contractFiles={(oppFiles ?? []).map((f: any) => ({ ...f, contract_label: contractNameById.get(f.contract_id) ?? 'Oportunidade' }))}
                />
              ),
            },
            {
              id: 'oportunidades', label: `Oportunidades (${(companyRuns ?? []).length})`,
              content: (
                <div>
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
              ),
            },
          ]} />
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
