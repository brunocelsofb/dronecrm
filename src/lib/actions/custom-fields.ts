'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isCurrentUserAdmin } from '@/lib/auth/role'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

export type ActionState = { error?: string }

function slugifyKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

export async function createCustomField(formData: FormData): Promise<ActionState> {
  if (!(await isCurrentUserAdmin())) return { error: 'Só administradores podem criar campos customizados.' }

  const name = (formData.get('name') as string)?.trim()
  const field_type = (formData.get('field_type') as string) || 'text'
  const selectOptionsRaw = (formData.get('select_options') as string) || ''

  if (!name) return { error: 'Dê um nome pro campo.' }

  const field_key = slugifyKey(name)
  if (!field_key) return { error: 'Nome inválido — use letras ou números.' }

  const RESERVED_KEYS = new Set(['cliente', 'empresa', 'contato', 'processo', 'valor', 'cnpj', 'minha_empresa', 'minha_cnpj', 'responsavel', 'data_hoje', 'ticket_numero', 'ticket_assunto', 'solicitante'])
  if (RESERVED_KEYS.has(field_key)) {
    return { error: `"${field_key}" já é uma variável padrão do sistema — escolha outro nome.` }
  }

  const select_options = (field_type === 'select' || field_type === 'multiselect') && selectOptionsRaw
    ? selectOptionsRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : null

  const supabase = await createClient()
  const { error } = await supabase.from('custom_fields').insert({ name, field_key, field_type, select_options })

  if (error) {
    if (error.code === '23505') return { error: 'Já existe um campo com esse nome (ou nome muito parecido).' }
    return { error: error.message }
  }

  revalidatePath('/custom-fields')
  revalidatePath('/email-templates')
  return {}
}

export async function deleteCustomField(fieldId: string) {
  const supabase = (await createScopedAdmin())
  await supabase.from('custom_fields').delete().eq('id', fieldId)
  revalidatePath('/custom-fields')
}

export async function saveContractCustomFieldValues(contractId: string, formData: FormData): Promise<ActionState> {
  const supabase = await createClient()

  const entries = Array.from(formData.entries()).filter(([key]) => key.startsWith('field_'))

  for (const [key, value] of entries) {
    const fieldId = key.replace('field_', '')
    const stringValue = (value as string)?.trim() || null

    await supabase.from('contract_custom_field_values').upsert(
      { contract_id: contractId, custom_field_id: fieldId, value: stringValue, updated_at: new Date().toISOString() },
      { onConflict: 'contract_id,custom_field_id' }
    )
  }

  revalidatePath(`/contracts/${contractId}`)
  return {}
}

export async function getContractCustomFieldValues(contractId: string): Promise<Record<string, string>> {
  const supabase = (await createScopedAdmin())
  const { data: fields } = await supabase.from('custom_fields').select('id, field_key')
  const { data: values } = await supabase.from('contract_custom_field_values').select('custom_field_id, value').eq('contract_id', contractId)

  const valueByFieldId = new Map((values ?? []).map((v) => [v.custom_field_id, v.value]))
  const result: Record<string, string> = {}
  for (const field of fields ?? []) {
    result[field.field_key] = valueByFieldId.get(field.id) ?? ''
  }
  return result
}
