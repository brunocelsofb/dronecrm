'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { PipelineFieldConfig } from '@/lib/pipeline-field-config'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

export async function savePipelineFieldConfigs(
  pipelineId: string,
  configs: PipelineFieldConfig[]
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const rows = configs.map((c, idx) => ({
    pipeline_id: pipelineId,
    field_key: c.field_key,
    field_label: c.field_label,
    visibility: c.visibility,
    display_order: idx,
  }))
  const { error } = await supabase
    .from('pipeline_field_configs')
    .upsert(rows, { onConflict: 'pipeline_id,field_key' })
  if (error) return { error: error.message }
  revalidatePath('/settings/campos-oportunidade')
  revalidatePath('/contracts/new')
  return {}
}

export async function deletePipelineField(pipelineId: string, fieldKey: string): Promise<{ error?: string }> {
  const supabase = (await createScopedAdmin())
  const { error } = await supabase
    .from('pipeline_field_configs')
    .delete()
    .eq('pipeline_id', pipelineId)
    .eq('field_key', fieldKey)
  if (error) return { error: error.message }
  revalidatePath('/settings/campos-oportunidade')
  return {}
}

export async function addPipelineField(
  pipelineId: string,
  fieldKey: string,
  fieldLabel: string,
  displayOrder: number
): Promise<{ error?: string }> {
  const supabase = (await createScopedAdmin())
  const { error } = await supabase.from('pipeline_field_configs').upsert(
    { pipeline_id: pipelineId, field_key: fieldKey, field_label: fieldLabel, visibility: 'optional', display_order: displayOrder },
    { onConflict: 'pipeline_id,field_key' }
  )
  if (error) return { error: error.message }
  revalidatePath('/settings/campos-oportunidade')
  return {}
}
