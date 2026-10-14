'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

export async function createNpsSurvey(contractId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return

  const token = crypto.randomUUID()

  await supabase.from('nps_surveys').insert({
    contract_id: contractId,
    token,
    created_by: user.id,
  })

  revalidatePath(`/contracts/${contractId}`)
}

export type BulkSendState = { sent?: number; skipped?: number; error?: string }

// Envia pesquisa NPS para todos os contratos com passagem de funil aberta
// em pipelines do tipo "gestão de contratos" (não inclui funis de vendas,
// já que NPS mede satisfação de quem já é cliente). Contratos que já têm
// uma pesquisa pendente são pulados, para não disparar duplicado em massa
// — diferente do envio manual (um por vez), que você pediu para continuar
// sem essa restrição.
export async function sendNpsToAllActiveContracts(
  _prevState: BulkSendState,
  _formData: FormData
): Promise<BulkSendState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { error: 'Usuário não autenticado.' }

  const { data: pipelines } = await supabase.from('pipelines').select('id').eq('type', 'gestao_contratos')
  const pipelineIds = (pipelines ?? []).map((p) => p.id)
  if (!pipelineIds.length) return { sent: 0, skipped: 0 }

  const { data: openRuns } = await supabase
    .from('pipeline_runs')
    .select('contract_id')
    .in('pipeline_id', pipelineIds)
    .eq('status', 'open')

  const contractIds = [...new Set((openRuns ?? []).map((r) => r.contract_id))]
  if (!contractIds.length) return { sent: 0, skipped: 0 }

  const { data: pendingSurveys } = await supabase
    .from('nps_surveys')
    .select('contract_id')
    .in('contract_id', contractIds)
    .eq('status', 'pending')

  const alreadyPending = new Set((pendingSurveys ?? []).map((s) => s.contract_id))
  const toSend = contractIds.filter((id) => !alreadyPending.has(id))

  if (toSend.length) {
    const rows = toSend.map((contract_id) => ({
      contract_id,
      token: crypto.randomUUID(),
      created_by: user.id,
    }))
    const { error } = await supabase.from('nps_surveys').insert(rows)
    if (error) return { error: error.message }
  }

  revalidatePath('/nps-dashboard')
  return { sent: toSend.length, skipped: alreadyPending.size }
}

export type SubmitNpsResult =
  | { success: true }
  | { error: string }

// Usada pela página PÚBLICA (sem login) — por isso usa o cliente admin
// (service_role), que ignora RLS. A validação de segurança acontece aqui
// em código, não em política de banco: só aceitamos a resposta se o token
// existir e a pesquisa ainda estiver pendente (evita responder duas vezes
// ou adulterar uma pesquisa já respondida).
export async function submitNpsResponse(
  token: string,
  formData: FormData
): Promise<SubmitNpsResult> {
  const scoreRaw = formData.get('score') as string
  const comment = (formData.get('comment') as string) || null
  const respondent_name = (formData.get('respondent_name') as string)?.trim()
  const respondent_email = (formData.get('respondent_email') as string)?.trim()
  const respondent_phone = (formData.get('respondent_phone') as string)?.trim()

  const score = Number(scoreRaw)
  if (Number.isNaN(score) || score < 0 || score > 10) {
    return { error: 'Selecione uma nota de 0 a 10.' }
  }
  if (!respondent_name) {
    return { error: 'Informe seu nome.' }
  }
  if (!respondent_email) {
    return { error: 'Informe seu e-mail.' }
  }
  if (!respondent_phone) {
    return { error: 'Informe seu telefone.' }
  }

  const adminClient = (await createScopedAdmin())

  const { data: survey } = await adminClient
    .from('nps_surveys')
    .select('id, status')
    .eq('token', token)
    .maybeSingle()

  if (!survey) return { error: 'Link inválido ou expirado.' }
  if (survey.status === 'answered') return { error: 'Esta pesquisa já foi respondida.' }

  const { error } = await adminClient
    .from('nps_surveys')
    .update({
      score,
      comment,
      respondent_name,
      respondent_email,
      respondent_phone,
      status: 'answered',
      answered_at: new Date().toISOString(),
    })
    .eq('id', survey.id)

  if (error) return { error: error.message }

  return { success: true }
}
