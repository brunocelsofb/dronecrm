'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { ActivityType } from '@/lib/utils/activity-types'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

// Não re-exportamos ActivityType aqui — importar tipos de 'use server'
// quebra o bundle em runtime. Use @/lib/utils/activity-types diretamente.

export type CreateActivityInput = {
  contractId?: string | null
  companyId?: string | null
  pipelineRunId?: string | null
  title: string
  content: string
  activityType: ActivityType | 'note'
  status: 'planned' | 'done'
  activityDate?: string | null
  activityTime?: string | null
  durationMinutes?: number | null
  reminderMinutes?: number | null
  assignedTo?: string | null
  participants?: string[]
}

export async function createActivity(input: CreateActivityInput): Promise<{ error?: string; id?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  // Normaliza — string vazia não é um ID válido
  const contractId = input.contractId?.trim() || null
  const companyId  = input.companyId?.trim()  || null

  if (!contractId && !companyId) return { error: 'Informe uma oportunidade ou empresa.' }
  if (!input.title?.trim() && !input.content?.trim()) return { error: 'Título ou descrição são obrigatórios.' }

  const row: Record<string, any> = {
    user_id:     user.id,
    type:        'task',
    content:     input.content?.trim() || input.title?.trim() || '',
    completed:   input.status === 'done',
  }
  if (contractId) row.contract_id = contractId
  if (companyId)  row.company_id  = companyId
  if (input.pipelineRunId) row.pipeline_run_id = input.pipelineRunId

  // Campos novos — adicionados pela migration-activities-v2
  // Se não existirem ainda no banco, o insert vai ignorar silenciosamente
  // pela lógica de fallback abaixo
  const fullRow = {
    ...row,
    activity_type:    input.activityType,
    title:            input.title?.trim() || null,
    status:           input.status,
    activity_date:    input.activityDate  || null,
    activity_time:    input.activityTime  || null,
    duration_minutes: input.durationMinutes ?? null,
    reminder_minutes: input.reminderMinutes ?? null,
    assigned_to:      input.assignedTo ?? user.id,
    participants:     input.participants?.length ? input.participants : null,
  }

  let { data, error } = await supabase.from('activities').insert(fullRow).select('id').single()

  // Fallback: se falhou por coluna inexistente, tenta só com campos base
  if (error) {
    const fallback = await supabase.from('activities').insert(row).select('id').single()
    data  = fallback.data
    error = fallback.error
  }

  if (error) return { error: error.message }

  if (contractId) revalidatePath(`/contracts/${contractId}`)
  if (companyId)  revalidatePath(`/companies/${companyId}`)
  return { id: data?.id }
}

export async function updateActivityStatus(
  id: string,
  status: 'planned' | 'done'
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const updateData: Record<string, any> = { completed: status === 'done' }
  // Tenta atualizar o campo status (existe apenas após migration-activities-v2)
  const { error } = await supabase.from('activities')
    .update({ ...updateData, status })
    .eq('id', id)
  if (error) {
    // Fallback sem o campo status
    const { error: e2 } = await supabase.from('activities').update(updateData).eq('id', id)
    if (e2) return { error: e2.message }
  }
  return {}
}

export async function deleteActivity(id: string): Promise<{ error?: string }> {
  // Usa adminClient para garantir permissão mesmo com RLS restritivo
  const supabase = (await createScopedAdmin())

  // Busca para saber onde revalidar — ignora erro se colunas não existem
  const { data: act } = await supabase
    .from('activities')
    .select('contract_id')
    .eq('id', id)
    .maybeSingle()

  const { error } = await supabase.from('activities').delete().eq('id', id)
  if (error) return { error: error.message }

  if (act?.contract_id) revalidatePath(`/contracts/${act.contract_id}`)
  return {}
}

// Compatibilidade retroativa com NoteForm
export type ActivityActionState = { error?: string }

export async function createNote(
  _prev: ActivityActionState,
  formData: FormData
): Promise<ActivityActionState> {
  const contractId = (formData.get('contract_id') as string)?.trim() || null
  const content = (formData.get('content') as string)?.trim()
  if (!content) return { error: 'Escreva algo antes de salvar.' }
  if (!contractId) return { error: 'ID do contrato não encontrado.' }
  const result = await createActivity({
    contractId, companyId: null, content, title: '', activityType: 'note', status: 'done',
  })
  return result.error ? { error: result.error } : {}
}
