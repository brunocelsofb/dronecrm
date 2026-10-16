'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { calculateLeadScore } from '@/lib/utils/lead-score'
import { isCurrentUserAdmin } from '@/lib/auth/role'
import { resolvePublicTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { readTracking } from '@/lib/marketing/tracking'

export type ActionState = { error?: string }

// Criação de lead — usado tanto pelo formulário PÚBLICO de captação
// quanto pelo cadastro manual da equipe. Sem exigir login (o público não tem
// conta). A empresa vem do ?empresa=<slug> (ou do usuário logado) e TUDO depois
// usa essa empresa — antes, para visitante, as etapas seguintes caíam na
// empresa padrão. Grava com o cliente admin preso à empresa: o visitante não
// pode ler leads, e o insert com retorno do id falhava no RLS.
export async function createLead(formData: FormData): Promise<ActionState & { leadId?: string }> {
  // Campo escondido "website": robôs preenchem, pessoas não veem — finge sucesso
  if (((formData.get('website') as string) ?? '').trim()) return {}

  const name = (formData.get('name') as string)?.trim()
  const email = (formData.get('email') as string)?.trim() || null
  const phone = (formData.get('phone') as string)?.trim() || null
  const company_name = (formData.get('company_name') as string)?.trim() || null
  const cnpj = (formData.get('cnpj') as string)?.trim() || null
  const message = (formData.get('message') as string)?.trim() || null
  const source = ((formData.get('source') as string) || 'manual').slice(0, 60)

  if (!name) return { error: 'Nome é obrigatório.' }
  if (!company_name) return { error: 'Empresa é obrigatória.' }
  if (!cnpj) return { error: 'CNPJ é obrigatório.' }

  const tenantId = await resolvePublicTenantId((formData.get('empresa') as string) || null)
  const db = await createScopedAdmin(tenantId)

  // Origem: UTM / gclid / fbclid / página. Campanha pelo código do link (utm_campaign)
  const tracking = readTracking(k => formData.get(k))
  let campaignId: string | null = null
  if (tracking.utm_campaign) {
    const { data: camp } = await db.from('marketing_campaigns').select('id').eq('utm_campaign', tracking.utm_campaign).maybeSingle()
    campaignId = camp?.id ?? null
  }
  const manualCampaign = (formData.get('campaign_id') as string) || null
  if (!campaignId && manualCampaign) {
    const { data: camp } = await db.from('marketing_campaigns').select('id').eq('id', manualCampaign).maybeSingle()
    campaignId = camp?.id ?? null
  }

  // Busca regras dinâmicas do banco (obs.: hoje esta tabela não tem empresa — é a mesma para todas)
  const { data: rules } = await db.from('lead_scoring_rules').select('criterion_key, label, points, is_active').eq('is_active', true)
  const { score } = calculateLeadScore({ email, phone, company_name, message, source }, rules ?? undefined)

  const { data, error } = await db
    .from('leads')
    .insert({ name, email, phone, company_name, cnpj, message, source, score, tenant_id: tenantId, campaign_id: campaignId, ...tracking })
    .select('id')
    .single()

  if (error || !data) return { error: error?.message ?? 'Não foi possível registrar o contato.' }

  // Tenta vincular automaticamente a uma empresa existente por CNPJ
  if (cnpj) {
    const cnpjDigits = cnpj.replace(/\D/g, '')
    const { data: existingCompany } = await db
      .from('companies').select('id')
      .or(`cnpj.eq.${cnpjDigits},cnpj.eq.${cnpj.replace(/[^\d./-]/g, '')}`)
      .limit(1).maybeSingle()
    if (existingCompany) {
      // Registra atividade na empresa sobre o novo lead
      await db.from('activities').insert({
        company_id: existingCompany.id,
        type: 'note',
        content: `📥 Novo lead recebido: "${name}" (${source ?? 'formulário'})`,
      })
    }
  }

  // Se essa pessoa tinha mandado mensagem de WhatsApp antes de
  // preencher o formulário (fluxo de triagem), vincula a conversa a
  // esse lead agora — fecha o ciclo, o histórico não fica solto.
  const cleanPhone = (phone ?? '').replace(/\D/g, '')
  if (cleanPhone.length >= 8) {
    await db.from('contract_whatsapp_messages').update({ lead_id: data.id, unlinked_sender_name: null }).ilike('phone', `%${cleanPhone.slice(-8)}%`).is('contract_id', null)
    await db.from('whatsapp_capture_prompts').update({ lead_id: data.id }).ilike('phone', `%${cleanPhone.slice(-8)}%`)
  }

  // Avisa o time comercial (e o marketing) de um lead novo
  const { data: commercialProfiles } = await db.from('profiles').select('id').eq('tenant_id', tenantId).in('department', ['comercial', 'marketing'])
  if (commercialProfiles && commercialProfiles.length > 0) {
    await db.from('notifications').insert(
      commercialProfiles.map((p) => ({ user_id: p.id, message: `Novo lead: ${name}${company_name ? ` (${company_name})` : ''}.` }))
    )
  }

  revalidatePath('/leads')
  revalidatePath('/marketing')
  return { leadId: data.id }
}

export async function updateLeadStatus(leadId: string, status: string): Promise<ActionState> {
  const supabase = await createClient()
  const { error } = await supabase.from('leads').update({ status, updated_at: new Date().toISOString() }).eq('id', leadId)
  if (error) return { error: error.message }
  revalidatePath('/leads')
  revalidatePath(`/leads/${leadId}`)
  return {}
}

export async function assignLead(leadId: string, userId: string): Promise<ActionState> {
  const supabase = await createClient()
  const { error } = await supabase.from('leads').update({ assigned_to: userId, updated_at: new Date().toISOString() }).eq('id', leadId)
  if (error) return { error: error.message }
  revalidatePath(`/leads/${leadId}`)
  return {}
}

export async function addLeadNote(leadId: string, content: string): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Usuário não autenticado.' }
  if (!content.trim()) return { error: 'Escreva algo na nota.' }

  const { error } = await supabase.from('lead_activities').insert({ lead_id: leadId, user_id: user.id, type: 'note', content })
  if (error) return { error: error.message }
  revalidatePath(`/leads/${leadId}`)
  return {}
}

