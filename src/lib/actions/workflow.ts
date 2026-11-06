'use server'
import { refOk } from '@/lib/files/store'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { departmentLabel } from '@/lib/constants/departments'

export type ActionState = { error?: string }

// "Dono da conta" (Customer Success) é DIFERENTE de "responsável agora"
// — é fixo, de longo prazo, e é quem (junto com admin) controla a etapa
// do funil. Só admin pode reatribuir, porque é uma decisão mais séria
// que uma transferência pontual de tratativa.
export async function updateAccountOwner(contractId: string, formData: FormData): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Usuário não autenticado.' }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') return { error: 'Só administradores podem trocar o dono da conta.' }

  const newOwnerId = formData.get('owner_id') as string
  if (!newOwnerId) return { error: 'Selecione o novo dono da conta.' }

  const { data: newOwner } = await supabase.from('profiles').select('full_name').eq('id', newOwnerId).maybeSingle()

  await supabase.from('contracts').update({ owner_id: newOwnerId }).eq('id', contractId)

  await supabase.from('activities').insert({
    contract_id: contractId,
    user_id: user.id,
    type: 'system',
    content: `Dono da conta alterado para ${newOwner?.full_name ?? 'outra pessoa'}.`,
  })

  revalidatePath(`/contracts/${contractId}`)
  return {}
}

// Cria notificações pra quem precisa saber que algo chegou pra ele.
// Se tem uma pessoa específica, notifica só ela; senão, notifica todo
// mundo daquele departamento (evita spam geral quando já tem alguém
// específico escolhido).
async function notifyRecipients(
  supabase: Awaited<ReturnType<typeof createClient>>,
  department: string,
  assigneeId: string | null,
  contractId: string,
  message: string
) {
  if (assigneeId) {
    await supabase.from('notifications').insert({ user_id: assigneeId, contract_id: contractId, message })
    return
  }

  const { data: peopleInDept } = await supabase.from('profiles').select('id').eq('department', department)
  if (peopleInDept && peopleInDept.length > 0) {
    await supabase.from('notifications').insert(
      peopleInDept.map((p) => ({ user_id: p.id, contract_id: contractId, message }))
    )
  }
}

// ------------------------------------------------------------
// Transferência entre departamentos
// ------------------------------------------------------------
export async function transferContract(
  contractId: string,
  toDepartment: string,
  toAssigneeId: string | null,
  note: string,
  filePath: string | null,
  fileName: string | null
): Promise<ActionState> {
  if (!(await refOk(filePath))) return { error: 'Arquivo inválido para esta empresa.' }
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Usuário não autenticado.' }

  if (!toDepartment) return { error: 'Selecione o departamento de destino.' }

  const { data: contract } = await supabase
    .from('contracts')
    .select('current_department, current_assignee_id')
    .eq('id', contractId)
    .single()

  const fromLabel = departmentLabel(contract?.current_department ?? null)
  const toLabel = departmentLabel(toDepartment)

  let toAssigneeName: string | null = null
  if (toAssigneeId) {
    const { data: assignee } = await supabase.from('profiles').select('full_name').eq('id', toAssigneeId).maybeSingle()
    toAssigneeName = assignee?.full_name ?? null
  }

  // Guarda o estado ANTERIOR antes de sobrescrever — é isso que permite
  // o botão "Devolver" funcionar depois, sem precisar vasculhar histórico.
  await supabase
    .from('contracts')
    .update({
      current_department: toDepartment,
      current_assignee_id: toAssigneeId,
      previous_department: contract?.current_department ?? null,
      previous_assignee_id: contract?.current_assignee_id ?? null,
    })
    .eq('id', contractId)

  if (filePath && fileName) {
    await supabase.from('contract_files').insert({
      contract_id: contractId,
      storage_path: filePath,
      file_name: fileName,
      uploaded_by: user.id,
    })
  }

  const destinationText = toAssigneeName ? `${toLabel} (${toAssigneeName})` : toLabel
  const fileText = fileName ? ` Arquivo anexado: ${fileName}.` : ''

  const { error: logError } = await supabase.from('activities').insert({
    contract_id: contractId,
    user_id: user.id,
    type: 'transfer',
    content: `Transferido de ${fromLabel} para ${destinationText}.${note ? ` Nota: ${note}` : ''}${fileText}`,
  })

  revalidatePath(`/contracts/${contractId}`)
  revalidatePath('/pipeline')
  revalidatePath('/contracts')
  // A transferência em si já aconteceu — não desfazemos por causa de
  // falha no LOG, mas avisamos (um log que falha em silêncio foi
  // exatamente o bug anterior).
  if (logError) return { error: `Transferido, mas falhou ao registrar no histórico: ${logError.message}` }

  await notifyRecipients(
    supabase,
    toDepartment,
    toAssigneeId,
    contractId,
    `${fromLabel} transferiu uma oportunidade para você${note ? `: "${note}"` : '.'}`
  )

  return {}
}

