'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

export type ActionState = { error?: string }

export async function createTag(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const supabase = await createClient()
  const name = (formData.get('name') as string)?.trim()
  const color = (formData.get('color') as string) || '#6B7280'

  if (!name) return { error: 'Nome é obrigatório.' }

  const { error } = await supabase.from('tags').insert({ name, color })

  if (error) {
    if (error.code === '23505') return { error: 'Já existe uma tag com esse nome.' }
    return { error: error.message }
  }

  revalidatePath('/tags')
  return {}
}

export async function updateTag(tagId: string, name: string, color: string, context?: string): Promise<ActionState> {
  if (!name?.trim()) return { error: 'Nome é obrigatório.' }
  const supabase = (await createScopedAdmin())
  const { error } = await supabase.from('tags').update({
    name: name.trim(),
    color,
    ...(context ? { context } : {}),
  }).eq('id', tagId)
  if (error) return { error: error.message }
  revalidatePath('/tags')
  return {}
}

export async function deleteTag(tagId: string): Promise<ActionState> {
  const supabase = (await createScopedAdmin())

  // Limpa referências em tabelas que têm FK para tags (sem ON DELETE SET NULL)
  await supabase.from('survey_templates').update({ tag_id: null }).eq('tag_id', tagId)
  await supabase.from('contract_tags').delete().eq('tag_id', tagId)

  const { error } = await supabase.from('tags').delete().eq('id', tagId)
  if (error) return { error: error.message }
  revalidatePath('/tags')
  return {}
}

export async function setContractTag(contractId: string, formData: FormData) {
  const supabase = await createClient()
  const tagId = (formData.get('tag_id') as string) || null

  const { data: previousTags } = await supabase.from('contract_tags').select('tag_id').eq('contract_id', contractId)
  const previousTagIds = (previousTags ?? []).map((t) => t.tag_id)

  await supabase.from('contract_tags').delete().eq('contract_id', contractId)

  if (tagId) {
    await supabase.from('contract_tags').insert({ contract_id: contractId, tag_id: tagId })
  }

  const { checkAndTriggerTagAutomations } = await import('./automations')
  for (const removedTagId of previousTagIds) {
    if (removedTagId !== tagId) await checkAndTriggerTagAutomations(contractId, removedTagId, 'tag_removed')
  }
  if (tagId && !previousTagIds.includes(tagId)) {
    await checkAndTriggerTagAutomations(contractId, tagId, 'tag_added')
  }

  revalidatePath(`/contracts/${contractId}`)
  revalidatePath('/pipeline')
  revalidatePath('/contracts')
}