export async function deleteLead(leadId: string): Promise<{ error?: string }> {
  const isAdmin = await isCurrentUserAdmin()
  if (!isAdmin) return { error: 'Só administradores podem excluir leads.' }
  const supabase = (await createScopedAdmin())
  // Desvincula o lead de qualquer contrato antes de deletar
  await supabase.from('contracts').update({ contact_id: null }).eq('contact_id', leadId)
  const { error } = await supabase.from('leads').delete().eq('id', leadId)
  if (error) return { error: error.message }
  revalidatePath('/leads')
  return {}
}

// Converte um lead qualificado numa OPORTUNIDADE de verdade: cria (ou
// reaproveita) a empresa, o contato, e o contrato — e já entra no
// funil de Novos Negócios (o funil de vendas padrão).
export async function convertLeadToOpportunity(leadId: string): Promise<ActionState & { contractId?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Usuário não autenticado.' }

  const { data: lead } = await supabase.from('leads').select('*').eq('id', leadId).single()
  if (!lead) return { error: 'Lead não encontrado.' }
  if (lead.status === 'convertido') return { error: 'Este lead já foi convertido.' }

  let companyId: string | null = null

  // 1. Tenta vincular por CNPJ (mais confiável que nome)
  if (lead.cnpj) {
    const cnpjDigits = lead.cnpj.replace(/\D/g, '')
    const { data: byeCnpj } = await supabase
      .from('companies')
      .select('id')
      .or(`cnpj.eq.${cnpjDigits},cnpj.eq.${lead.cnpj}`)
      .maybeSingle()
    if (byeCnpj) companyId = byeCnpj.id
  }

  // 2. Fallback: busca por nome da empresa
  if (!companyId && lead.company_name) {
    const { data: byName } = await supabase
      .from('companies')
      .select('id')
      .ilike('name', lead.company_name.trim())
      .maybeSingle()
    if (byName) companyId = byName.id
  }

  // 3. Cria a empresa se não encontrou
  if (!companyId && lead.company_name) {
    const { data: newCompany } = await supabase
      .from('companies')
      .insert({
        name: lead.company_name,
        cnpj: lead.cnpj ? lead.cnpj.replace(/\D/g, '') : null,
        status: 'prospect',
        owner_id: user.id,
      })
      .select('id')
      .single()
    companyId = newCompany?.id ?? null
  }

  // Registra atividade na empresa sobre o lead convertido
  if (companyId) {
    await supabase.from('activities').insert({
      company_id: companyId,
      user_id: user.id,
      type: 'note',
      content: `🔗 Lead "${lead.name}" convertido em oportunidade (origem: ${lead.source ?? 'formulário'}).`,
    })
  }

  let contactId: string | null = null
  if (companyId) {
    // Verifica se já existe contato com mesmo e-mail
    if (lead.email) {
      const { data: existingContact } = await supabase
        .from('contacts')
        .select('id')
        .eq('company_id', companyId)
        .eq('email', lead.email)
        .maybeSingle()
      if (existingContact) contactId = existingContact.id
    }

    if (!contactId) {
      const { data: newContact } = await supabase
        .from('contacts')
        .insert({ company_id: companyId, name: lead.name, email: lead.email, phone: lead.phone, is_primary: false })
        .select('id')
        .single()
      contactId = newContact?.id ?? null
    }
  }

  const { data: salesPipeline } = await supabase.from('pipelines').select('id').eq('type', 'vendas').eq('is_default', true).maybeSingle()
  const { data: fallbackPipeline } = salesPipeline
    ? { data: salesPipeline }
    : await supabase.from('pipelines').select('id').eq('type', 'vendas').limit(1).maybeSingle()

  if (!fallbackPipeline) return { error: 'Nenhum funil de vendas encontrado pra converter o lead.' }

  const { data: firstStage } = await supabase
    .from('stages')
    .select('id')
    .eq('pipeline_id', fallbackPipeline.id)
    .order('order_index', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!firstStage) return { error: 'O funil de vendas não tem etapas configuradas.' }

  const { data: contract, error: contractError } = await supabase
    .from('contracts')
    .insert({
      process_number: `LEAD-${Date.now()}`,
      title: lead.company_name ?? lead.name,
      client_name: lead.company_name ?? lead.name,
      description: lead.message,
      company_id: companyId,
      contact_id: contactId,
      owner_id: user.id,
      current_assignee_id: user.id,
      lead_id: lead.id,
      campaign_id: lead.campaign_id ?? null,
      lead_source: lead.source ?? null,
    })
    .select()
    .single()

  if (contractError || !contract) return { error: contractError?.message ?? 'Falha ao criar a oportunidade.' }

  const now = new Date().toISOString()
  const { data: run } = await supabase
    .from('pipeline_runs')
    .insert({
      contract_id: contract.id,
      pipeline_id: fallbackPipeline.id,
      stage_id: firstStage.id,
      stage_entered_at: now,
      created_by: user.id,
    })
    .select()
    .single()

  if (run) {
    await supabase.from('stage_history').insert({ pipeline_run_id: run.id, stage_id: firstStage.id, entered_at: now, changed_by: user.id })
  }

  await supabase.from('leads').update({ status: 'convertido', converted_contract_id: contract.id, updated_at: now }).eq('id', leadId)

  // Migra o histórico de WhatsApp do lead pro contrato novo — a
  // conversa não pode ficar pra trás só porque virou oportunidade.
  await supabase.from('contract_whatsapp_messages').update({ contract_id: contract.id, lead_id: null }).eq('lead_id', leadId)

  await supabase.from('lead_activities').insert({
    lead_id: leadId,
    user_id: user.id,
    type: 'system',
    content: 'Lead convertido em oportunidade.',
  })

  await supabase.from('activities').insert({
    contract_id: contract.id,
    user_id: user.id,
    type: 'system',
    content: `Oportunidade criada a partir do lead "${lead.name}" (origem: ${lead.source ?? 'manual'}).`,
  })

  revalidatePath('/leads')
  revalidatePath('/pipeline')
  return { contractId: contract.id }
}

