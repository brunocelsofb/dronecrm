'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/auth/role'
import { requireTenantId } from '@/lib/tenant/context'

// Só mexe em usuário da MESMA empresa e nunca no Super Admin (login da plataforma)
async function canManage(targetUserId: string): Promise<boolean> {
  const tenantId = await requireTenantId()
  const { data: target } = await createAdminClient()
    .from('profiles').select('tenant_id, is_super_admin').eq('id', targetUserId).maybeSingle()
  return !!target && target.tenant_id === tenantId && !target.is_super_admin
}

export type ActionState = { error?: string }

export async function createUserByAdmin(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const currentProfile = await getCurrentProfile()
  if (currentProfile?.role !== 'admin') {
    return { error: 'Só administradores podem criar usuários.' }
  }

  const email = (formData.get('email') as string)?.trim()
  const fullName = (formData.get('full_name') as string)?.trim()
  const password = formData.get('password') as string
  const role = (formData.get('role') as string) === 'admin' ? 'admin' : 'member'
  const department = (formData.get('department') as string) || null

  if (!email || !fullName || !password) {
    return { error: 'Preencha nome, e-mail e senha.' }
  }
  if (password.length < 6) {
    return { error: 'A senha precisa ter pelo menos 6 caracteres.' }
  }

  const adminClient = createAdminClient()
  const tenantId = await requireTenantId()

  // Limite de usuários da licença
  const [{ data: tenant }, { count: userCount }] = await Promise.all([
    adminClient.from('tenants').select('max_users').eq('id', tenantId).maybeSingle(),
    adminClient.from('profiles').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).not('is_super_admin', 'is', true),
  ])
  if (tenant?.max_users && (userCount ?? 0) >= tenant.max_users) {
    return { error: `Sua licença permite ${tenant.max_users} usuário(s). Fale com o administrador da licença para ampliar.` }
  }

  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
    app_metadata: { tenant_id: tenantId },
  })

  if (createError || !created?.user) {
    return { error: `Falha ao criar usuário: ${createError?.message ?? 'erro desconhecido'}` }
  }

  const { error: profileError } = await adminClient.from('profiles').insert({
    id: created.user.id,
    full_name: fullName,
    email,
    role,
    department,
    tenant_id: tenantId,
  })

  if (profileError) {
    return {
      error: `O login foi criado, mas o perfil falhou (${profileError.message}). Contate o suporte técnico — o usuário existe mas não vai conseguir usar o sistema direito ainda.`,
    }
  }

  revalidatePath('/users')
  return {}
}

export async function updateUserDepartment(targetUserId: string, formData: FormData) {
  const currentProfile = await getCurrentProfile()
  if (currentProfile?.role !== 'admin') return
  if (!(await canManage(targetUserId))) return

  const department = (formData.get('department') as string) || null
  const supabase = createAdminClient()
  await supabase.from('profiles').update({ department }).eq('id', targetUserId)

  revalidatePath('/users')
}

export async function updateUserRole(targetUserId: string, formData: FormData) {
  const currentProfile = await getCurrentProfile()
  if (currentProfile?.role !== 'admin') return
  if (!(await canManage(targetUserId))) return
  if (targetUserId === currentProfile.id) return

  const newRole = formData.get('role') as string
  const validRoles = ['admin', 'member', 'aprovador_tecnico', 'aprovador_comercial']
  if (!validRoles.includes(newRole)) return

  const supabase = createAdminClient()
  await supabase.from('profiles').update({ role: newRole }).eq('id', targetUserId)

  revalidatePath('/users')
}

export async function deleteUser(targetUserId: string) {
  const currentProfile = await getCurrentProfile()
  if (currentProfile?.role !== 'admin') return
  if (!(await canManage(targetUserId))) return
  if (currentProfile.id === targetUserId) return // não pode excluir a si mesmo

  const supabase = createAdminClient()
  // Remove o perfil (o auth.users é gerenciado separadamente)
  await supabase.from('profiles').delete().eq('id', targetUserId)
  // Remove o usuário do auth
  await supabase.auth.admin.deleteUser(targetUserId)

  revalidatePath('/users')
}

export async function toggleUserActive(targetUserId: string, active: boolean) {
  const currentProfile = await getCurrentProfile()
  if (currentProfile?.role !== 'admin') return
  if (!(await canManage(targetUserId))) return
  if (currentProfile.id === targetUserId) return

  const supabase = createAdminClient()
  await supabase.auth.admin.updateUserById(targetUserId, { ban_duration: active ? 'none' : '87600h' })

  revalidatePath('/users')
}
