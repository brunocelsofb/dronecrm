'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isCurrentUserAdmin } from '@/lib/auth/role'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

export type ActionState = {
  error?: string
  fieldErrors?: Record<string, string[]>
}

export async function findCompanyByCnpj(cnpjDigits: string) {
  const supabase = await createClient()

  const { data: company } = await supabase
    .from('companies')
    .select('id, name, trade_name')
    .eq('cnpj', cnpjDigits)
    .maybeSingle()

  if (!company) return null

  const { data: contacts } = await supabase
    .from('contacts')
    .select('id, name, role')
    .eq('company_id', company.id)
    .order('created_at')

  return { ...company, contacts: contacts ?? [] }
}

export async function createCompany(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Usuário não autenticado.' }

  const name = (formData.get('name') as string)?.trim()
  if (!name) return { fieldErrors: { name: ['Nome é obrigatório'] } }

  const insert: Record<string, any> = {
    name,
    trade_name:    (formData.get('trade_name') as string) || null,
    cnpj:          ((formData.get('cnpj') as string) || '').replace(/\D/g, '') || null,
    notes:         (formData.get('notes') as string) || null,
    status:        (formData.get('status') as string) || 'lead',
    segment:       (formData.get('segment') as string) || null,
    street:        (formData.get('street') as string) || null,
    street_number: (formData.get('street_number') as string) || null,
    neighborhood:  (formData.get('neighborhood') as string) || null,
    city:          (formData.get('city') as string) || null,
    state:         (formData.get('state') as string) || null,
    zip_code:      (formData.get('zip_code') as string) || null,
    phone:         (formData.get('phone') as string) || null,
    email:         (formData.get('email') as string) || null,
    main_activity: (formData.get('main_activity') as string) || null,
    owner_id:      user.id,
  }
  const capRaw = formData.get('capital_social') as string
  if (capRaw) insert.capital_social = Number(capRaw)

  const { data: company, error } = await supabase.from('companies').insert(insert).select().single()
  if (error) return { error: error.message }

  revalidatePath('/companies')
  redirect(`/companies/${company.id}`)
}

export async function updateCompany(
  companyId: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const supabase = await createClient()

  const name = (formData.get('name') as string)?.trim()
  const trade_name = (formData.get('trade_name') as string) || null
  const cnpj = ((formData.get('cnpj') as string) || '').replace(/\D/g, '') || null
  const notes = (formData.get('notes') as string) || null

  if (!name) {
    return { fieldErrors: { name: ['Nome é obrigatório'] } }
  }

  const { error } = await supabase
    .from('companies')
    .update({ name, trade_name, cnpj, notes, updated_at: new Date().toISOString() })
    .eq('id', companyId)

  if (error) return { error: error.message }

  revalidatePath(`/companies/${companyId}`)
  redirect(`/companies/${companyId}`)
}

export async function createContact(
  companyId: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const supabase = await createClient()

  const name = (formData.get('name') as string)?.trim()
  const role = (formData.get('role') as string) || null
  const email = (formData.get('email') as string) || null
  const phone = (formData.get('phone') as string) || null

  if (!name) {
    return { fieldErrors: { name: ['Nome é obrigatório'] } }
  }

  const { error } = await supabase.from('contacts').insert({
    company_id: companyId,
    name,
    role,
    email,
    phone,
  })

  if (error) return { error: error.message }

  revalidatePath(`/companies/${companyId}`)
  return {}
}

export async function deleteContact(contactId: string, companyId: string): Promise<{ error?: string }> {
  if (!(await isCurrentUserAdmin())) return { error: 'Só administradores podem remover contatos.' }
  const supabase = (await createScopedAdmin())

  // Limpa a referência de "contato principal" nos contratos que
  // apontavam pra esse contato — sem isso, a exclusão falha calada (a
  // chave estrangeira barra, sem avisar nada na tela).
  await supabase.from('contracts').update({ contact_id: null }).eq('contact_id', contactId)
  // Os vínculos de "outros contatos" (contract_contacts) saem sozinhos
  // por cascata.

  const { error } = await supabase.from('contacts').delete().eq('id', contactId)
  if (error) return { error: error.message }

  revalidatePath(`/companies/${companyId}`)
  return {}
}

export type DeleteState = { error?: string }

// "Chave mãe" de exclusão — só admin, exclusão de verdade (sem manter
// histórico), pedida explicitamente pra fase de testes. Ainda assim,
// bloqueia se a empresa tiver contratos vinculados, pra não apagar dado
// de contrato "de sob a mesa" sem querer — nesse caso, exclua os
// contratos primeiro.
export async function deleteCompany(companyId: string): Promise<DeleteState> {
  const isAdmin = await isCurrentUserAdmin()
  if (!isAdmin) return { error: 'Só administradores podem excluir empresas.' }

  const supabase = (await createScopedAdmin())

  const { count } = await supabase
    .from('contracts')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)

  if (count && count > 0) {
    return { error: `Esta empresa tem ${count} contrato(s) vinculado(s). Exclua os contratos primeiro.` }
  }

  const { error } = await supabase.from('companies').delete().eq('id', companyId)
  if (error) return { error: error.message }

  redirect('/companies')
}

