import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getSuperAdminData, createNewTenantAndUser, toggleTenantActive } from '@/lib/actions/super-admin'
import { startImpersonation } from '@/lib/actions/impersonate'
import { EditTenantRow } from './edit-tenant-row'

export const dynamic = 'force-dynamic'

async function checkSuperAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_super_admin')
    .eq('id', user.id)
    .maybeSingle()

  if (!(profile as any)?.is_super_admin) redirect('/')
}

function PlanBadge({ plan }: { plan: string }) {
  const colors: Record<string, string> = {
    starter: 'bg-gray-100 text-gray-700',
    professional: 'bg-blue-100 text-blue-700',
    enterprise: 'bg-purple-100 text-purple-700',
  }
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colors[plan] ?? colors.starter}`}>
      {plan}
    </span>
  )
}

function TrialBadge({ trialEndsAt }: { trialEndsAt: string | null }) {
  if (!trialEndsAt) return null
  const end = new Date(trialEndsAt)
  const now = new Date()
  const active = end > now
  const label = active
    ? `Trial atÃÂ© ${end.toLocaleDateString('pt-BR')}`
    : `Trial expirado`
  return (
    <span
      className={`ml-1 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        active ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-400 line-through'
      }`}
    >
      {label}
    </span>
  )
}

export default async function SuperAdminPage() {
  await checkSuperAdmin()
  const tenants = await getSuperAdminData()

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Super Admin</h1>
        <p className="text-sm text-gray-500">Gerenciamento de tenants e licenÃÂ§as</p>
      </div>

      {/* Tabela de Tenants */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-800">Tenants Ativos</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
            <tr>
              <th className="px-6 py-3 text-left">Nome / Slug</th>
              <th className="px-6 py-3 text-left">Plano / Trial</th>
              <th className="px-6 py-3 text-left">UsuÃÂ¡rios</th>
              <th className="px-6 py-3 text-left">Status</th>
              <th className="px-6 py-3 text-left">Criado em</th>
              <th className="px-6 py-3 text-left">AÃÂ§ÃÂµes</th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((t) => (
              <>
                <tr key={t.id} className="border-t border-gray-100 hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-3">
                    <div className="font-medium text-gray-900">{t.name}</div>
                    <div className="text-xs text-gray-400">{t.slug}</div>
                  </td>
                  <td className="px-6 py-3">
                    <PlanBadge plan={t.plan} />
                    <TrialBadge trialEndsAt={t.trial_ends_at ?? null} />
                  </td>
                  <td className="px-6 py-3 text-gray-600">
                    {t.user_count} / {t.max_users}
                  </td>
                  <td className="px-6 py-3">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      t.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                    }`}>
                      {t.is_active ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-gray-500 text-xs">
                    {new Date(t.created_at).toLocaleDateString('pt-BR')}
                  </td>
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-2">
                      <form action={startImpersonation}>
                        <input type="hidden" name="tenant_id" value={t.id} />
                        <input type="hidden" name="tenant_name" value={t.name} />
                        <button
                          type="submit"
                          className="rounded border border-green-200 bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700 hover:bg-green-100 transition-colors"
                        >
                          ð Acessar
                        </button>
                      </form>
                      <label
                        htmlFor={`edit-${t.id}`}
                        className="cursor-pointer rounded border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors"
                      >
                        Editar
                      </label>
                      <form action={async () => {
                        'use server'
                        await toggleTenantActive(t.id, !t.is_active)
                      }}>
                        <button
                          type="submit"
                          className={`rounded border px-2.5 py-1 text-xs font-medium transition-colors ${
                            t.is_active
                              ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                              : 'border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100'
                          }`}
                        >
                          {t.is_active ? 'Desativar' : 'Ativar'}
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
                <tr key={`edit-row-${t.id}`}>
                  <td colSpan={6} className="p-0">
                    <EditTenantRow
                      tenant={{
                        id: t.id,
                        name: t.name,
                        slug: t.slug,
                        plan: t.plan,
                        max_users: t.max_users,
                        trial_ends_at: t.trial_ends_at ?? null,
                      }}
                    />
                  </td>
                </tr>
              </>
            ))}
          </tbody>
        </table>
      </div>

      {/* FormulÃÂ¡rio de CriaÃÂ§ÃÂ£o */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-800">Criar Nova LicenÃÂ§a</h2>
          <p className="text-xs text-gray-400 mt-0.5">Cria um tenant + usuÃÂ¡rio admin inicial</p>
        </div>
        <form action={createNewTenantAndUser} className="p-6 grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Nome da Empresa</label>
            <input name="name" required placeholder="Acme Corp" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#1e6b8f] focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Slug (ÃÂºnico)</label>
            <input name="slug" required placeholder="acme-corp" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#1e6b8f] focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Email Admin</label>
            <input name="email" type="email" required placeholder="admin@acme.com" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#1e6b8f] focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Senha Admin</label>
            <input name="password" type="password" required placeholder="Ã¢ÂÂ¢Ã¢ÂÂ¢Ã¢ÂÂ¢Ã¢ÂÂ¢Ã¢ÂÂ¢Ã¢ÂÂ¢Ã¢ÂÂ¢Ã¢ÂÂ¢" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#1e6b8f] focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Nome Completo Admin</label>
            <input name="full_name" required placeholder="JoÃÂ£o Silva" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#1e6b8f] focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Plano</label>
            <select name="plan" defaultValue="starter" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#1e6b8f] focus:outline-none">
              <option value="starter">Starter</option>
              <option value="professional">Professional</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">MÃÂ¡x. UsuÃÂ¡rios</label>
            <input name="max_users" type="number" min="1" defaultValue="5" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#1e6b8f] focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Fim do Trial (opcional)</label>
            <input name="trial_ends_at" type="datetime-local" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#1e6b8f] focus:outline-none" />
          </div>
          <div className="col-span-2">
            <button type="submit" className="rounded-lg bg-[#1e6b8f] px-6 py-2 text-sm font-medium text-white hover:bg-[#154459] transition-colors">
              Criar Tenant e Usuario Admin
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}