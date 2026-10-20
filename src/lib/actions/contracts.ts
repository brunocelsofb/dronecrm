'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isCurrentUserAdmin } from '@/lib/auth/role'
import { contractSchema } from '@/lib/validations/contract'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

export type ActionState = {
  error?: string
  fieldErrors?: Record<string, string[]>
}

export async function createContract(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Usuário não autenticado.' }
  }

  // ------------------------------------------------------------
  // 1. Resolve a EMPRESA (existente, escolhida via CNPJ já
  //    cadastrado, ou nova, criada aqui mesmo)
  // ------------------------------------------------------------
  const existingCompanyId = (formData.get('existing_company_id') as string) || null
  let companyId: string
  let companyName: string

  if (existingCompanyId) {
    companyId = existingCompanyId
    const { data: company } = await supabase
      .from('companies')
      .select('name')
      .eq('id', companyId)
      .single()
    companyName = company?.name ?? ''
  } else {
    const newCompanyCnpj = (formData.get('new_company_cnpj') as string) || null
    const newCompanyName = (formData.get('new_company_name') as string)?.trim()
    const newCompanyTradeName = (formData.get('new_company_trade_name') as string) || null
    const newCompanySegment = ((formData.get('new_company_segment') as string) || '').trim()

    if (newCompanyName && !newCompanySegment) {
      return { error: 'Escolha o segmento da empresa nova.' }
    }
    if (!newCompanyName) {
      return {
        error: 'Empresa é obrigatória: informe o CNPJ e clique em "Verificar" antes de salvar.',
      }
    }

    const { data: newCompany, error: companyError } = await supabase
      .from('companies')
      .insert({
        name: newCompanyName,
        trade_name: newCompanyTradeName,
        cnpj: newCompanyCnpj,
        segment: JSON.stringify([newCompanySegment]),
        owner_id: user.id,
      })
      .select()
      .single()

    if (companyError || !newCompany) {
      if (companyError?.code === '23505') {
        return { error: 'Já existe uma empresa com esse CNPJ. Clique em "Verificar" de novo para encontrá-la e usá-la.' }
      }
      return { error: `Falha ao criar empresa: ${companyError?.message}` }
    }

    companyId = newCompany.id
    companyName = newCompany.name
  }

  // ------------------------------------------------------------
  // 2. Resolve o CONTATO (existente, da empresa escolhida, ou
  //    novo, criado junto)
  // ------------------------------------------------------------
  const existingContactId = (formData.get('existing_contact_id') as string) || null
  let contactId: string

  if (existingContactId) {
    contactId = existingContactId
  } else {
    const newContactName = (formData.get('new_contact_name') as string)?.trim()

    if (!newContactName) {
      // Empresa já foi criada acima (se era nova) — não desfazemos isso
      // aqui; o usuário pode reaproveitar essa empresa ao tentar de novo.
      return { error: 'Contato responsável é obrigatório: preencha ao menos o nome.' }
    }

    const newContactRole = (formData.get('new_contact_role') as string) || null
    const newContactEmail = (formData.get('new_contact_email') as string) || null
    const newContactPhone = (formData.get('new_contact_phone') as string) || null

    const { data: newContact, error: contactError } = await supabase
      .from('contacts')
      .insert({
        company_id: companyId,
        name: newContactName,
        role: newContactRole,
        email: newContactEmail,
        phone: newContactPhone,
      })
      .select()
      .single()

    if (contactError || !newContact) {
      return { error: `Falha ao criar contato: ${contactError?.message}` }
    }

    contactId = newContact.id
  }

  // ------------------------------------------------------------
  // 3. Segue o fluxo original de criação do contrato, agora com
  //    empresa e contato já resolvidos
  // ------------------------------------------------------------
  // process_number: tenta gerar número sequencial via função SQL,
  // cai para OPP-timestamp se a tabela ainda não existir
  let autoProcessNumber = `OPP-${Date.now()}`
  try {
    const { data: seqData } = await supabase.rpc('next_opportunity_number' as any)
    if (seqData) autoProcessNumber = seqData as string
  } catch { /* função não existe ainda — usa fallback */ }

  const raw = {
    process_number: (formData.get('process_number') as string)?.trim() || autoProcessNumber,
    title: formData.get('title') as string,
    client_name: companyName,
    value: Number(formData.get('value') || 0),
    stage_id: formData.get('stage_id') as string,
    description: (formData.get('description') as string) || undefined,
    expected_close_date: (formData.get('expected_close_date') as string) || undefined,
  }

  const parsed = contractSchema.safeParse(raw)

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors }
  }

  const { stage_id, value, expected_close_date, company_id: _ignored, ...contractFields } = parsed.data

  const { data: stage, error: stageError } = await supabase
    .from('stages')
    .select('id, pipeline_id')
    .eq('id', stage_id)
    .single()

  if (stageError || !stage) {
    return { error: 'Etapa selecionada é inválida.' }
  }

  // Cadastro direto no funil Contratos (gestão de contratos): exige o
  // consultor responsável pela conta — no fluxo normal ele é definido ao
  // dar ganho em Mercado Privado/Público.
  const { data: stagePipeline } = await supabase
    .from('pipelines').select('type').eq('id', stage.pipeline_id).maybeSingle()
  let ownerId = user.id
  if (stagePipeline?.type === 'gestao_contratos') {
    const accountOwnerId = (formData.get('account_owner_id') as string) || ''
    if (!accountOwnerId) {
      return { error: 'Indique o consultor responsável pela conta.' }
    }
    const { data: ownerProfile } = await supabase
      .from('profiles').select('id').eq('id', accountOwnerId).maybeSingle()
    if (!ownerProfile) return { error: 'Consultor responsável inválido.' }
    ownerId = accountOwnerId
  }

  const { data: contract, error: contractError } = await supabase
    .from('contracts')
    .insert({
      ...contractFields,
      company_id: companyId,
      contact_id: contactId,
      owner_id: ownerId,
      current_assignee_id: user.id,
      valid_from: (formData.get('valid_from') as string) || null,
      valid_until: (formData.get('valid_until') as string) || null,
      auto_renewal: formData.get('auto_renewal') === 'on',
    })
    .select()
    .single()

  if (contractError) {
    if (contractError.code === '23505') {
      return { error: 'Já existe um contrato com esse Número do Processo.' }
    }
    return { error: contractError.message }
  }

  const now = new Date().toISOString()

  const { data: run, error: runError } = await supabase
    .from('pipeline_runs')
    .insert({
      contract_id: contract.id,
      pipeline_id: stage.pipeline_id,
      stage_id: stage.id,
      stage_entered_at: now,
      value: value ?? 0,
      expected_close_date: expected_close_date || null,
      created_by: user.id,
    })
    .select()
    .single()

  if (runError || !run) {
    await supabase.from('contracts').delete().eq('id', contract.id)
    return { error: 'Falha ao iniciar o contrato no funil. Tente novamente.' }
  }

  // Salva tag da oportunidade
  const tagId = (formData.get('tag_id') as string) || null
  if (tagId) {
    await supabase.from('contract_tags').insert({ contract_id: contract.id, tag_id: tagId })
  }

  // Salva classificação e segmento no contrato
  const classification = (formData.get('classification') as string) || null
  const segment = (formData.get('segment') as string) || null
  if (classification || segment) {
    const patch: Record<string, string | null> = {}
    if (classification) patch.team_type = classification
    if (segment) patch.segment = segment
    await supabase.from('contracts').update(patch).eq('id', contract.id)
  }

  await supabase.from('stage_history').insert({
    pipeline_run_id: run.id,
    stage_id: stage.id,
    entered_at: now,
    changed_by: user.id,
  })

  // Busca o tipo do pipeline para usar o texto correto
  const { data: pipelineForMsg } = await supabase
    .from('pipelines').select('type').eq('id', stage.pipeline_id).maybeSingle()
  const isVendasCadastro = pipelineForMsg?.type === 'vendas'

  await supabase.from('activities').insert({
    contract_id: contract.id,
    pipeline_run_id: run.id,
    user_id: user.id,
    type: 'system',
    content: isVendasCadastro ? 'Oportunidade cadastrada.' : 'Contrato cadastrado.',
  })

  revalidatePath('/contracts')
  redirect('/contracts')
}

