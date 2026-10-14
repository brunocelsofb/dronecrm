'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

export type Question = {
  id: string
  type: 'text' | 'textarea' | 'single_choice' | 'multiple_choice' | 'rating' | 'likert' | 'nps' | 'yesno'
  required?: boolean
  label: string
  options?: string[]
}

export type ActionState = { error?: string }

export async function createSurveyTemplate(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Usuário não autenticado.' }

  const name = (formData.get('name') as string)?.trim()
  const questionsRaw = formData.get('questions') as string
  const tag_id = (formData.get('tag_id') as string) || null

  if (!name) return { error: 'Nome do formulário é obrigatório.' }

  let questions: Question[]
  try {
    questions = JSON.parse(questionsRaw)
  } catch {
    return { error: 'Falha ao processar as perguntas.' }
  }

  if (!Array.isArray(questions) || questions.length === 0) {
    return { error: 'Adicione pelo menos uma pergunta.' }
  }

  const { error } = await supabase.from('survey_templates').insert({
    name,
    questions,
    tag_id,
    created_by: user.id,
  })

  if (error) return { error: error.message }

  revalidatePath('/surveys')
  return {}
}

export async function updateSurveyTemplate(
  templateId: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const supabase = await createClient()

  const name = (formData.get('name') as string)?.trim()
  const questionsRaw = formData.get('questions') as string
  const tag_id = (formData.get('tag_id') as string) || null

  if (!name) return { error: 'Nome do formulário é obrigatório.' }

  let questions: Question[]
  try {
    questions = JSON.parse(questionsRaw)
  } catch {
    return { error: 'Falha ao processar as perguntas.' }
  }

  if (!Array.isArray(questions) || questions.length === 0) {
    return { error: 'Adicione pelo menos uma pergunta.' }
  }

  const { error } = await supabase
    .from('survey_templates')
    .update({ name, questions, tag_id })
    .eq('id', templateId)

  if (error) return { error: error.message }

  revalidatePath('/surveys')
  redirect('/surveys')
}

export async function duplicateSurveyTemplate(templateId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return

  const { data: original } = await supabase
    .from('survey_templates')
    .select('name, questions, tag_id')
    .eq('id', templateId)
    .single()

  if (!original) return

  await supabase.from('survey_templates').insert({
    name: `${original.name} (cópia)`,
    questions: original.questions,
    tag_id: original.tag_id,
    created_by: user.id,
  })

  revalidatePath('/surveys')
}

export async function deleteSurveyTemplate(templateId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado.')
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') throw new Error('Apenas administradores podem excluir formulários.')
  await supabase.from('survey_templates').delete().eq('id', templateId)
  revalidatePath('/settings/forms')
  revalidatePath('/surveys')
}

export async function sendCustomSurvey(contractId: string, templateId: string, expiresAt?: string | null) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const token = crypto.randomUUID()

  await supabase.from('custom_surveys').insert({
    contract_id: contractId,
    template_id: templateId,
    token,
    created_by: user.id,
    ...(expiresAt ? { expires_at: expiresAt } : {}),
  })

  revalidatePath(`/contracts/${contractId}`)
}

export type SubmitCustomSurveyResult = { success: true } | { error: string }

