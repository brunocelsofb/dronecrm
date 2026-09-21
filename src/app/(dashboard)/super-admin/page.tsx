import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getSuperAdminData, createNewTenantAndUser, toggleTenantActive } from '@/lib/actions/super-admin'
import { EditTenantRow } from './edit-tenant-row'

export const dynamic = 'force-dynamic'

async function checkSuperAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .schema('contract_crm')
    .from('profiles')
    .select('is_super_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_super_admin) redirect('/')
}

export default async function SuperAdminPage() {
  await checkSuperAdmin()
  const tenants = await getSuperAdminData()

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Gestao de Tenants</h1>
        <p className="text-sm text-gray-500 mt-1">Visivel apenas para super admins ORBIS</p>
      </div>

      {/* Tenant List */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-8">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">Tenants ({tenants.length})</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                <th className="px-6 py-3">Nome / Slug</th>
                <th className="px-6 py-3">Plano</th>
                <th className="px-6 py-3">Usuarios</th>
                <th className="px-6 py-3">Criado em</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Acoes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {tenants.map((t) => (
                <>
                  <tr key={t.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">{t.name}</div>
                      <div className="text-xs text-gray-400 font-mono">{t.slug}</div>
                      <div className="text-xs text-gray-300 font-mono">{t.id}</div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 uppercase">
                        {t.plan}
                      </span>
                      <div className="text-xs text-gray-400 mt-0.5">max {t.max_users} usuarios</div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="font-medium">{t.user_count}</span>
                      <span className="text-gray-400"> / {t.max_users}</span>
                    </td>
                    <td className="px-6 py-4 text-gray-500">
                      {new Date(t.created_at).toLocaleDateString('pt-BR')}
                    </td>
                    <td className="px-6 py-4">
                      {t.is_active ? (
                        <span className="inline-flex items-center gap-1 text-green-700 text-xs font-medium">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                          Ativo
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-red-700 text-xs font-medium">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />
                          Inativo
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <form action={async () => {
                          'use server'
                          await toggleTenantActive(t.id, !t.is_active)
                        }}>
                          <button
                            type="submit"
                            className={`text-xs px-3 py-1 rounded-md border font-medium transition-colors ${
                              t.is_active
                                ? 'border-red-300 text-red-600 hover:bg-red-50'
                                : 'border-green-300 text-green-600 hover:bg-green-50'
                            }`}
                          >
                            {t.is_active ? 'Desativar' : 'Reativar'}
                          </button>
                        </form>
                        <label
                          htmlFor={`edit-${t.id}`}
                          className="text-xs px-3 py-1 rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 font-medium cursor-pointer transition-colors"
                        >
                          Editar
                        </label>
                      </div>
                    </td>
                  </tr>
                  {/* Edit row gerenciada pelo Client Component */}
                  <tr key={`edit-row-${t.id}`}>
                    <td colSpan={6} className="px-0 py-0">
                      <EditTenantRow tenant={{ id: t.id, name: t.name, slug: t.slug, plan: t.plan, max_users: t.max_users }} />
                    </td>
                  </tr>
                </>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Tenant Form */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">+ Criar Novo Tenant</h2>
        </div>
        <form action={createNewTenantAndUser} className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Nome da Empresa *</label>
            <input
              name="name"
              required
              placeholder="Ex: Clinica Sao Lucas"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#1B556B] focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Slug (URL unico) *</label>
            <input
              name="slug"
              required
              placeholder="Ex: clinica-sao-lucas"
              pattern="[a-z0-9-]+"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#1B556B] focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Nome completo do admin *</label>
            <input
              name="full_name"
              required
              placeholder="Ex: Joao Silva"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#1B556B] focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">E-mail do admin *</label>
            <input
              name="email"
              type="email"
              required
              placeholder="admin@clinica.com"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#1B556B] focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Senha inicial *</label>
            <input
              name="password"
              type="password"
              required
              minLength={8}
              placeholder="Minimo 8 caracteres"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#1B556B] focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Plano</label>
            <select
              name="plan"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#1B556B] focus:outline-none"
            >
              <option value="starter">Starter</option>
              <option value="professional">Professional</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Max. usuarios</label>
            <input
              name="max_users"
              type="number"
              defaultValue={5}
              min={1}
              max={500}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#1B556B] focus:outline-none"
            />
          </div>
          <div className="md:col-span-2 flex justify-end pt-2">
            <button
              type="submit"
              className="rounded-md bg-[#1B556B] px-6 py-2 text-sm font-medium text-white hover:bg-[#154459] transition-colors"
            >
              Criar Tenant e Usuario Admin
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
