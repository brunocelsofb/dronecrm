'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export type ActionState = { error?: string }

export async function setMonthlyGoal(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Usuário não autenticado.' }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') return { error: 'Só administradores podem definir a meta.' }

  const year = Number(formData.get('year'))
  const month = Number(formData.get('month'))
  const targetValue = Number(formData.get('target_value'))

  if (!year || !month || Number.isNaN(targetValue)) {
    return { error: 'Preencha ano, mês e valor da meta corretamente.' }
  }

  const { resolveTenantId } = await import('@/lib/tenant/context')
  const tenantId = await resolveTenantId()
  const { error } = await supabase
    .from('monthly_goals')
    .upsert({ tenant_id: tenantId, year, month, target_value: targetValue, updated_by: user.id, updated_at: new Date().toISOString() }, { onConflict: 'tenant_id,year,month' })

  if (error) return { error: error.message }

  revalidatePath('/')
  return {}
}

export async function setBillingType(contractId: string, billingType: 'fixed' | 'metered') {
  const supabase = await createClient()
  await supabase.from('contracts').update({ billing_type: billingType, contract_type: billingType === 'metered' ? 'medicao' : 'fixo' }).eq('id', contractId)
  revalidatePath('/pipeline')
  revalidatePath(`/contracts/${contractId}`)
}

export async function confirmBilling(
  contractId: string,
  filePath: string | null,
  fileName: string | null,
  formData: FormData
): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Usuário não autenticado.' }

  const year = Number(formData.get('year'))
  const month = Number(formData.get('month'))
  const amount = Number(formData.get('amount'))
  const notes = (formData.get('notes') as string) || null

  if (!year || !month || Number.isNaN(amount)) {
    return { error: 'Preencha ano, mês e valor corretamente.' }
  }

  const { error } = await supabase.from('billing_records').upsert(
    {
      contract_id: contractId,
      year,
      month,
      amount,
      file_storage_path: filePath,
      file_name: fileName,
      notes,
      confirmed_by: user.id,
      confirmed_at: new Date().toISOString(),
    },
    { onConflict: 'contract_id,year,month' }
  )

  if (error) return { error: error.message }

  await supabase.from('activities').insert({
    contract_id: contractId,
    user_id: user.id,
    type: 'system',
    content: `Faturamento de ${month}/${year} confirmado: R$ ${amount.toLocaleString('pt-BR')}.${fileName ? ` Relatório anexado: ${fileName}.` : ''}`,
  })

  revalidatePath(`/contracts/${contractId}`)
  revalidatePath('/')
  return {}
}
