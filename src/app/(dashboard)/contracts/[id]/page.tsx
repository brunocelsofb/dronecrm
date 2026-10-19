import { fmtPct, fmtNum1 } from '@/lib/format'
import { createAdminClient } from '@/lib/supabase/admin'
export const dynamic = 'force-dynamic'
// Leitura de contrato pela IA (Farmer) pode levar até ~1 minuto
export const maxDuration = 120
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { StageBar } from '@/components/contracts/stage-bar'
import { Timeline } from '@/components/contracts/timeline'
import { TimelineFeed } from '@/components/contracts/timeline-feed'
import { TransferSLABanner } from '@/components/contracts/transfer-sla-banner'
import { ActivityFeed } from '@/components/activities/activity-feed'
import { ActivitiesTable } from '@/components/activities/activities-table'
import { NoteForm } from '@/components/contracts/note-form'
import { NpsSection } from '@/components/nps/nps-section'
import { FilesSection } from '@/components/contracts/files-section'
import { CustomSurveysSection } from '@/components/surveys/custom-surveys-section'
import { ValidityBadge } from '@/components/contracts/validity-badge'
import { ContractTagSelect } from '@/components/tags/contract-tag-select'
import { DepartmentSection } from '@/components/contracts/department-section'
import { AccountOwnerBadge } from '@/components/contracts/account-owner-badge'
import { BillingSection } from '@/components/contracts/billing-section'
import { ContractReadingSection } from '@/components/contracts/contract-reading-section'
import { checkReading, normalizeReading } from '@/lib/agent/contract-reader'
import { getAnthropicKeyForTenant } from '@/lib/ai/tenant-key'
import { resolveTenantId as resolveTenantForReading } from '@/lib/tenant/context'
import { RevenueTypeToggle } from '@/components/contracts/revenue-type-toggle'
import { RenewalValueSection } from '@/components/contracts/renewal-value-section'
import { RenewalRulerPanel, type RulerRunView } from '@/components/contracts/renewal-ruler-panel'
import { resolveRulerSettings } from '@/lib/agent/renewal-ruler'
import { InlineValueEditor } from '@/components/contracts/inline-value-editor'
import { ProposalsSection } from '@/components/proposals/proposals-section'
import { ContractTicketsSection } from '@/components/tickets/contract-tickets-section'
import { ContractEmailSection } from '@/components/email/contract-email-section'
import { ContractCustomFieldsSection } from '@/components/custom-fields/contract-custom-fields-section'
import { ContractContactsSection } from '@/components/contracts/contract-contacts-section'
import { ContractZapSignSection } from '@/components/zapsign/contract-zapsign-section'
import { PortfolioFieldsForm } from '@/components/carteira/portfolio-fields-form'
import { ProposalTab } from '@/components/proposals/proposal-tab'
import { getContractContacts } from '@/lib/actions/contract-contacts'
import { getConnectedEmailAccount } from '@/lib/actions/email'
import { getContractCustomFieldValues } from '@/lib/actions/custom-fields'
import { DeleteContractButton } from '@/components/contracts/delete-contract-button'
import { ActionPlanSection, type PlanRow, type ItemRow } from '@/components/contracts/action-plan-section'
import { resolveActionPlanSettings } from '@/lib/quality/action-plan'
import { DimensioningSection } from '@/components/contracts/dimensioning-section'
import { ContractTabs } from '@/components/contracts/contract-tabs'
import { setContractTag } from '@/lib/actions/tags'
import { getCurrentProfile } from '@/lib/auth/role'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ImplementationTab } from '@/components/implementation/implementation-tab'
import { getContractSchedule, getImplementationTemplates } from '@/lib/actions/implementation'
import { resolveTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { CampaignPicker } from '@/components/marketing/campaign-picker'

// Hoje em Brasília (aaaa-mm-dd), para marcar passos atrasados
function todayBrIso(): string {
  return new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)
}

