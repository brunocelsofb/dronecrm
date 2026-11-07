'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/auth/role'
import { requireTenantId } from '@/lib/tenant/context'
import { isAreaId, resolveAreas } from '@/lib/auth/access-profiles'
import { passwordProblem } from '@/lib/auth/password'
import { profileProblems, cleanPhoneBR } from '@/lib/people/profile-complete'

// Só mexe em usuário da MESMA empresa e nunca no Super Admin (login da plataforma)
async function canManage(targetUserId: string): Promise<boolean> {
  const tenantId = await requireTenantId()
  const { data: target } = await createAdminClient()
    .from('profiles').select('tenant_id, is_super_admin').eq('id', targetUserId).maybeSingle()
  return !!target && target.tenant_id === tenantId && !target.is_super_admin
}

export type ActionState = { error?: string }

// Procura o login (auth) pelo e-mail. Só usado quando o e-mail já existe e não tem perfil.
async function findAuthUserByEmail(admin: ReturnType<typeof createAdminClient>, email: string): Promise<string | null> {
  const target = email.toLowerCase()
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) return null
    const hit = data.users.find(u => u.email?.toLowerCase() === target)
    if (hit) return hit.id
    if (data.users.length < 200) return null
  }
  return null
}

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
  const phone = cleanPhoneBR(formData.get('phone'))
  const rawProfile = formData.get('access_profile') as string
  const access_profile = role === 'admin' ? null : (await isTenantArea(rawProfile)) ? rawProfile : 'gestor'

  if (!email || !fullName || !password) {
    return { error: 'Preencha nome, e-mail e senha.' }
  }
  // Cadastro completo é obrigatório (os agentes usam nome, telefone, área e e-mail)
  const missing = profileProblems({ full_name: fullName, phone, department, email })
  if (missing.length) return { error: `Preencha: ${missing.join(', ')}.` }
  const problem = passwordProblem(password, { email })
  if (problem) return { error: problem }

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

  // E-mail já cadastrado no CRM? (perfil existe nesta ou em outra empresa)
  const { data: existingProfile } = await adminClient
    .from('profiles').select('id, tenant_id').ilike('email', email.replace(/[\\%_]/g, m => `\\${m}`)).limit(1).maybeSingle()
  if (existingProfile) {
    return {
      error: existingProfile.tenant_id === tenantId
        ? 'Esse e-mail já é de um usuário desta empresa. Procure-o na lista de usuários.'
        : 'Esse e-mail já é usado por outra empresa no CRM. Use outro e-mail.',
    }
  }

  let userId: string
  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
    // Senha provisória: a pessoa cria a própria no primeiro acesso
    app_metadata: { tenant_id: tenantId, must_change_password: true },
  })

  if (created?.user) {
    userId = created.user.id
  } else {
    // Login que ficou sem perfil (ex.: usuário excluído antes só pela metade): reaproveita
    const orphan = createError && /already.*registered|already exists/i.test(createError.message)
      ? await findAuthUserByEmail(adminClient, email)
      : null
    if (!orphan) {
      return { error: `Falha ao criar usuário: ${createError?.message ?? 'erro desconhecido'}` }
    }
    const { error: updErr } = await adminClient.auth.admin.updateUserById(orphan, {
      password,
      email_confirm: true,
      ban_duration: 'none',
      user_metadata: { full_name: fullName },
      app_metadata: { tenant_id: tenantId, must_change_password: true },
    })
    if (updErr) return { error: `Falha ao reativar o login existente: ${updErr.message}` }
    userId = orphan
  }

  const { error: profileError } = await adminClient.from('profiles').insert({
    id: userId,
    full_name: fullName,
    email,
    role,
    department,
    phone,
    access_profile,
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
  const { data: target } = await supabase.from('profiles').select('access_profile').eq('id', targetUserId).maybeSingle()
  await supabase.from('profiles').update({
    role: newRole,
    ...(newRole !== 'admin' && !target?.access_profile ? { access_profile: newRole === 'aprovador_tecnico' ? 'tecnico' : 'gestor' } : {}),
  }).eq('id', targetUserId)

  revalidatePath('/users')
}

// Perfil de acesso: decide quais abas a pessoa vê (Admin vê tudo do plano)
export async function updateUserAccessProfile(targetUserId: string, formData: FormData) {
  const currentProfile = await getCurrentProfile()
  if (currentProfile?.role !== 'admin') return
  if (!(await canManage(targetUserId))) return
  const value = formData.get('access_profile') as string
  if (!(await isTenantArea(value))) return
  const supabase = createAdminClient()
  await supabase.from('profiles').update({ access_profile: value }).eq('id', targetUserId)
  revalidatePath('/users')
}

// Área existe nesta empresa (padrão ou criada)?
async function isTenantArea(value: unknown): Promise<boolean> {
  if (!isAreaId(value)) return false
  const { resolveTenantId } = await import('@/lib/tenant/context')
  const tenantId = await resolveTenantId()
  const { data } = await createAdminClient().from('organization_settings').select('access_areas, profile_features').eq('tenant_id', tenantId).maybeSingle()
  return resolveAreas(data?.access_areas, data?.profile_features).some(a => a.id === value)
}

// Valores avulsos: '' = regra da área; 'sim' = liberado; 'nao' = bloqueado (só esta pessoa)
export async function updateUserSeesValues(targetUserId: string, formData: FormData) {
  const currentProfile = await getCurrentProfile()
  if (currentProfile?.role !== 'admin') return
  if (!(await canManage(targetUserId))) return
  const v = String(formData.get('sees_values') ?? '')
  const sees_values = v === 'sim' ? true : v === 'nao' ? false : null
  await createAdminClient().from('profiles').update({ sees_values }).eq('id', targetUserId)
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

// Nome e telefone (cadastro completo): o admin completa os logins antigos na lista de usuários
export async function updateUserContact(targetUserId: string, input: { full_name: string; phone: string }): Promise<ActionState> {
  const currentProfile = await getCurrentProfile()
  if (currentProfile?.role !== 'admin') return { error: 'Só administradores podem alterar usuários.' }
  if (targetUserId !== currentProfile.id && !(await canManage(targetUserId))) return { error: 'Usuário de outra empresa.' }
  const full_name = String(input.full_name ?? '').trim().replace(/\s+/g, ' ')
  const phone = cleanPhoneBR(input.phone)
  if (full_name.split(' ').length < 2) return { error: 'Informe nome e sobrenome.' }
  if (phone && (phone.length < 10 || phone.length > 13)) return { error: 'Telefone com DDD (10 a 13 números).' }
  const { error } = await createAdminClient().from('profiles').update({ full_name, phone: phone || null }).eq('id', targetUserId)
  if (error) return { error: error.message }
  revalidatePath('/users')
  return {}
}
