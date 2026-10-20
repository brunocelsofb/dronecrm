'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isCurrentUserAdmin } from '@/lib/auth/role'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { segmentOf } from '@/lib/companies/settings'

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
  const segment = (formData.get('segment') as string) || ''
  if (!segmentOf(segment)) return { error: 'Escolha o segmento da empresa.' }
  const cnpjDigits = ((formData.get('cnpj') as string) || '').replace(/\D/g, '')
  if (cnpjDigits) {
    const { data: dup } = await supabase.from('companies').select('id, name').eq('cnpj', cnpjDigits).maybeSingle()
    if (dup) return { error: `Já existe uma empresa com este CNPJ: ${dup.name}.` }
  }

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


// ─── Editar empresa (abas Dados, Outros dados e Pessoas) ──────────────────────
export type CompanyEditInput = {
  name: string; trade_name: string; cnpj: string; segment: string; status: string; account_owner_id: string
  phone: string; email: string; company_size: string
  zip_code: string; street: string; street_number: string; neighborhood: string; city: string; state: string
  capital_social: string; main_activity: string; notes: string
}
const COMPANY_STATUS = ['lead', 'prospect', 'cliente_ativo', 'cliente_inativo', 'nao_qualificado']

export async function saveCompanyEdit(companyId: string, input: CompanyEditInput): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = await createScopedAdmin()
  const { data: current } = await db.from('companies').select('id').eq('id', companyId).maybeSingle()
  if (!current) return { ok: false, error: 'Empresa não encontrada.' }
  const t = (v: string | undefined, max = 200) => (v ?? '').trim().slice(0, max) || null
  const name = t(input.name)
  if (!name) return { ok: false, error: 'Informe a razão social.' }
  if (!t(input.segment)) return { ok: false, error: 'Escolha o segmento.' }
  const cnpj = (input.cnpj ?? '').replace(/\D/g, '') || null
  if (cnpj && cnpj.length !== 14) return { ok: false, error: 'CNPJ deve ter 14 dígitos.' }
  if (cnpj) {
    const { data: dup } = await db.from('companies').select('id, name').eq('cnpj', cnpj).neq('id', companyId).maybeSingle()
    if (dup) return { ok: false, error: `Este CNPJ já está em outra empresa: ${dup.name}.` }
  }
  const email = t(input.email)
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'E-mail da empresa inválido.' }
  let owner: string | null = t(input.account_owner_id)
  if (owner) {
    const { data: p } = await db.from('profiles').select('id').eq('id', owner).maybeSingle()
    if (!p) owner = null
  }
  const cap = (input.capital_social ?? '').replace(/[R$\s]/g, '')
  const capital = cap ? Number(cap.includes(',') ? cap.replace(/\./g, '').replace(',', '.') : cap) : null
  if (capital !== null && !Number.isFinite(capital)) return { ok: false, error: 'Capital social inválido.' }

  const { error } = await db.from('companies').update({
    name, trade_name: t(input.trade_name), cnpj, segment: JSON.stringify([input.segment.trim()]),
    status: COMPANY_STATUS.includes(input.status) ? input.status : 'lead',
    account_owner_id: owner, phone: t(input.phone, 60), email, company_size: t(input.company_size, 60),
    zip_code: (input.zip_code ?? '').replace(/\D/g, '') || null, street: t(input.street), street_number: t(input.street_number, 20),
    neighborhood: t(input.neighborhood, 120), city: t(input.city, 120), state: (input.state ?? '').trim().toUpperCase().slice(0, 2) || null,
    capital_social: capital, main_activity: t(input.main_activity, 300), notes: t(input.notes, 4000),
    updated_at: new Date().toISOString(),
  }).eq('id', companyId)
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/companies/${companyId}`)
  revalidatePath('/companies')
  return { ok: true }
}

export async function saveCompanyContact(companyId: string, c: {
  id?: string | null; name: string; role: string; email: string; phone: string; is_primary: boolean
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const db = await createScopedAdmin()
  const { data: company } = await db.from('companies').select('id').eq('id', companyId).maybeSingle()
  if (!company) return { ok: false, error: 'Empresa não encontrada.' }
  const name = c.name.trim().slice(0, 120)
  if (!name) return { ok: false, error: 'Informe o nome da pessoa.' }
  const email = c.email.trim().slice(0, 200)
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: `E-mail inválido para ${name}.` }
  const row = { name, role: c.role.trim().slice(0, 80) || null, email: email || null, phone: c.phone.trim().slice(0, 80) || null, is_primary: !!c.is_primary }
  let id = c.id ?? null
  if (id) {
    const { error } = await db.from('contacts').update(row).eq('id', id).eq('company_id', companyId)
    if (error) return { ok: false, error: error.message }
  } else {
    const { data, error } = await db.from('contacts').insert({ ...row, company_id: companyId }).select('id').single()
    if (error || !data) return { ok: false, error: error?.message ?? 'Falha ao salvar.' }
    id = data.id as string
  }
  // Um principal só por empresa
  if (row.is_primary) await db.from('contacts').update({ is_primary: false }).eq('company_id', companyId).neq('id', id)
  revalidatePath(`/companies/${companyId}`)
  return { ok: true, id: id as string }
}