export default async function ContractDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: contract } = await supabase
    .from('contracts')
    .select('*')
    .eq('id', id)
    .single()

  if (!contract) notFound()

  // PERFORMANCE: estas 4 consultas não dependem umas das outras (só do
  // contrato já carregado acima), então saem em paralelo em vez de uma
  // esperar a outra — reduz bastante o tempo de carregar esta tela.
  const [
    { data: linkedCompany },
    { data: linkedContact },
    { data: runs },
    { data: activitiesRaw },
    { data: contractFiles },
    { data: allTags },
    { data: currentContractTags },
    { data: npsSurveys },
    { data: allSurveyTemplates },
    { data: sentCustomSurveys },
    { data: actionPlanItems },
    { data: dimensioningReviews },
    { data: allProfiles },
    { data: billingRecords },
    { data: proposals },
    { data: catalogItems },
    { data: transferRequests },
  ] = await Promise.all([
    contract.company_id
      ? supabase.from('companies').select('id, name, city, state, cnpj').eq('id', contract.company_id).maybeSingle()
      : Promise.resolve({ data: null }),
    contract.contact_id
      ? supabase.from('contacts').select('id, name, role, email, phone').eq('id', contract.contact_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from('pipeline_runs').select('*').eq('contract_id', id).order('started_at', { ascending: true }),
    supabase.from('activities').select('id, type, activity_type, title, content, status, activity_date, activity_time, duration_minutes, created_at, due_date, completed, user_id, assigned_to, metadata, is_pinned').eq('contract_id', id).order('is_pinned', { ascending: false }).order('created_at', { ascending: false }),
    supabase.from('contract_files').select('id, file_name, storage_path, file_size, mime_type, created_at, document_kind').eq('contract_id', id).order('created_at', { ascending: false }),
    supabase.from('tags').select('id, name, color').order('name'),
    supabase.from('contract_tags').select('tag_id').eq('contract_id', id),
    supabase.from('nps_surveys').select('id, token, score, comment, status, sent_at, answered_at, respondent_name, respondent_email, respondent_phone').eq('contract_id', id).order('sent_at', { ascending: false }),
    supabase.from('survey_templates').select('id, name, tag_id, questions, target_type, target_tag_id, target_pipeline_id').order('name'),
    supabase.from('custom_surveys').select('id, token, status, sent_at, answered_at, expires_at, respondent_name, respondent_email, respondent_phone, template_id, responses').eq('contract_id', id).order('sent_at', { ascending: false }),
    supabase.from('action_plan_items').select('id, plan_id, description, responsible_department, status, created_at, resolved_at, why, where_text, due_date, assigned_to, how, how_much').eq('contract_id', id).order('created_at', { ascending: true }),
    supabase.from('dimensioning_reviews').select('id, file_storage_path, file_name, sent_at, status, reviewed_at, review_notes').eq('contract_id', id).order('sent_at', { ascending: false }),
    supabase.from('profiles').select('id, full_name, department'),
    supabase.from('billing_records').select('id, year, month, amount, measured_amount, glosa_amount, glosa_reason, discount_amount, discount_reason, contract_value, status, file_storage_path, file_name, notes, confirmed_at, approved_at').eq('contract_id', id).order('year', { ascending: false }).order('month', { ascending: false }),
    supabase.from('proposals').select('id, control_code, version, status, workflow_status, proposal_value, proposal_validity_days, created_at, updated_at, technical_snapshot, review_token, submitted_at, submitted_by_name, technical_approved_at, technical_approved_by_name, technical_approved_by_role, technical_comment, technical_restrictions, commercial_approved_at, commercial_approved_by_name, commercial_approved_by_role, client_status, client_approved_at, client_approved_by_name, client_review_token, texto_objetivos, texto_atividades, texto_estrutura_apoio').eq('contract_id', id).is('deleted_at', null).order('created_at', { ascending: false }),
    supabase.from('proposal_catalog_items').select('id, name, category, type, characteristics, unit_value').order('name'),
    supabase.from('transfer_requests').select('*').eq('contract_id', id).in('status', ['pending', 'in_progress']).order('created_at', { ascending: false }).limit(1),
  ])

  const currentTagIds = (currentContractTags ?? []).map((t: any) => t.tag_id).filter(Boolean)

  // Busca nomes das tags para fallback de comparação por nome
  let currentTagNames: string[] = []
  if (currentTagIds.length > 0) {
    const { data: tagNames } = await supabase.from('tags').select('id, name').in('id', currentTagIds)
    currentTagNames = (tagNames ?? []).map((t: any) => t.name?.toLowerCase() ?? '')
  }

  // Só mostra formulários sem tag (gerais) ou da MESMA tag do contrato.
  const availableTemplates = (allSurveyTemplates ?? []).filter((t: any) => {
    try {
      const target = t.target_type || 'any'
      if (target === 'avulso') return false
      if (target === 'pipeline') {
        return displayRun ? (t.target_pipeline_id ?? null) === displayRun.pipeline_id : false
      }
      if (target === 'tag') {
        const tagId = t.target_tag_id || t.tag_id
        return tagId ? currentTagIds.includes(tagId) : false
      }

      // Para 'any' e 'contracts': se contrato tem tags, filtra por nome do template
      if (currentTagNames.length > 0) {
        const tName = (t.name ?? '').toLowerCase()
        const tCategory = (t.category ?? '').toLowerCase()

        // Verifica se o formulário menciona uma tag que NÃO é do contrato
        const ALL_TAG_KEYWORDS = ['clínica', 'clinica', 'hospitalar', 'predial', 'metrologia', 'avulso']
        const mentionedKeywords = ALL_TAG_KEYWORDS.filter(kw => tName.includes(kw) || tCategory.includes(kw))

        if (mentionedKeywords.length > 0) {
          // O formulário menciona alguma especialidade — verifica se bate com o contrato
          return mentionedKeywords.some(kw =>
            currentTagNames.some(tagName => tagName.includes(kw))
          )
        }
        // Formulário sem keyword de especialidade → exibe normalmente
        return true
      }

      // Contrato sem tags — tag_id legado
      if (t.tag_id) return currentTagIds.includes(t.tag_id)
      return true
    } catch { return true }
  })

  // NOTA DE INCERTEZA: mesmo aviso de sempre — uso o header "host" pra
  // montar o link absoluto, funciona bem na Vercel mas não testei em
  // outros ambientes de hospedagem.
  const headersList = await headers()
  const host = headersList.get('host') ?? 'localhost:3000'
  const linkBase = `${host.includes('localhost') ? 'http' : 'https'}://${host}`

  const openRun = runs?.find((r) => r.status === 'open')
  const lastRun = runs && runs.length > 0 ? runs[runs.length - 1] : undefined
  const displayRun = openRun ?? lastRun

  const pipelineIds = [...new Set((runs ?? []).map((r) => r.pipeline_id))]
  const runIds = (runs ?? []).map((r) => r.id)
  const userIds = [...new Set((activitiesRaw ?? []).map((a) => a.user_id).filter((v): v is string => !!v))]

  // PERFORMANCE: mesma lógica — estas 4 também não dependem umas das
  // outras, só dos resultados acima.
  const [
    { data: pipelines },
    { data: stages },
    { data: history },
    { data: activityProfiles },
    { data: lostReasons },
  ] = await Promise.all([
    pipelineIds.length
      ? supabase.from('pipelines').select('id, name, won_label, lost_label, type').in('id', pipelineIds)
      : Promise.resolve({ data: [] as { id: string; name: string; won_label: string; lost_label: string; type: string }[] }),
    displayRun
      ? supabase.from('stages').select('id, name, order_index, is_won, is_lost, sla_days, color').eq('pipeline_id', displayRun.pipeline_id).order('order_index')
      : Promise.resolve({ data: [] as { id: string; name: string; order_index: number; is_won: boolean; is_lost: boolean; sla_days: number | null; color: string | null }[] }),
    runIds.length
      ? supabase.from('stage_history').select('pipeline_run_id, stage_id, entered_at, exited_at, duration_seconds').in('pipeline_run_id', runIds)
      : Promise.resolve({ data: [] as { pipeline_run_id: string; stage_id: string; entered_at: string; exited_at: string | null; duration_seconds: number | null }[] }),
    userIds.length
      ? supabase.from('profiles').select('id, full_name').in('id', userIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    supabase.from('lost_reasons').select('id, name').eq('active', true).order('display_order'),
  ])

  const pipelineById = new Map((pipelines ?? []).map((p) => [p.id, p]))
  const profileById = new Map((activityProfiles ?? []).map((p) => [p.id, p.full_name]))
  const isCurrentlyInSalesPipeline = displayRun ? pipelineById.get(displayRun.pipeline_id)?.type === 'vendas' : false
  const isCurrentlyInContractsPipeline = displayRun ? pipelineById.get(displayRun.pipeline_id)?.type === 'gestao_contratos' : false

  // Ponto 1: valor agregado das propostas ativas (exclui recusadas)
  const proposalSum = (proposals ?? [])
    .filter(p => !['cliente_recusado', 'declinada'].includes(p.workflow_status ?? ''))
    .reduce((s, p) => s + Number(p.proposal_value ?? 0), 0)
  // Na carteira (Gestão de Contratos) o valor vigente é o do cadastro do contrato
  // (mesmo número usado no Painel gerencial); em vendas, o estimado pelas propostas.
  const estimatedValue = isCurrentlyInContractsPipeline
    ? (Number((contract as any).monthly_value) || Number(displayRun?.value ?? 0))
    : (proposalSum > 0 ? proposalSum : Number(displayRun?.value ?? 0))

  // Stages de todos os funis de vendas (para botão de transferência)
  const salesPipelineIds = (pipelines ?? []).filter(p => p.type === 'vendas').map(p => p.id)
  const { data: allStagesData } = salesPipelineIds.length > 1
    ? await supabase.from('stages').select('id, name, order_index, pipeline_id').in('pipeline_id', salesPipelineIds).order('order_index')
    : { data: [] as any[] }

  const activities = (activitiesRaw ?? []).map((a) => ({
    ...a,
    profiles: a.user_id ? { full_name: profileById.get(a.user_id) ?? '' } : null,
  }))

  const allProfilesById = new Map((allProfiles ?? []).map((p) => [p.id, p]))
  const currentAssigneeName = contract.current_assignee_id
    ? allProfilesById.get(contract.current_assignee_id)?.full_name ?? null
    : null
  const accountOwnerName = contract.owner_id ? allProfilesById.get(contract.owner_id)?.full_name ?? null : null
  const hasPreviousResponsible = !!contract.previous_department

  // "Dono da conta" (owner_id) é fixo/de longo prazo — diferente de
  // "responsável agora" (current_assignee_id), que é só a tratativa
  // pontual do momento e NÃO dá poder de mudar etapa.
  const currentProfile = await getCurrentProfile()

  // Farmer · leitura do contrato (última leitura + PDFs disponíveis)
  const [{ data: lastReading }, aiKeyInfo] = await Promise.all([
    supabase.from('contract_ai_readings').select('created_at, file_name, status, error, result').eq('contract_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    getAnthropicKeyForTenant(await resolveTenantForReading({ contractId: id })),
  ])
  const readingResult = lastReading?.status === 'ok' && lastReading.result ? normalizeReading(lastReading.result) : null
  const readingChecks = readingResult ? checkReading(readingResult, { valid_from: contract.valid_from ?? null, valid_until: contract.valid_until ?? null, monthly_value: (contract as any).monthly_value ?? null }) : null
  // Aba "Contrato e aditivos": só arquivos marcados como contrato/aditivo
  const contractDocs = (contractFiles ?? []).filter((f: any) => f.document_kind === 'contrato' || f.document_kind === 'aditivo')
  const readableDocs = contractDocs
    .filter((f: any) => (f.mime_type ?? '').includes('pdf') || /\.pdf$/i.test(f.file_name ?? ''))
    .map((f: any) => ({ id: f.id, file_name: f.file_name, created_at: f.created_at, kind: f.document_kind as 'contrato' | 'aditivo' }))
  // remonta as listas quando um arquivo muda de aba
  const fileKey = (k: string) => `${k}:${(contractFiles ?? []).map((f: any) => `${f.id}.${f.document_kind}`).join(',')}`
  const canChangeStage =
    contract.owner_id === currentProfile?.id || currentProfile?.role === 'admin'

  // Plano de ação (tratativas PDCA) e ferramentas ligadas pela empresa
  const [{ data: actionPlans }, { data: actionPlanOrg }] = await Promise.all([
    supabase.from('action_plans')
      .select('id, title, origin, description, phase, cycle, gut_g, gut_u, gut_t, five_whys, ishikawa, root_cause, cause_method, efficacy_result, efficacy_note, efficacy_checked_at, standardization, created_at, closed_at')
      .eq('contract_id', id),
    supabase.from('organization_settings').select('action_plan_settings').eq('tenant_id', await resolveTenantForReading({ contractId: id })).maybeSingle(),
  ])

  // Régua de renovação (processo interno da renovação)
  const [{ data: rulerRun }, { data: rulerOrg }] = isCurrentlyInContractsPipeline
    ? await Promise.all([
        supabase.from('renewal_ruler_runs')
          .select('id, status, period_end, steps, lock_renewed, started_at, ready_at, finished_at')
          .eq('contract_id', id).order('started_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('organization_settings').select('copilot_settings').eq('tenant_id', await resolveTenantForReading({ contractId: id })).maybeSingle(),
      ])
    : [{ data: null }, { data: null }]
  const rulerEnabled = resolveRulerSettings(rulerOrg?.copilot_settings).enabled

  // Dados de implantação
  const [implementationSchedule, implementationTemplates] = await Promise.all([
    getContractSchedule(id),
    getImplementationTemplates(),
  ])

  // Busca o pipeline do contrato (via pipeline_run)
  const implementationPipelineId = (contract as any)?.current_pipeline_id
  // Configuração de abas por pipeline — com fallback seguro
  let pipelineTabConfig: { order: string[] | null; hidden: string[] } = { order: null, hidden: [] }
  try {
    const tabOrderData = await supabase
      .from('organization_settings')
      .select('pipeline_tab_config')
      .eq('tenant_id', await resolveTenantId())
      .maybeSingle()

    const allPipelineConfig = (tabOrderData?.data as any)?.pipeline_tab_config ?? {}
    const pipelineId = (contract as any)?.current_pipeline_id
      ?? (contract as any)?.pipeline_runs?.[0]?.pipeline_id
      ?? null

    if (pipelineId) {
      const savedConfig = allPipelineConfig[pipelineId] ?? null
      if (savedConfig) {
        pipelineTabConfig = savedConfig
      } else {
        // Default inteligente baseado no nome do pipeline
        const pipelineRes = await supabase
          .from('pipelines').select('name').eq('id', pipelineId).maybeSingle()
        const pname = (pipelineRes?.data as any)?.name?.toLowerCase() ?? ''
        const hidden = pname.includes('contrato') || pname.includes('gestão')
          ? []
          : pname.includes('avulso')
          ? ['implantacao', 'pesquisas', 'carteira']
          : ['implantacao', 'carteira', 'pesquisas']
        pipelineTabConfig = { order: null, hidden }
      }
    }
  } catch (e) {
    console.error('[contracts/page] erro ao carregar tab config:', e)
  }

  const transferLog = activities
    .filter((a) => a.type === 'transfer')
    .map((a) => ({
      id: a.id,
      content: a.content,
      created_at: a.created_at,
      user_name: a.profiles?.full_name ?? null,
    }))

  // Dias por etapa, calculados apenas dentro da run aberta atual
  // (a barra de pipeline mostra só o funil em andamento no momento).
  const timings = (stages ?? []).map((stage) => {
    const rows = (history ?? []).filter((h) => h.pipeline_run_id === displayRun?.id && h.stage_id === stage.id)
    if (rows.length === 0) return { stageId: stage.id, days: null, isOverdue: false }

    const totalSeconds = rows.reduce((sum, r) => {
      if (r.duration_seconds !== null) return sum + r.duration_seconds
      return sum + Math.round((Date.now() - new Date(r.entered_at).getTime()) / 1000)
    }, 0)

    const days = Math.floor(totalSeconds / 86_400)
    const isOverdue = stage.sla_days !== null && days > stage.sla_days
    return { stageId: stage.id, days, isOverdue }
  })

  const [{ data: emailTemplates }, { data: contractEmails }, connectedEmailAccount, { data: orgEmailSettings }, { data: customFields }, customFieldValues, contractContacts, { data: companyAllContacts }, { data: zapsignTemplates }, { data: zapsignDocuments }, { data: orgZapSignSettings }, { data: proposalStatus }] = await Promise.all([
    supabase.from('email_templates').select('id, name').eq('context', 'contract').eq('channel', 'email').order('name'),
    supabase.from('contract_emails').select('id, from_email, to_email, cc_email, bcc_email, subject, body, sent_at, status, triggered_automatically, error_message, opened_at, direction').eq('contract_id', contract.id).order('sent_at', { ascending: false }),
    getConnectedEmailAccount().catch(() => null),
    supabase.from('organization_settings').select('inbound_email_domain').eq('tenant_id', await resolveTenantId()).maybeSingle(),
    supabase.from('custom_fields').select('id, name, field_key, field_type, select_options').order('name'),
    getContractCustomFieldValues(contract.id).catch(() => ({} as Record<string, string>)),
    getContractContacts(contract.id),
    contract.company_id
      ? supabase.from('contacts').select('id, name, role').eq('company_id', contract.company_id).order('name')
      : Promise.resolve({ data: [] as { id: string; name: string; role: string | null }[] }),
    supabase.from('zapsign_templates').select('id, name, type').order('name'),
    supabase.from('zapsign_documents').select('id, name, status, sent_at, signed_at, source, document_kind, signers, signed_file_id').eq('contract_id', contract.id).order('created_at', { ascending: false }),
    supabase.from('organization_settings').select('zapsign_api_token').eq('tenant_id', await resolveTenantId()).maybeSingle(),
    supabase.from('proposal_status').select('status, proposal_value, actor_name, actor_email, updated_at, technical_snapshot, technical_comment, technical_restrictions, review_token, submitted_at, submitted_by_name, technical_approved_at, technical_approved_by_name, technical_approved_by_role, commercial_approved_at, commercial_approved_by_name, commercial_approved_by_role, client_status, client_approved_at, client_approved_by_name, client_review_token, texto_objetivos, texto_atividades, texto_estrutura_apoio').eq('contract_id', contract.id).maybeSingle(),
  ])

  const inboundEmailAddress =
    orgEmailSettings?.inbound_email_domain && contract.inbound_email_code
      ? `${contract.inbound_email_code}@${orgEmailSettings.inbound_email_domain}`
      : null

  // CNPJs de faturamento da empresa (Configurações → billing_cnpjs)
  const { data: billingOrg } = await (await createScopedAdmin())
    .from('organization_settings').select('billing_cnpjs').eq('tenant_id', await resolveTenantId({ contractId: contract.id })).maybeSingle()
  const billingCnpjs = (Array.isArray(billingOrg?.billing_cnpjs) ? billingOrg.billing_cnpjs : []) as { value: string; label: string }[]

  // Origem de marketing (campanha) — liga a oportunidade ao resultado da campanha
  const { data: mkCampaigns } = await supabase.from('marketing_campaigns').select('id, name, status').order('name')
  const originLead = (contract as { lead_id?: string | null }).lead_id ?? null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Link href="/pipeline" style={{ fontSize: 12, color: '#8892a4', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        ← Voltar para o Funil
      </Link>

      <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #e8edf5', padding: '20px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <h1 style={{ fontSize: 20, fontWeight: 500, color: '#1a1f36', margin: 0 }}>{contract.client_name}</h1>
              <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, background: '#f1f3f8', color: '#52514e' }}>{contract.title}</span>
              <ValidityBadge validUntil={contract.valid_until} />
              {isCurrentlyInContractsPipeline && <RevenueTypeToggle contractId={contract.id} billingType={contract.billing_type} canEdit={canChangeStage} />}
              <ContractTagSelect
                key={currentTagIds.join(',')||'none'}
                tags={allTags ?? []}
                currentTagIds={currentTagIds}
                contractId={contract.id}
              />
              <AccountOwnerBadge
                contractId={contract.id}
                ownerName={accountOwnerName}
                isAdmin={currentProfile?.role === 'admin'}
                users={(allProfiles ?? []).map((p) => ({ id: p.id, full_name: p.full_name }))}
              />
              {contract.auto_renewal && (
                <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, background: '#e8e7f4', color: '#524e9c' }}>
                  🔄 Renovação automática
                </span>
              )}
            </div>
            <p style={{ marginTop: 6, fontFamily: 'monospace', fontSize: 12, color: '#b0b8c8' }}>{contract.process_number}</p>
            <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 12, color: '#8892a4' }}>
              <span>Origem:</span>
              <CampaignPicker kind="contract" id={contract.id} value={(contract as { campaign_id?: string | null }).campaign_id ?? null} campaigns={mkCampaigns ?? []} />
              {originLead && <Link href={`/leads/${originLead}`} style={{ color: '#1b556b', textDecoration: 'none' }}>ver lead de origem →</Link>}
              {(contract as { lead_source?: string | null }).lead_source && <span>· {(contract as { lead_source?: string | null }).lead_source}</span>}
            </div>
            {linkedCompany && (
              <Link href={`/companies/${linkedCompany.id}`} style={{ marginTop: 4, display: 'inline-block', fontSize: 12, color: '#1b556b', textDecoration: 'none' }}>
                {linkedCompany.name} →
              </Link>
            )}
            {linkedContact && (
              <p style={{ marginTop: 4, fontSize: 12, color: '#8892a4' }}>
                {linkedContact.name}
                {linkedContact.role ? ` · ${linkedContact.role}` : ''}
                {linkedContact.email ? ` · ${linkedContact.email}` : ''}
                {linkedContact.phone ? ` · ${linkedContact.phone}` : ''}
              </p>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <Link href={`/contracts/${contract.id}/edit`} style={{ padding: '7px 14px', fontSize: 12, borderRadius: 8, border: '0.5px solid #d1d8e8', background: '#fff', color: '#52514e', textDecoration: 'none' }}>
              {isCurrentlyInContractsPipeline ? 'Editar contrato' : 'Editar oportunidade'}
            </Link>
            {currentProfile?.role === 'admin' && (
              <DeleteContractButton
                contractId={contract.id}
                label={isCurrentlyInContractsPipeline ? 'Excluir contrato' : 'Excluir oportunidade'}
              />
            )}
          </div>
        </div>
      </div>

      {displayRun && stages && stages.length > 0 ? (
        <StageBar
          contractId={contract.id}
          lostReasons={lostReasons ?? []}
          stages={stages}
          currentStageId={displayRun.stage_id}
          timings={timings}
          status={displayRun.status}
          wonLabel={pipelineById.get(displayRun.pipeline_id)?.won_label ?? 'Ganho'}
          lostLabel={pipelineById.get(displayRun.pipeline_id)?.lost_label ?? 'Perdido'}
          canChangeStage={canChangeStage}
          accountOwnerOptions={(allProfiles ?? []).map((p) => ({ id: p.id, full_name: p.full_name ?? '' })).sort((a, b) => a.full_name.localeCompare(b.full_name))}
          currentOwnerId={contract.owner_id ?? null}
          billingCnpjs={billingCnpjs}
          pipelineType={pipelineById.get(displayRun.pipeline_id)?.type}
          contractNature={(contract as any).nature ?? null}
          contractValue={Number(displayRun.value) || 0}
          currentMonthlyValue={Number((contract as any).monthly_value) || Number(displayRun.value) || 0}
          currentValidUntil={contract.valid_until ?? null}
          currentReportName={displayRun.status === 'open' ? ((displayRun as any).report_file_name ?? null) : null}
          otherPipelines={pipelineById.get(displayRun.pipeline_id)?.type === 'vendas'
            ? (pipelines ?? [])
                .filter(p => p.type === 'vendas' && p.id !== displayRun.pipeline_id)
                .map(p => ({
                  id: p.id,
                  name: p.name,
                  stages: (allStagesData ?? []).filter((s: any) => s.pipeline_id === p.id).sort((a: any, b: any) => a.order_index - b.order_index),
                }))
            : []
          }
        />
      ) : (
        <p style={{ borderRadius: 10, background: '#f8f9fb', padding: 16, fontSize: 13, color: '#8892a4' }}>
          Este contrato não tem nenhuma passagem de funil em aberto no momento.
        </p>
      )}

      <ContractTabs
        tabOrder={pipelineTabConfig?.order ?? null}
        hiddenTabs={pipelineTabConfig?.hidden ?? []}
        tabs={[
          {
            id: 'visao-geral',
            label: 'Visão Geral',
            content: (
              <div className="space-y-6">
                {isCurrentlyInContractsPipeline && displayRun && (
                  <RenewalValueSection
                    contractId={contract.id}
                    currentValue={estimatedValue}
                    canEdit={canChangeStage}
                    canCreateProposal={['admin', 'member', 'aprovador_comercial'].includes(currentProfile?.role ?? '')}
                    isCurrentlyInContractsPipeline={isCurrentlyInContractsPipeline}
                  />
                )}

                {isCurrentlyInContractsPipeline && (
                  <RenewalRulerPanel
                    contractId={contract.id}
                    run={(rulerRun as RulerRunView | null) ?? null}
                    enabled={rulerEnabled}
                    canAct={!!currentProfile}
                    isAdmin={currentProfile?.role === 'admin'}
                    today={todayBrIso()}
                  />
                )}

                <div className="grid grid-cols-2 gap-3">
                  {/* Vigência / Previsão */}
                  {isCurrentlyInContractsPipeline ? (
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-5">
                      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Vigência</p>
                      <p className="text-base font-semibold text-gray-900">
                        {contract.valid_until
                          ? `${contract.valid_from ? new Date(contract.valid_from).toLocaleDateString('pt-BR') : '?'} → ${new Date(contract.valid_until).toLocaleDateString('pt-BR')}`
                          : 'Não informada'}
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-5">
                      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Previsão de fechamento</p>
                      <p className="text-base font-semibold text-gray-900">
                        {displayRun?.expected_close_date
                          ? new Date(displayRun.expected_close_date).toLocaleDateString('pt-BR')
                          : 'Não informada'}
                      </p>
                    </div>
                  )}

                  {/* Aberto desde */}
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-5">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Aberto desde</p>
                    <p className="text-base font-semibold text-gray-900">
                      {new Date(contract.created_at).toLocaleDateString('pt-BR')}
                    </p>
                  </div>
                </div>

                {runs && runs.length > 1 && (
                  <div className="space-y-2">
                    <h2 className="text-sm font-medium text-gray-900">Jornada entre funis</h2>
                    <div className="space-y-2">
                      {runs.map((r) => {
                        const previous = r.previous_run_id ? runs.find((x) => x.id === r.previous_run_id) : null
                        const currentValue = Number(r.value) || 0
                        const previousValue = previous ? Number(previous.value) || 0 : null
                        const pctChange =
                          previousValue !== null && previousValue > 0
                            ? Math.round(((currentValue - previousValue) / previousValue) * 1000) / 10
                            : null

                        return (
                          <div key={r.id} className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm">
                            <div className="flex items-center justify-between">
                              <div>
                                <span className="font-medium text-gray-900">{pipelineById.get(r.pipeline_id)?.name}</span>
                                <span className="ml-2 text-gray-400">
                                  {new Date(r.started_at).toLocaleDateString('pt-BR')}
                                  {r.ended_at ? ` → ${new Date(r.ended_at).toLocaleDateString('pt-BR')}` : ' → em andamento'}
                                </span>
                              </div>
                              <span
                                className={
                                  r.status === 'won'
                                    ? 'text-emerald-600'
                                    : r.status === 'lost'
                                      ? 'text-red-600'
                                      : r.status === 'moved'
                                        ? 'text-gray-400'
                                        : 'text-blue-600'
                                }
                              >
                                {(
                                  { open: 'Em andamento', won: 'Ganho', lost: 'Perdido', moved: 'Movido para outro funil' } as Record<string, string>
                                )[r.status]}
                              </span>
                            </div>
                            {currentValue > 0 && (
                              <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                                <span>
                                  {previousValue !== null ? `${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(previousValue)} → ` : ''}
                                  <span className="font-medium text-gray-700">
                                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(currentValue)}
                                  </span>
                                </span>
                                {pctChange !== null && (
                                  <span className={pctChange >= 0 ? 'text-positive-700' : 'text-negative-700'}>
                                    ({fmtPct(pctChange, { signed: true })})
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                <ContractContactsSection contractId={contract.id} contacts={contractContacts} companyContacts={companyAllContacts ?? []} />

                <ContractCustomFieldsSection contractId={contract.id} fields={customFields ?? []} values={customFieldValues} />

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {transferRequests?.[0] && (
                    <TransferSLABanner
                      transfer={transferRequests[0] as any}
                      contractId={contract.id}
                      currentUserName={currentProfile?.id ? (allProfilesById.get(currentProfile.id)?.full_name ?? 'Usuário') : 'Usuário'}
                      currentUserId={currentProfile?.id ?? ''}
                      toUserId={(transferRequests[0] as any).to_user_id}
                    />
                  )}
                  <TimelineFeed
                    events={activities ?? []}
                    contractId={contract.id}
                    currentUserRole={currentProfile?.role ?? 'member'}
                  />
                </div>
              </div>
            ),
          },
          {
            id: 'atividades',
            label: 'Atividades',
            content: (
              <ActivitiesTable
                activities={(activities ?? []).filter((a: any) =>
                  ['call', 'meeting', 'task', 'reminder'].includes(a.type) ||
                  ['call', 'meeting', 'task', 'reminder'].includes(a.activity_type ?? '')
                )}
                contractId={contract.id}
                profiles={allProfiles ?? []}
                currentUserId={currentProfile?.id ?? ''}
              />
            ),
          },

          {
            id: 'responsavel',
            label: 'Responsável & Transferências',
            content: (
              <DepartmentSection
                contractId={contract.id}
                currentDepartment={contract.current_department}
                currentAssigneeName={currentAssigneeName}
                hasPrevious={hasPreviousResponsible}
                users={(allProfiles ?? []).filter((p) => p.department)}
                transfers={transferLog}
              />
            ),
          },
          {
            id: 'plano-de-acao',
            label: 'Plano de Ação',
            content: (
              <ActionPlanSection
                contractId={contract.id}
                plans={(actionPlans ?? []) as PlanRow[]}
                items={(actionPlanItems ?? []) as ItemRow[]}
                settings={resolveActionPlanSettings(actionPlanOrg?.action_plan_settings)}
                people={(allProfiles ?? []).map(p => ({ id: p.id as string, name: (p.full_name as string | null) ?? '—' })).sort((a, b) => a.name.localeCompare(b.name))}
              />
            ),
          },
          {
            id: 'arquivos',
            label: 'Arquivos',
            content: <FilesSection key={fileKey('arquivo')} contractId={contract.id} initialFiles={(contractFiles ?? []).filter((f: any) => (f.document_kind ?? 'arquivo') === 'arquivo')} />,
          },
          ...(isCurrentlyInContractsPipeline || isCurrentlyInSalesPipeline ? [{
            id: 'leitura-contrato',
            label: 'Contrato e aditivos',
            content: (
              <div className="space-y-6">
                <FilesSection key={fileKey('contrato')} mode="contrato" contractId={contract.id} initialFiles={contractDocs} />
                <ContractZapSignSection
                  contractId={contract.id}
                  clientName={contract.client_name ?? ''}
                  templates={zapsignTemplates ?? []}
                  documents={(zapsignDocuments ?? []) as any}
                  pdfDocs={readableDocs}
                  signedFilePaths={Object.fromEntries((contractFiles ?? []).map((f: any) => [f.id, f.storage_path]))}
                  defaultContactName={linkedContact?.name ?? null}
                  defaultContactEmail={linkedContact?.email ?? null}
                  defaultContactPhone={linkedContact?.phone ?? null}
                  isConnected={!!orgZapSignSettings?.zapsign_api_token}
                />
                <ContractReadingSection contractId={contract.id} docs={readableDocs} isAdmin={currentProfile?.role === 'admin'} reading={readingResult} readingMeta={lastReading ? { created_at: lastReading.created_at, file_name: lastReading.file_name, status: lastReading.status, error: lastReading.error } : null} checks={readingChecks} hasAiKey={!!aiKeyInfo.key} />
              </div>
            ),
          }] : []),
          ...(isCurrentlyInContractsPipeline ? [{
            id: 'faturamento',
            label: 'Faturamento',
            content: <BillingSection contractId={contract.id} billingType={contract.billing_type} contractValue={Number((contract as any).monthly_value) || 0} records={(billingRecords ?? []) as any} isAdmin={currentProfile?.role === 'admin'} />,
          }] : []),
          ...(!isCurrentlyInSalesPipeline ? [{
            id: 'pesquisas',
            label: 'Pesquisas',
            content: (
              <div className="space-y-6">
                <CustomSurveysSection
                  contractId={contract.id}
                  templates={availableTemplates}
                  allTemplates={allSurveyTemplates ?? []}
                  sentSurveys={sentCustomSurveys ?? []}
                  linkBase={linkBase}
                  isAdmin={currentProfile?.role === 'admin'}
                />
              </div>
            ),
          }] : []),
          {
            id: 'atendimento',
            label: 'Atendimento',
            content: <ContractTicketsSection contractId={contract.id} clientName={contract.client_name} />,
          },
          {
            id: 'email',
            label: 'E-mail',
            content: (
              <ContractEmailSection
                contractId={contract.id}
                hasGmailConnected={!!connectedEmailAccount}
                templates={emailTemplates ?? []}
                defaultToEmail={linkedContact?.email ?? null}
                emailLog={contractEmails ?? []}
                inboundEmailAddress={inboundEmailAddress}
              />
            ),
          },
          {
            id: 'proposta',
            label: '📄 Proposta',
            content: (() => {
              const companyCnpj2 = (linkedCompany as any)?.cnpj
                ?? contract.client_name?.match(/^\d{2}\.\d{3}\.\d{3}[\/\d.\-]+/)?.[0]?.replace(/\D/g, '')
                ?? null
              const nature2 = (contract as any).nature ?? null
              const priceParams = new URLSearchParams({
                company: contract.client_name ?? '',
                ...(companyCnpj2 ? { cnpj: companyCnpj2 } : {}),
                ...(nature2 === 'eng_clinica' ? { type: 'clinica' } : nature2 === 'eng_hospitalar' ? { type: 'hospitalar' } : {}),
                project: contract.title || contract.process_number || '',
                crm_id: contract.id,
              })
              const priceUrl = `https://orbis-price.vercel.app/?${priceParams.toString()}`
              return (
                <ProposalTab
                  contractId={contract.id}
                  proposals={proposals ?? []}
                  priceUrl={priceUrl}
                  currentUserRole={currentProfile?.role ?? 'member'}
                  currentUserName={currentProfile?.id ? (allProfilesById.get(currentProfile.id)?.full_name ?? 'Usuário') : 'Usuário'}
                  catalogItems={catalogItems ?? []}
                />
              )
            })(),
          },
          ...(isCurrentlyInContractsPipeline ? [{
            id: 'carteira',
            label: '📋 Dados da Carteira',
            content: (
              <PortfolioFieldsForm
                contractId={contract.id}
                companyCity={(linkedCompany as any)?.city ?? null}
                companyState={(linkedCompany as any)?.state ?? null}
                wonDate={openRun?.started_at ? openRun.started_at.slice(0, 10) : null}
                abcConfig={await (async () => {
                  const { data: cfgs } = await supabase.from('abc_config').select('*')
                  return {
                    clinica: cfgs?.find((c: any) => c.nature === 'eng_clinica') ?? null,
                    hospitalar: cfgs?.find((c: any) => c.nature === 'eng_hospitalar') ?? null,
                  }
                })()}
                activeFields={await (async () => {
                  const { data: orgSettings, error: orgErr } = await supabase
                    .from('organization_settings').select('carteira_active_fields').eq('tenant_id', await resolveTenantId()).maybeSingle()
                  console.log('[carteira] activeFields from DB:', orgSettings?.carteira_active_fields, 'error:', orgErr?.message)
                  return orgSettings?.carteira_active_fields ? (orgSettings.carteira_active_fields as string[]) : null
                })()}
                initial={{
                  contract_number: (contract as any).contract_number ?? null,
                  sankhya_code: (contract as any).sankhya_code ?? null,
                  cnpj_billing: (contract as any).cnpj_billing ?? null,
                  contract_type: (contract as any).contract_type ?? null,
                  monthly_value: Number(displayRun?.value) > 0 ? Number(displayRun.value) : ((contract as any).monthly_value ?? null),
                  validity_months: (contract as any).validity_months ?? null,
                  valid_until: (contract as any).valid_until ?? null,
                  engineer_name: (contract as any).engineer_name ?? null,
                  coordinator_name: (contract as any).coordinator_name ?? null,
                  abc_curve: (contract as any).abc_curve ?? null,
                  sphere: (contract as any).sphere ?? null,
                  segment: (contract as any).segment ?? null,
                  economic_group: (contract as any).economic_group ?? null,
                  nature: (contract as any).nature ?? null,
                  region: (contract as any).region ?? null,
                  uf: (contract as any).uf ?? null,
                  score_billing: (contract as any).score_billing ?? null,
                  score_visit: (contract as any).score_visit ?? null,
                  score_loyalty: (contract as any).score_loyalty ?? null,
                  score_weight: (contract as any).score_weight ?? null,
                  has_measurement: (contract as any).has_measurement ?? false,
                  has_audit: (contract as any).has_audit ?? false,
                  has_parts: (contract as any).has_parts ?? false,
                  team_type: (contract as any).team_type ?? null,
                  municipality: (contract as any).municipality ?? null,
                  state: (contract as any).state ?? null,
                  internal_notes: (contract as any).internal_notes ?? null,
                }}
                contractNature={(contract as any).nature ?? null}
                tags={allTags ?? []}
                currentTagId={(currentContractTags ?? [])[0]?.tag_id ?? null}
              />
            ),
          }] : []),
          {
            id: 'implantacao',
            label: '🚀 Implantação',
            content: (
              <ImplementationTab
                contractId={id}
                contractTags={(currentContractTags ?? []).map((ct: any) => ct.tags?.name ?? '')}
                schedule={implementationSchedule as any}
                templates={implementationTemplates}
                users={(allProfiles ?? []) as any}
                currentUserId={currentProfile?.id ?? ''}
                currentUserRole={currentProfile?.role ?? 'viewer'}
              />
            ),
          },
        ]}
      />
    </div>
  )
}
