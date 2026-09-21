'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

async function assertSuperAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Nao autenticado')

  const { data: profile } = await supabase
    .schema('contract_crm')
    .from('profiles')
    .select('is_super_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_super_admin) throw new Error('Acesso negado')
  return user
}

export async function getSuperAdminData() {
  await assertSuperAdmin()
  const admin = createAdminClient()

  const { data: tenants, error } = await admin
    .schema('contract_crm')
    .from('tenants')
    .select('id, name, slug, plan, is_active, max_users, created_at')
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)

  const tenantsWithCount = await Promise.all(
    (tenants ?? []).map(async (t) => {
      const { count } = await admin
        .schema('contract_crm')
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', t.id)
      return { ...t, user_count: count ?? 0 }
    })
  )

  return tenantsWithCount
}

export async function createNewTenantAndUser(formData: FormData): Promise<void> {
  await assertSuperAdmin()
  const admin = createAdminClient()

  const name = formData.get('name') as string
  const slug = formData.get('slug') as string
  const email = formData.get('email') as string
  const password = formData.get('password') as string
  const fullName = formData.get('full_name') as string
  const plan = (formData.get('plan') as string) || 'starter'
  const maxUsers = parseInt(formData.get('max_users') as string) || 5

  if (!name || !slug || !email || !password || !fullName) {
    throw new Error('Todos os campos sao obrigatorios')
  }

  const { data: tenant, error: tenantError } = await admin
    .schema('contract_crm')
    .from('tenants')
    .insert({ name, slug, plan, max_users: maxUsers, is_active: true })
    .select('id')
    .single()

  if (tenantError) throw new Error('Erro ao criar tenant: ' + tenantError.message)

  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
    app_metadata: { tenant_id: tenant.id },
  })

  if (authError) {
    await admin.schema('contract_crm').from('tenants').delete().eq('id', tenant.id)
    throw new Error('Erro ao criar usuario: ' + authError.message)
  }

  const { error: profileError } = await admin
    .schema('contract_crm')
    .from('profiles')
    .insert({
      id: authData.user.id,
      full_name: fullName,
      email,
      tenant_id: tenant.id,
      role: 'admin',
    })

  if (profileError) {
    throw new Error('Perfil falhou: ' + profileError.message)
  }

  await admin
    .schema('contract_crm')
    .from('organization_settings')
    .insert({ id: 'default', tenant_id: tenant.id })

  revalidatePath('/super-admin')
  redirect('/super-admin')
}

export async function toggleTenantActive(tenantId: string, isActive: boolean): Promise<void> {
  await assertSuperAdmin()
  const admin = createAdminClient()

  const { error } = await admin
    .schema('contract_crm')
    .from('tenants')
    .update({ is_active: isActive })
    .eq('id', tenantId)

  if (error) throw new Error(error.message)
  revalidatePath('/super-admin')
}
