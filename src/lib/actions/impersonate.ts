'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

const COOKIE_TENANT_ID   = 'orbis_imp_tid'
const COOKIE_TENANT_NAME = 'orbis_imp_name'
const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 4, // 4 horas
}

async function assertSuperAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')

  const { data: profile } = await supabase
    .schema('contract_crm')
    .from('profiles')
    .select('is_super_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_super_admin) throw new Error('Acesso negado')
  return user
}

/** Inicia impersonation: grava cookies com o tenant alvo */
export async function startImpersonation(formData: FormData): Promise<void> {
  await assertSuperAdmin()

  const tenantId   = formData.get('tenant_id') as string
  const tenantName = formData.get('tenant_name') as string

  if (!tenantId || !tenantName) throw new Error('Dados do tenant ausentes')

  // Verifica que o tenant existe e está ativo
  const admin = createAdminClient()
  const { data: tenant, error } = await admin
    .schema('contract_crm')
    .from('tenants')
    .select('id, name, is_active')
    .eq('id', tenantId)
    .single()

  if (error || !tenant) throw new Error('Tenant não encontrado')
  if (!tenant.is_active) throw new Error('Tenant inativo')

  const cookieStore = await cookies()
  cookieStore.set(COOKIE_TENANT_ID,   tenantId,   COOKIE_OPTS)
  cookieStore.set(COOKIE_TENANT_NAME, tenantName, { ...COOKIE_OPTS, httpOnly: false })

  redirect('/')
}

/** Encerra impersonation: remove cookies e volta ao super-admin */
export async function stopImpersonation(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(COOKIE_TENANT_ID)
  cookieStore.delete(COOKIE_TENANT_NAME)
  redirect('/super-admin')
}

/** Lê o estado atual de impersonation (para uso em Server Components) */
export async function getImpersonationState(): Promise<{
  active: boolean
  tenantId: string | null
  tenantName: string | null
}> {
  const cookieStore = await cookies()
  const tenantId   = cookieStore.get(COOKIE_TENANT_ID)?.value   ?? null
  const tenantName = cookieStore.get(COOKIE_TENANT_NAME)?.value ?? null
  return { active: !!tenantId, tenantId, tenantName }
}
