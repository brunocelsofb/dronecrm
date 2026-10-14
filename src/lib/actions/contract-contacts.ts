'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

export type ActionState = { error?: string }

export type ContractContact = {
  id: string
  contact_id: string
  name: string
  role: string | null
  email: string | null
  phone: string | null
  is_primary: boolean
}

export async function getContractContacts(contractId: string): Promise<ContractContact[]> {
  try {
    const supabase = (await createScopedAdmin())
    const { data } = await supabase
      .from('contract_contacts')
      .select('id, contact_id, is_primary, contacts(name, role, email, phone)')
      .eq('contract_id', contractId)
      .order('is_primary', { ascending: false })

    return (data ?? []).map((row: any) => ({
      id: row.id,
      contact_id: row.contact_id,
      name: row.contacts?.name ?? '',
      role: row.contacts?.role ?? null,
      email: row.contacts?.email ?? null,
      phone: row.contacts?.phone ?? null,
      is_primary: row.is_primary,
    }))
  } catch {
    return []
  }
}

export async function addContractContact(contractId: string, contactId: string): Promise<ActionState> {
  const supabase = await createClient()

  const { count } = await supabase.from('contract_contacts').select('id', { count: 'exact', head: true }).eq('contract_id', contractId)
  const isFirst = (count ?? 0) === 0

  const { error } = await supabase.from('contract_contacts').insert({ contract_id: contractId, contact_id: contactId, is_primary: isFirst })
  if (error) {
    if (error.code === '23505') return { error: 'Esse contato já está vinculado a este contrato.' }
    return { error: error.message }
  }

  if (isFirst) {
    await supabase.from('contracts').update({ contact_id: contactId }).eq('id', contractId)
  }

  revalidatePath(`/contracts/${contractId}`)
  return {}
}

export async function removeContractContact(contractId: string, contactId: string): Promise<ActionState> {
  const supabase = await createClient()

  const { data: link } = await supabase.from('contract_contacts').select('is_primary').eq('contract_id', contractId).eq('contact_id', contactId).maybeSingle()

  await supabase.from('contract_contacts').delete().eq('contract_id', contractId).eq('contact_id', contactId)

  if (link?.is_primary) {
    await supabase.from('contracts').update({ contact_id: null }).eq('id', contractId)
  }

  revalidatePath(`/contracts/${contractId}`)
  return {}
}

export async function setPrimaryContractContact(contractId: string, contactId: string): Promise<ActionState> {
  const supabase = await createClient()

  await supabase.from('contract_contacts').update({ is_primary: false }).eq('contract_id', contractId).eq('is_primary', true)
  const { error } = await supabase.from('contract_contacts').update({ is_primary: true }).eq('contract_id', contractId).eq('contact_id', contactId)
  if (error) return { error: error.message }

  await supabase.from('contracts').update({ contact_id: contactId }).eq('id', contractId)

  revalidatePath(`/contracts/${contractId}`)
  return {}
}
