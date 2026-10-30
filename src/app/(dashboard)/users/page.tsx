import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/auth/role'
import { requireTenantId } from '@/lib/tenant/context'
import { updateUserRole, updateUserDepartment, updateUserAccessProfile, deleteUser, toggleUserActive } from '@/lib/actions/users'
import { UserAccessSelect } from '@/components/users/user-access-select'
import Link from 'next/link'
import { UserRoleSelect } from '@/components/users/user-role-select'
import { UserDepartmentSelect } from '@/components/users/user-department-select'
import { NewUserForm } from '@/components/users/new-user-form'
import { DeleteUserButton, ToggleUserButton } from '@/components/users/delete-user-button'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { ResetPasswordButton } from '@/components/users/reset-password-button'

export default async function UsersPage() {
  const currentProfile = await getCurrentProfile()
  if (currentProfile?.role !== 'admin') redirect('/')

  // Usa adminClient para bypassar RLS e ver todos os usuários
  const admin = (await createScopedAdmin())
  // Só a equipe desta empresa (Super Admin da plataforma não aparece)
  const tenantId = await requireTenantId()
  const { data: profiles } = await admin
    .from('profiles')
    .select('id, full_name, email, role, access_profile, department, created_at')
    .eq('tenant_id', tenantId)
    .not('is_super_admin', 'is', true)
    .order('created_at')

  // Busca status de ban via auth admin
  const { data: { users: authUsers } } = await admin.auth.admin.listUsers()
  const bannedIds = new Set((authUsers ?? []).filter((u: any) => u.banned_until).map((u: any) => u.id))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Usuários</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Gerencie os membros da equipe. <strong>Perfil de acesso</strong> decide as abas que a pessoa vê (Admin vê todas);
          <strong> Papel</strong> define Admin e quem aprova propostas.{' '}
          <Link href="/settings/perfis-acesso" className="text-brand-700 hover:underline">Ajustar as abas de cada perfil</Link>
        </p>
      </div>

      <NewUserForm />

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Nome</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Papel</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Perfil de acesso</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Departamento</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {profiles?.map((p) => {
              const isMe = p.id === currentProfile.id
              const isBanned = bannedIds.has(p.id)
              return (
                <tr key={p.id} className={`hover:bg-gray-50 ${isBanned ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{p.full_name}</p>
                    <p className="text-xs text-gray-400">{p.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    {p.id === currentProfile.id ? (
                      <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs text-brand-700">Admin (você)</span>
                    ) : (
                      <UserRoleSelect key={`${p.id}-${p.role}`} defaultValue={p.role} action={updateUserRole.bind(null, p.id)} />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {p.role === 'admin' ? (
                      <span className="text-xs text-gray-500">Tudo (Admin)</span>
                    ) : (
                      <UserAccessSelect key={`${p.id}-${p.access_profile}`} defaultValue={p.access_profile} action={updateUserAccessProfile.bind(null, p.id)} />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {/* key={p.department} força re-render quando valor muda */}
                    <UserDepartmentSelect key={`${p.id}-${p.department}`} defaultValue={p.department} action={updateUserDepartment.bind(null, p.id)} />
                  </td>
                  <td className="px-4 py-3">
                    {isMe ? (
                      <span className="text-xs text-gray-400">—</span>
                    ) : (
                      <span className={`rounded-full px-2 py-0.5 text-xs ${isBanned ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                        {isBanned ? 'Inativo' : 'Ativo'}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {!isMe && (
                      <div className="flex flex-wrap items-center gap-2 justify-end">
                        <ResetPasswordButton userId={p.id} name={p.full_name ?? p.email ?? ''} />
                        <ToggleUserButton action={toggleUserActive.bind(null, p.id, isBanned)} name={p.full_name} isBanned={isBanned} />
                        <DeleteUserButton action={deleteUser.bind(null, p.id)} name={p.full_name} />
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