// Edita os dados de identidade do contrato (contracts) e, se houver uma
// pipeline_run aberta, também atualiza valor e previsão de fechamento nela.
// Não mexe em etapa/pipeline/empresa/contato aqui — isso continua sendo
// feito só pela barra de etapas ou por telas específicas, para manter o
// histórico consistente.
export async function updateContract(
  contractId: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Usuário não autenticado.' }
  }

  const process_number = formData.get('process_number') as string
  const title = formData.get('title') as string
  const client_name = formData.get('client_name') as string
  const description = (formData.get('description') as string) || null
  const value = Number(formData.get('value') || 0)
  const expected_close_date = (formData.get('expected_close_date') as string) || null
  const valid_from = (formData.get('valid_from') as string) || null
  const valid_until = (formData.get('valid_until') as string) || null
  const auto_renewal = formData.get('auto_renewal') === 'on'

  if (!process_number?.trim()) {
    return { fieldErrors: { process_number: ['Número do processo é obrigatório'] } }
  }

  const { error: contractError } = await supabase
    .from('contracts')
    .update({
      process_number,
      title,
      client_name,
      description,
      valid_from,
      valid_until,
      auto_renewal,
      updated_at: new Date().toISOString(),
    })
    .eq('id', contractId)

  if (contractError) {
    if (contractError.code === '23505') {
      return { error: 'Já existe outro contrato com esse Número do Processo.' }
    }
    return { error: contractError.message }
  }

  const { data: openRun } = await supabase
    .from('pipeline_runs')
    .select('id')
    .eq('contract_id', contractId)
    .eq('status', 'open')
    .maybeSingle()

  if (openRun) {
    await supabase
      .from('pipeline_runs')
      .update({ value, expected_close_date })
      .eq('id', openRun.id)
  }

  await supabase.from('activities').insert({
    contract_id: contractId,
    user_id: user.id,
    type: 'system',
    content: 'Dados da oportunidade editados.',
  })

  revalidatePath(`/contracts/${contractId}`)
  revalidatePath('/contracts')
  redirect(`/contracts/${contractId}`)
}

export type DeleteState = { error?: string }

// "Chave mãe" de exclusão — só admin. Exclui de verdade (sem manter
// histórico) — pedido explícito pra fase de testes. O banco já está
// configurado com "on delete cascade" em tudo que referencia o
// contrato (funil, atividades, arquivos, pesquisas, faturamento etc.),
// então uma exclusão aqui limpa tudo relacionado de uma vez.
export async function deleteContract(contractId: string, redirectTo?: string): Promise<DeleteState> {
  const isAdmin = await isCurrentUserAdmin()
  if (!isAdmin) return { error: 'Só administradores podem excluir contratos.' }

  const supabase = (await createScopedAdmin())

  // Limpa a referência no lead antes de deletar — se um lead foi
  // convertido nessa oportunidade, o banco bloquearia o delete por
  // FK. Setamos null pra desvincular sem apagar o lead.
  await supabase
    .from('leads')
    .update({ converted_contract_id: null })
    .eq('converted_contract_id', contractId)

  const { error } = await supabase.from('contracts').delete().eq('id', contractId)

  if (error) return { error: error.message }

  revalidatePath('/pipeline')
  revalidatePath('/contracts')
  if (redirectTo) redirect(redirectTo)
  return {}
}