export async function submitCustomSurveyResponse(
  token: string,
  formData: FormData
): Promise<SubmitCustomSurveyResult> {
  const respondent_name = (formData.get('respondent_name') as string)?.trim()
  const respondent_email = (formData.get('respondent_email') as string)?.trim()
  const respondent_phone = (formData.get('respondent_phone') as string)?.trim()
  const responsesRaw = formData.get('responses') as string

  if (!respondent_name) return { error: 'Informe seu nome.' }
  if (!respondent_email) return { error: 'Informe seu e-mail.' }
  if (!respondent_phone) return { error: 'Informe seu telefone.' }

  let responses: Record<string, string | string[]>
  try {
    responses = JSON.parse(responsesRaw)
  } catch {
    return { error: 'Falha ao processar as respostas.' }
  }

  const adminClient = (await createScopedAdmin())

  const { data: survey } = await adminClient
    .from('custom_surveys')
    .select('id, status, expires_at')
    .eq('token', token)
    .maybeSingle()

  if (!survey) return { error: 'Link inválido ou expirado.' }
  if (survey.status === 'answered') return { error: 'Este formulário já foi respondido.' }
  if (survey.expires_at && new Date(survey.expires_at) < new Date()) return { error: 'O prazo de resposta desta pesquisa foi encerrado.' }

  const { error } = await adminClient
    .from('custom_surveys')
    .update({
      responses,
      respondent_name,
      respondent_email,
      respondent_phone,
      status: 'answered',
      answered_at: new Date().toISOString(),
    })
    .eq('id', survey.id)

  if (error) return { error: error.message }

  // Tratativa automática de detratores
  try {
    // Busca template para analisar as respostas
    const { data: surveyFull } = await adminClient
      .from('custom_surveys')
      .select('contract_id, template_id')
      .eq('id', survey.id)
      .maybeSingle()

    if (surveyFull) {
      const { data: template } = await adminClient
        .from('survey_templates')
        .select('questions')
        .eq('id', surveyFull.template_id)
        .maybeSingle()

      const questions = (template?.questions ?? []) as Question[]

      // Detecta notas baixas: NPS 0-6, Likert 1-2, yesno "Não"
      let isDetractor = false
      let lowestScore: string | null = null

      for (const q of questions) {
        const answer = responses[q.id]
        const val = Array.isArray(answer) ? answer[0] : answer
        if (!val) continue
        if (q.type === 'nps' && Number(val) <= 6) { isDetractor = true; lowestScore = val }
        if (q.type === 'likert' && Number(val) <= 2) { isDetractor = true; lowestScore = val }
        if (q.type === 'yesno' && val === 'Não') { isDetractor = true; lowestScore = 'Não' }
      }

      if (isDetractor && surveyFull.contract_id) {

        // Cria tarefa no plano de ação do contrato
        await adminClient.from('action_plan_items').insert({
          contract_id: surveyFull.contract_id,
          description: `🚨 TRATATIVA DE DETRATOR: ${respondent_name || 'Cliente'} respondeu nota ${lowestScore}. Entre em contato em até 24 horas para entender os pontos de insatisfação.`,
          responsible_department: 'Comercial',
          status: 'pending',
        })

        // Cria notificação para o responsável
        const { data: contract } = await adminClient
          .from('contracts')
          .select('owner_id, client_name')
          .eq('id', surveyFull.contract_id)
          .maybeSingle()

        if (contract?.owner_id) {
          await adminClient.from('notifications').insert({
            user_id: contract.owner_id,
            title: '⚠️ Detrator identificado',
            body: `${respondent_name} (${contract.client_name}) avaliou com nota ${lowestScore}. Ação necessária em 24h.`,
            type: 'detractor_alert',
            contract_id: surveyFull.contract_id,
            read: false,
          })
        }
      }
    }
  } catch (e) {
    // Não bloqueia o fluxo principal se a tratativa falhar
    console.error('[detractor] erro ao processar:', e)
  }

  return { success: true }
}

export type SurveyTemplate = {
  id: string
  name: string
  category: string
  questions: Question[]
  target_type: 'any' | 'contracts' | 'avulso' | 'tag'
  target_tag_id?: string | null
  created_at: string
}

export async function saveSurveyTemplate(
  templateId: string | null,
  name: string,
  category: string,
  questions: Question[],
  target_type: string = 'any',
  target_tag_id: string | null = null,
  target_pipeline_id: string | null = null
): Promise<{ error?: string; id?: string }> {
  const supabase = await createClient()
  const validTargetTypes = ['any', 'contracts', 'avulso', 'tag', 'pipeline']
  const safeTargetType = validTargetTypes.includes(target_type) ? target_type : 'any'
  const payload = { name, category: category || 'geral', questions, target_type: safeTargetType, target_tag_id: target_tag_id || null, target_pipeline_id: target_pipeline_id || null, updated_at: new Date().toISOString() }
  if (templateId) {
    const { error } = await supabase.from('survey_templates').update(payload).eq('id', templateId)
    if (error) return { error: error.message }
  } else {
    const { data, error } = await supabase.from('survey_templates').insert(payload).select('id').single()
    if (error) return { error: error.message }
    revalidatePath('/settings/forms')
    return { id: data.id }
  }
  revalidatePath('/settings/forms')
  return {}
}

