'use server'

// Senhas: a própria pessoa troca (com a senha atual) e o admin da empresa redefine a de alguém
// da equipe com uma senha provisória, que precisa ser trocada no próximo acesso.
import { createClient as createSupabase } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/auth/role'
import { requireTenantId } from '@/lib/tenant/context'
import { getSupportSession } from '@/lib/tenant/support'
import { passwordProblem } from '@/lib/auth/password'

type Result = { ok: true } | { ok: false; error: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Confere a senha atual sem mexer no login aberto (cliente separado, sem guardar sessão)
async function currentPasswordOk(email: string, password: string): Promise<boolean> {
  const probe = createSupabase(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const { error } = await probe.auth.signInWithPassword({ email, password })
  return !error
}

export async function changeOwnPassword(input: { current: string; next: string; confirm: string }): Promise<Result> {
  if (await getSupportSession()) return { ok: false, error: 'Acesso de suporte é só leitura.' }
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user?.email) return { ok: false, error: 'Entre de novo para trocar a senha.' }
  const next = String(input.next ?? '')
  if (next !== String(input.confirm ?? '')) return { ok: false, error: 'A confirmação não é igual à nova senha.' }
  const forced = user.app_metadata?.must_change_password === true
  const problem = passwordProblem(next, { current: forced ? undefined : input.current, email: user.email })
  if (problem) return { ok: false, error: problem }
  if (!(await currentPasswordOk(user.email, String(input.current ?? '')))) return { ok: false, error: forced ? 'A senha provisória está errada.' : 'A senha atual está errada.' }
  if (next === input.current) return { ok: false, error: 'A nova senha precisa ser diferente da atual.' }
  const { error } = await createAdminClient().auth.admin.updateUserById(user.id, {
    password: next, app_metadata: { ...user.app_metadata, must_change_password: false },
  })
  if (error) return { ok: false, error: 'Não foi possível trocar a senha agora. Tente de novo.' }
  revalidatePath('/', 'layout')
  return { ok: true }
}

// Admin da empresa: senha provisória para alguém da equipe (nunca para si mesmo nem para o Super Admin)
export async function adminResetPassword(targetUserId: string, temp: string): Promise<Result> {
  if (await getSupportSession()) return { ok: false, error: 'Acesso de suporte é só leitura.' }
  const me = await getCurrentProfile()
  if (me?.role !== 'admin') return { ok: false, error: 'Só administradores podem redefinir senhas.' }
  if (!UUID.test(targetUserId) || targetUserId === me.id) return { ok: false, error: 'Para a sua própria senha, use Minha conta.' }
  const tenantId = await requireTenantId()
  const admin = createAdminClient()
  const { data: target } = await admin.from('profiles').select('tenant_id, is_super_admin, email').eq('id', targetUserId).maybeSingle()
  if (!target || target.tenant_id !== tenantId || target.is_super_admin) return { ok: false, error: 'Usuário não encontrado nesta empresa.' }
  const problem = passwordProblem(temp, { email: (target.email as string | null) ?? undefined })
  if (problem) return { ok: false, error: problem }
  const { data: authUser } = await admin.auth.admin.getUserById(targetUserId)
  const { error } = await admin.auth.admin.updateUserById(targetUserId, {
    password: temp, app_metadata: { ...(authUser?.user?.app_metadata ?? {}), must_change_password: true },
  })
  if (error) return { ok: false, error: 'Não foi possível redefinir a senha agora.' }
  revalidatePath('/users')
  return { ok: true }
}