// "Devolver": manda de volta pra quem estava responsável ANTES da
// última transferência — o "ele trata e retorna pra nós" de um clique só.
// Aceita uma nota descrevendo o que foi tratado, pra ficar registrado
// junto do pedido original (feito na hora de transferir).
export async function returnContract(contractId: string, note: string, filePath: string | null, fileName: string | null): Promise<ActionState> {
  if (!(await refOk(filePath))) return { error: 'Arquivo inválido para esta empresa.' }
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Usuário não autenticado.' }

  const { data: contract } = await supabase
    .from('contracts')
    .select('current_department, current_assignee_id, previous_department, previous_assignee_id')
    .eq('id', contractId)
    .single()

  if (!contract?.previous_department) {
    return { error: 'Não há um responsável anterior registrado para devolver.' }
  }

  const fromLabel = departmentLabel(contract.current_department)
  const toLabel = departmentLabel(contract.previous_department)

  let toAssigneeName: string | null = null
  if (contract.previous_assignee_id) {
    const { data: assignee } = await supabase.from('profiles').select('full_name').eq('id', contract.previous_assignee_id).maybeSingle()
    toAssigneeName = assignee?.full_name ?? null
  }

  await supabase
    .from('contracts')
    .update({
      current_department: contract.previous_department,
      current_assignee_id: contract.previous_assignee_id,
      previous_department: contract.current_department,
      previous_assignee_id: contract.current_assignee_id,
    })
    .eq('id', contractId)

  if (filePath && fileName) {
    await supabase.from('contract_files').insert({
      contract_id: contractId,
      storage_path: filePath,
      file_name: fileName,
      uploaded_by: user.id,
    })
  }

  const destinationText = toAssigneeName ? `${toLabel} (${toAssigneeName})` : toLabel
  const fileText = fileName ? ` Arquivo anexado: ${fileName}.` : ''

  const { error: logError } = await supabase.from('activities').insert({
    contract_id: contractId,
    user_id: user.id,
    type: 'transfer',
    content: `Devolvido de ${fromLabel} para ${destinationText}.${note ? ` Tratativa: ${note}` : ''}${fileText}`,
  })

  revalidatePath(`/contracts/${contractId}`)
  revalidatePath('/pipeline')
  revalidatePath('/contracts')
  if (logError) return { error: `Devolvido, mas falhou ao registrar no histórico: ${logError.message}` }

  await notifyRecipients(
    supabase,
    contract.previous_department,
    contract.previous_assignee_id,
    contractId,
    `${fromLabel} devolveu uma oportunidade para você${note ? `: "${note}"` : '.'}`
  )

  return {}
}

// ------------------------------------------------------------
// Plano de Ação
// ------------------------------------------------------------
export async function createActionPlanItem(
  contractId: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Usuário não autenticado.' }

  const description = (formData.get('description') as string)?.trim()
  const responsible_department = (formData.get('responsible_department') as string) || null

  if (!description) return { error: 'Descreva a ação.' }

  const { error } = await supabase.from('action_plan_items').insert({
    contract_id: contractId,
    description,
    responsible_department,
    created_by: user.id,
  })

  if (error) return { error: error.message }

  await supabase.from('activities').insert({
    contract_id: contractId,
    user_id: user.id,
    type: 'system',
    content: `Item adicionado ao plano de ação: "${description}"`,
  })

  revalidatePath(`/contracts/${contractId}`)
  return {}
}

export async function updateActionPlanItemStatus(itemId: string, contractId: string, status: string) {
  const supabase = await createClient()
  await supabase
    .from('action_plan_items')
    .update({ status, resolved_at: status === 'done' ? new Date().toISOString() : null })
    .eq('id', itemId)
  revalidatePath(`/contracts/${contractId}`)
}

export async function deleteActionPlanItem(itemId: string, contractId: string) {
  const supabase = await createClient()
  await supabase.from('action_plan_items').delete().eq('id', itemId)
  revalidatePath(`/contracts/${contractId}`)
}

// ------------------------------------------------------------
// Aprovação de dimensionamento (funil de vendas)
// ------------------------------------------------------------
export async function sendDimensioningReview(
  contractId: string,
  filePath: string,
  fileName: string
): Promise<ActionState> {
  if (!(await refOk(filePath))) return { error: 'Arquivo inválido para esta empresa.' }
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Usuário não autenticado.' }

  const { error } = await supabase.from('dimensioning_reviews').insert({
    contract_id: contractId,
    file_storage_path: filePath,
    file_name: fileName,
    sent_by: user.id,
  })

  if (error) return { error: error.message }

  await supabase.from('contracts').update({ current_department: 'tecnico' }).eq('id', contractId)

  const { error: logError } = await supabase.from('activities').insert({
    contract_id: contractId,
    user_id: user.id,
    type: 'transfer',
    content: `Dimensionamento enviado para o time técnico (arquivo: ${fileName}). Transferido de Comercial para Técnico / Operação.`,
  })

  revalidatePath(`/contracts/${contractId}`)
  revalidatePath('/pipeline')
  if (logError) return { error: `Enviado, mas falhou ao registrar no histórico: ${logError.message}` }

  await notifyRecipients(supabase, 'tecnico', null, contractId, 'Um dimensionamento foi enviado pra você dar ciência.')

  return {}
}

export async function reviewDimensioning(
  reviewId: string,
  contractId: string,
  decision: 'acknowledged_ok' | 'acknowledged_disagree',
  notes: string
): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Usuário não autenticado.' }

  const { error } = await supabase
    .from('dimensioning_reviews')
    .update({
      status: decision,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
      review_notes: notes || null,
    })
    .eq('id', reviewId)

  if (error) return { error: error.message }

  const label = decision === 'acknowledged_ok' ? 'DE ACORDO' : 'NÃO DE ACORDO'

  await supabase.from('contracts').update({ current_department: 'comercial' }).eq('id', contractId)

  const { error: logError } = await supabase.from('activities').insert({
    contract_id: contractId,
    user_id: user.id,
    type: 'transfer',
    content: `Time técnico deu ciência do dimensionamento: ${label}.${notes ? ` Observação: ${notes}` : ''} Transferido de volta para Comercial.`,
  })

  revalidatePath(`/contracts/${contractId}`)
  revalidatePath('/pipeline')
  if (logError) return { error: `Registrado, mas falhou ao gravar no histórico: ${logError.message}` }

  await notifyRecipients(supabase, 'comercial', null, contractId, `Time técnico deu ciência do dimensionamento: ${label}.`)

  return {}
}