export async function deletePendingSurveyResponse(surveyId: string): Promise<{ error?: string; success?: boolean }> {
  try {
    console.log('[DELETE_SURVEY] Iniciando exclusão ID:', surveyId)

    if (!surveyId) return { error: 'ID não fornecido.' }

    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    console.log('[DELETE_SURVEY] user:', user?.id, 'authError:', authError?.message)
    if (!user) return { error: 'Não autenticado.' }

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
    console.log('[DELETE_SURVEY] role:', profile?.role)
    if (profile?.role !== 'admin') return { error: 'Apenas administradores podem excluir pesquisas pendentes.' }

    // Usa adminClient para o delete (bypassa RLS)
    const admin = (await createScopedAdmin())
    const { data: survey, error: fetchErr } = await admin
      .from('custom_surveys')
      .select('id, status, contract_id')
      .eq('id', surveyId)
      .maybeSingle()
    console.log('[DELETE_SURVEY] survey:', survey, 'fetchErr:', fetchErr?.message)

    if (fetchErr) return { error: fetchErr.message }
    if (!survey) return { error: 'Pesquisa não encontrada.' }
    if (survey.status === 'answered') return { error: 'Pesquisas já respondidas não podem ser excluídas.' }

    const { error: delErr } = await admin.from('custom_surveys').delete().eq('id', surveyId)
    console.log('[DELETE_SURVEY] delErr:', delErr?.message)
    if (delErr) return { error: delErr.message }

    revalidatePath(`/contracts/${survey.contract_id}`)
    revalidatePath('/nps-dashboard')
    console.log('[DELETE_SURVEY] Sucesso!')
    return { success: true }
  } catch (e: any) {
    console.error('[DELETE_SURVEY] Erro fatal:', e)
    return { error: e?.message ?? 'Erro desconhecido ao excluir.' }
  }
}

export async function sendBulkSurvey(
  templateId: string,
  tagFilter: string, // 'all' ou UUID de tag
  expiresAt: string
): Promise<{ sent?: number; error?: string }> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'Não autenticado.' }

    const admin = (await createScopedAdmin())

    // Busca contratos ativos (com pipeline_run aberta no funil de gestão_contratos)
    const { data: openRuns } = await admin
      .from('pipeline_runs')
      .select('contract_id')
      .eq('status', 'open')

    let contractIds = [...new Set((openRuns ?? []).map((r: any) => r.contract_id).filter(Boolean))]

    // Filtra por tag se necessário
    if (tagFilter !== 'all') {
      const { data: taggedContracts } = await admin
        .from('contract_tags')
        .select('contract_id')
        .eq('tag_id', tagFilter)
        .in('contract_id', contractIds)
      contractIds = (taggedContracts ?? []).map((r: any) => r.contract_id)
    }

    if (contractIds.length === 0) return { error: 'Nenhum contrato ativo encontrado com esse filtro.' }

    // Insere uma pesquisa por contrato
    const inserts = contractIds.map(contractId => ({
      contract_id: contractId,
      template_id: templateId,
      token: crypto.randomUUID(),
      created_by: user.id,
      expires_at: expiresAt,
    }))

    const { error } = await admin.from('custom_surveys').insert(inserts)
    if (error) return { error: error.message }

    revalidatePath('/surveys-dashboard')
    return { sent: inserts.length }
  } catch (e: any) {
    return { error: e?.message ?? 'Erro ao disparar pesquisas.' }
  }
}
