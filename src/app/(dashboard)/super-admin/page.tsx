import { createClient } from '@/lib/supabase/server'
import { PLANS } from '@/lib/config/plans'
import { redirect } from 'next/navigation'
import { getSuperAdminData, createNewTenantAndUser, toggleTenantActive, resyncAllEvoWebhooks } from '@/lib/actions/super-admin'
import { startImpersonation } from '@/lib/actions/impersonate'
import { EditTenantRow } from './edit-tenant-row'
import { ResetCrmCard } from '@/components/settings/reset-crm-card'
import { PlanFeaturesMatrix, TenantFeaturesEditor } from './plan-features'
import { getPlanFeatureMatrix } from '@/lib/config/tenant-features'
import { getEffectivePlan } from '@/lib/config/plans'

export const dynamic = 'force-dynamic'

async function checkSuperAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_super_admin, tenant_id')
    .eq('id', user.id)
    .maybeSingle()

  if (!(profile as any)?.is_super_admin) redirect('/')
  return ((profile as { tenant_id?: string | null } | null)?.tenant_id) ?? null
}

const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

function PlanBadge({ plan }: { plan: string }) {
  const colors: Record<string, string> = {
    starter: 'bg-gray-100 text-gray-700',
    professional: 'bg-blue-100 text-blue-700',
    enterprise: 'bg-purple-100 text-purple-700',
    loja: 'bg-positive-100 text-positive-700',
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
    ? `Trial até ${end.toLocaleDateString('pt-BR')}`
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

export default async function SuperAdminPage({ searchParams }: { searchParams: Promise<{ aviso?: string; empresa?: string; ok?: string; falhas?: string }> }) {
  const ownTenantId = await checkSuperAdmin()
  const { aviso, empresa, ok, falhas } = await searchParams
  const tenants = await getSuperAdminData()
  const planMatrix = await getPlanFeatureMatrix()

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Super Admin</h1>
        <p className="text-sm text-gray-500">Gerenciamento de tenants e licenças</p>
      </div>

      <div className="rounded-xl border border-brand-700/20 bg-brand-100 px-4 py-3 text-sm text-brand-800">
        Privacidade: aqui aparecem só métricas e status de cada empresa. O conteúdo (clientes, mensagens, oportunidades) só abre pelo
        <strong> Acessar</strong>, quando o admin da empresa libera o acesso de suporte em Configurações → Privacidade e dados — por tempo limitado,
        só leitura e com cada tela registrada para a empresa.
      </div>
      {aviso === 'sem-liberacao' && (
        <div role="alert" className="rounded-xl border border-warn-600/40 bg-warn-100 px-4 py-3 text-sm text-warn-700">
          {empresa ?? 'Esta empresa'} não liberou o acesso de suporte. Peça ao admin dela para liberar em Configurações → Privacidade e dados.
        </div>
      )}
      {aviso === 'liberacao-encerrada' && (
        <div role="status" className="rounded-xl border border-warn-600/40 bg-warn-100 px-4 py-3 text-sm text-warn-700">
          O acesso de suporte terminou (prazo encerrado ou liberação revogada pela empresa).
        </div>
      )}

      {aviso === 'webhooks' && (
        <div role="status" className={`rounded-xl border px-4 py-3 text-sm ${Number(falhas ?? 0) > 0 ? 'border-warn-600/40 bg-warn-100 text-warn-700' : 'border-positive-600/40 bg-positive-100 text-positive-700'}`}>
          Webhooks do WhatsApp atualizados: {Number(ok ?? 0)} instância(s) ok{Number(falhas ?? 0) > 0 ? `, ${Number(falhas)} com falha (veja os logs)` : ''}.
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm px-6 py-4 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-gray-800">Webhooks do WhatsApp</h2>
          <p className="text-xs text-gray-500 mt-0.5">Registra de novo o webhook de todas as instâncias de todas as empresas, com a chave própria de cada número. Use depois de uma atualização de segurança ou se as mensagens recebidas pararem de chegar.</p>
        </div>
        <form action={resyncAllEvoWebhooks}>
          <button type="submit" className="whitespace-nowrap rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800">Atualizar webhooks</button>
        </form>
      </div>

      <PlanFeaturesMatrix initial={planMatrix} />

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
              <th className="px-6 py-3 text-left">Usuários</th>
              <th className="px-6 py-3 text-left">Uso</th>
              <th className="px-6 py-3 text-left">Privacidade</th>
              <th className="px-6 py-3 text-left">Status</th>
              <th className="px-6 py-3 text-left">Criado em</th>
              <th className="px-6 py-3 text-left">Ações</th>
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
                  <td className="px-6 py-3 text-xs text-gray-600">
                    <div>{t.metrics.companies} empresas · {t.metrics.openOpportunities} em andamento</div>
                    <div>{t.metrics.whatsapp30d} msgs WhatsApp (30 dias)</div>
                    <div className="text-gray-400">Última atividade: {t.metrics.lastActivityAt ? new Date(t.metrics.lastActivityAt).toLocaleDateString('pt-BR') : '—'}</div>
                  </td>
                  <td className="px-6 py-3 text-xs">
                    <div className={t.dpa ? 'text-positive-700' : 'text-warn-700'}>{t.dpa ? `Contrato de dados aceito (v${t.dpa.version})` : 'Contrato de dados pendente'}</div>
                    <div className={t.supportUntil ? 'text-positive-700' : 'text-gray-400'}>{t.supportUntil ? `Suporte liberado até ${fmtDateTime(t.supportUntil)}` : 'Suporte não liberado'}</div>
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
                    <div className="flex items-center gap-1.5">
                      {/* Botão Acessar: inicia impersonation */}
                      <form action={startImpersonation}>
                        <input type="hidden" name="tenant_id" value={t.id} />
                        <input type="hidden" name="tenant_name" value={t.name} />
                        <button
                          type="submit"
                          disabled={t.id !== ownTenantId && !t.supportUntil}
                          title={t.id !== ownTenantId && !t.supportUntil ? 'A empresa não liberou o acesso de suporte' : 'Entrar só para leitura (fica registrado)'}
                          className="rounded border border-green-200 bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700 hover:bg-green-100 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Acessar
                        </button>
                      </form>
                      {/* Botão Editar: abre form inline */}
                      <label
                        htmlFor={`edit-${t.id}`}
                        className="cursor-pointer rounded border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors"
                      >
                        Editar
                      </label>
                      <label
                        htmlFor={`abas-${t.id}`}
                        className="cursor-pointer rounded border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors"
                      >
                        Abas
                      </label>
                      {/* Botão Desativar/Ativar: toggle de status */}
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
                <tr key={`reset-row-${t.id}`}>
                  <td colSpan={8} className="p-0">
                    <ResetCrmCard tenantName={t.name} tenantId={t.id} compact />
                  </td>
                </tr>
                <tr key={`abas-row-${t.id}`}>
                  <td colSpan={8} className="p-0">
                    <input type="checkbox" id={`abas-${t.id}`} className="hidden peer/abas" />
                    <div className="hidden peer-checked/abas:block">
                      <TenantFeaturesEditor
                        tenantId={t.id}
                        tenantName={t.name}
                        planFeatures={planMatrix[getEffectivePlan(t.plan, t.trial_ends_at ?? null)]}
                        initialAdd={(t as { features_add?: string[] }).features_add ?? []}
                        initialRemove={(t as { features_remove?: string[] }).features_remove ?? []}
                      />
                    </div>
                  </td>
                </tr>
                <tr key={`edit-row-${t.id}`}>
                  <td colSpan={8} className="p-0">
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

      {/* Formulário de Criação */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-800">Criar Nova Licença</h2>
          <p className="text-xs text-gray-400 mt-0.5">Cria um tenant + usuário admin inicial</p>
        </div>
        <form action={createNewTenantAndUser} className="p-6 grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Nome da Empresa</label>
            <input name="name" required placeholder="Acme Corp" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#1b556b] focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Slug (único)</label>
            <input name="slug" required placeholder="acme-corp" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#1b556b] focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Email Admin</label>
            <input name="email" type="email" required placeholder="admin@acme.com" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#1b556b] focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Senha Admin</label>
            <input name="password" type="password" required placeholder="••••••••" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#1b556b] focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Nome Completo Admin</label>
            <input name="full_name" required placeholder="João Silva" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#1b556b] focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Plano</label>
            <select name="plan" defaultValue="starter" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#1b556b] focus:outline-none">
              {PLANS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Máx. Usuários</label>
            <input name="max_users" type="number" min="1" defaultValue="5" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#1b556b] focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Fim do Trial (opcional)</label>
            <input name="trial_ends_at" type="datetime-local" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#1b556b] focus:outline-none" />
          </div>
          <div className="col-span-2">
            <button type="submit" className="rounded-lg bg-[#1b556b] px-6 py-2 text-sm font-medium text-white hover:bg-[#154459] transition-colors">
              Criar Tenant e Usuário Admin
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}