export async function convertLeadWithOptions(
  leadId: string,
  options: {
    pipelineId: string
    stageId: string
    responsibleId: string
    estimatedValue?: number | null
  }
): Promise<{ error?: string; contractId?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const { data: lead } = await supabase.from('leads').select('*').eq('id', leadId).single()
  if (!lead) return { error: 'Lead não encontrado.' }
  if (lead.status === 'convertido') return { error: 'Lead já foi convertido.' }

  // Empresa
  let companyId: string | null = null
  if (lead.cnpj) {
    const digits = lead.cnpj.replace(/\D/g, '')
    const { data } = await supabase.from('companies').select('id').or(`cnpj.eq.${digits},cnpj.eq.${lead.cnpj}`).maybeSingle()
    if (data) companyId = data.id
  }
  if (!companyId && lead.company_name) {
    const { data } = await supabase.from('companies').select('id').ilike('name', lead.company_name.trim()).maybeSingle()
    if (data) companyId = data.id
  }
  if (!companyId && lead.company_name) {
    const { data } = await supabase.from('companies').insert({ name: lead.company_name, cnpj: lead.cnpj?.replace(/\D/g,'') ?? null, status: 'prospect', owner_id: options.responsibleId }).select('id').single()
    companyId = data?.id ?? null
  }

  // Contato
  let contactId: string | null = null
  if (companyId && lead.email) {
    const { data } = await supabase.from('contacts').select('id').eq('company_id', companyId).eq('email', lead.email).maybeSingle()
    contactId = data?.id ?? null
  }
  if (!contactId && companyId) {
    const { data } = await supabase.from('contacts').insert({ company_id: companyId, name: lead.name, email: lead.email, phone: lead.phone, is_primary: false }).select('id').single()
    contactId = data?.id ?? null
  }

  // Etapa precisa ser do funil escolhido
  const { data: stage } = await supabase.from('stages').select('id, pipeline_id').eq('id', options.stageId).maybeSingle()
  if (!stage || stage.pipeline_id !== options.pipelineId) return { error: 'Etapa inválida para o funil escolhido.' }
  const { data: responsible } = await supabase.from('profiles').select('id').eq('id', options.responsibleId).maybeSingle()
  if (!responsible) return { error: 'Responsável inválido.' }

  // Número da oportunidade: sequência da empresa (Configurações → Numeração), senão provisório
  let processNumber = `OPP-${Date.now()}`
  try {
    const { data: seq } = await supabase.rpc('next_opportunity_number' as never)
    if (seq) processNumber = seq as unknown as string
  } catch { /* sem sequência: usa o provisório */ }

  // Contrato/Oportunidade — leva a origem do lead (campanha) até o ganho e o faturado
  const { data: contract, error } = await supabase.from('contracts').insert({
    process_number: processNumber,
    title: lead.company_name ?? lead.name,
    client_name: lead.company_name ?? lead.name,
    description: lead.message,
    company_id: companyId,
    contact_id: contactId,
    owner_id: options.responsibleId,
    current_assignee_id: options.responsibleId,
    lead_id: leadId,
    campaign_id: lead.campaign_id ?? null,
    lead_source: lead.source ?? null,
  }).select('id').single()

  if (error || !contract) return { error: error?.message ?? 'Erro ao criar oportunidade.' }

  // Entrada no funil
  const now = new Date().toISOString()
  const { data: run, error: runError } = await supabase.from('pipeline_runs').insert({
    contract_id: contract.id,
    pipeline_id: options.pipelineId,
    stage_id: options.stageId,
    stage_entered_at: now,
    status: 'open',
    value: options.estimatedValue ?? null,
    created_by: user.id,
  }).select('id').single()
  if (runError || !run) {
    await supabase.from('contracts').delete().eq('id', contract.id)
    return { error: `Falha ao colocar a oportunidade no funil: ${runError?.message ?? 'erro desconhecido'}` }
  }
  await supabase.from('stage_history').insert({ pipeline_run_id: run.id, stage_id: options.stageId, entered_at: now, changed_by: user.id })

  // Atualiza status do lead
  await supabase.from('leads').update({
    status: 'convertido',
    converted_contract_id: contract.id,
    updated_at: now,
  }).eq('id', leadId)

  // Histórico de WhatsApp e linha do tempo acompanham a oportunidade
  await supabase.from('contract_whatsapp_messages').update({ contract_id: contract.id, lead_id: null }).eq('lead_id', leadId)
  await supabase.from('lead_activities').insert({ lead_id: leadId, user_id: user.id, type: 'system', content: 'Lead convertido em oportunidade.' })
  await supabase.from('activities').insert({
    contract_id: contract.id, user_id: user.id, type: 'system',
    content: `Oportunidade criada a partir do lead "${lead.name}" (origem: ${lead.source ?? 'manual'}).`,
  })

  // Atividade na empresa
  if (companyId) {
    await supabase.from('activities').insert({
      company_id: companyId, user_id: user.id, type: 'note',
      content: `✅ Lead "${lead.name}" convertido em oportunidade manualmente.`,
    })
  }

  revalidatePath('/leads')
  revalidatePath(`/leads/${leadId}`)
  revalidatePath('/pipeline')
  return { contractId: contract.id }
}
