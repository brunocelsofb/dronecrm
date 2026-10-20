'use server'

import { getCompanySettings } from '@/lib/actions/company-settings'
import { matchSegment, segmentValue } from '@/lib/companies/settings'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { isCurrentUserAdmin } from '@/lib/auth/role'
import { resolvePublicTenantId, resolveTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { readTracking } from '@/lib/marketing/tracking'
import { ingestLead } from '@/lib/leads/ingest'

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

  // Cadastro pela equipe (Leads → + Novo lead): é prospecção do comercial (outbound)
  let internalUser: string | null = null
  if (formData.get('interno') === '1') {
    const { data: { user } } = await (await createClient()).auth.getUser()
    internalUser = user?.id ?? null
  }
  const tenantId = internalUser ? await resolveTenantId() : await resolvePublicTenantId((formData.get('empresa') as string) || null)
  const r = await ingestLead({
    tenantId, name, email, phone, company_name, cnpj, message, source,
    tracking: readTracking(k => formData.get(k)),
    campaignId: (formData.get('campaign_id') as string) || null,
    ...(internalUser ? { entryType: 'outbound' as const, handedOffBy: internalUser, assignedTo: internalUser } : { entryType: 'inbound' as const }),
  })
  if (r.error || !r.leadId) return { error: r.error ?? 'Não foi possível registrar o contato.' }
  const data = { id: r.leadId }

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
    companySegment?: string | null      // segmento da empresa (obrigatório quando a empresa é criada aqui)
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
  // Segmento (lista da empresa/tenant): obrigatório para criar a empresa
  const { segments } = await getCompanySettings()
  const seg = matchSegment(options.companySegment ?? '', segments)
  if (!companyId && lead.company_name) {
    if (!seg) return { error: 'Escolha o segmento da empresa.' }
    const { data } = await supabase.from('companies').insert({ name: lead.company_name, cnpj: lead.cnpj?.replace(/\D/g,'') ?? null, status: 'prospect', segment: segmentValue(seg), owner_id: options.responsibleId }).select('id').single()
    companyId = data?.id ?? null
  } else if (companyId && seg) {
    // Empresa já existente sem segmento: preenche
    await supabase.from('companies').update({ segment: segmentValue(seg) }).eq('id', companyId).is('segment', null)
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

// ── Inbound: o marketing qualifica e passa ao comercial ──────────────────────
// O lead sai da fila do marketing e aparece na aba Leads do comercial, com o
// responsável escolhido avisado. "Devolver ao marketing": ainda não está pronto
// (volta para nutrição, com o motivo no histórico).
export async function passLeadToCommercial(leadId: string, assignTo: string | null, note: string): Promise<ActionState> {
  const { getUserAccess } = await import('@/lib/auth/access')
  const me = await getUserAccess()
  if (!me || !(me.features.includes('marketing') || me.isAdmin)) return { error: 'Só o marketing (ou o Admin) passa leads ao comercial.' }
  const db = await createScopedAdmin()
  const { data: lead } = await db.from('leads').select('id, name, company_name, entry_type, handed_off_at, status').eq('id', leadId).maybeSingle()
  if (!lead) return { error: 'Lead não encontrado.' }
  if (lead.handed_off_at) return { error: 'Este lead já está com o comercial.' }
  if (lead.status === 'descartado') return { error: 'Lead descartado: mude a situação antes de passar.' }
  if (assignTo) {
    const { data: p } = await db.from('profiles').select('id').eq('id', assignTo).maybeSingle()
    if (!p) return { error: 'Responsável inválido.' }
  }
  const now = new Date().toISOString()
  const { error } = await db.from('leads').update({
    handed_off_at: now, handed_off_by: me.userId, updated_at: now,
    ...(assignTo ? { assigned_to: assignTo } : {}),
    ...(lead.status === 'novo' || lead.status === 'em_qualificacao' ? { status: 'qualificado' } : {}),
  }).eq('id', leadId)
  if (error) return { error: error.message }
  await db.from('lead_activities').insert({ lead_id: leadId, user_id: me.userId, type: 'system', content: `➡️ Passado ao comercial pelo marketing.${note.trim() ? ` Observação: ${note.trim().slice(0, 500)}` : ''}` })
  // Aviso: responsável escolhido; senão, o time comercial
  let to: { id: string }[] = assignTo ? [{ id: assignTo }] : []
  if (!to.length) to = (await db.from('profiles').select('id').or('department.eq.comercial,access_profile.in.(hunter,gestor)')).data ?? []
  if (to.length) await db.from('notifications').insert(to.map(p => ({ user_id: p.id, message: `Lead qualificado pelo marketing: ${lead.name}${lead.company_name ? ` (${lead.company_name})` : ''}. Abra em Leads e faça o primeiro contato.` })))
  revalidatePath('/leads'); revalidatePath('/marketing'); revalidatePath(`/leads/${leadId}`)
  return {}
}

export async function returnLeadToMarketing(leadId: string, reason: string): Promise<ActionState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Usuário não autenticado.' }
  if (!reason.trim()) return { error: 'Diga o motivo (ajuda o marketing a nutrir o lead).' }
  const db = await createScopedAdmin()
  const { data: lead } = await db.from('leads').select('id, name, entry_type, status').eq('id', leadId).maybeSingle()
  if (!lead) return { error: 'Lead não encontrado.' }
  if (lead.entry_type !== 'inbound') return { error: 'Só lead inbound volta para o marketing.' }
  if (lead.status === 'convertido') return { error: 'Lead já convertido.' }
  const { error } = await db.from('leads').update({ handed_off_at: null, handed_off_by: null, status: 'em_qualificacao', updated_at: new Date().toISOString() }).eq('id', leadId)
  if (error) return { error: error.message }
  await db.from('lead_activities').insert({ lead_id: leadId, user_id: user.id, type: 'system', content: `↩️ Devolvido ao marketing: ${reason.trim().slice(0, 500)}` })
  const { data: mk } = await db.from('profiles').select('id').or('department.eq.marketing,access_profile.eq.marketing')
  if (mk?.length) await db.from('notifications').insert(mk.map(p => ({ user_id: p.id, message: `Lead devolvido pelo comercial: ${lead.name}. Motivo: ${reason.trim().slice(0, 120)}` })))
  revalidatePath('/leads'); revalidatePath('/marketing'); revalidatePath(`/leads/${leadId}`)
  return {}
}
