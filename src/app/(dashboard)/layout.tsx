import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { SidebarNav } from '@/components/layout/sidebar-nav'
import { signOut } from '@/lib/actions/auth'
import { RefreshButton } from '@/components/layout/refresh-button'
import { NotificationBell } from '@/components/layout/notification-bell'
import { AssistantPanel } from '@/components/assistant/assistant-panel'
import { RealtimeWatcher } from '@/components/layout/realtime-watcher'
import { LogOut, Eye, ArrowLeft } from 'lucide-react'
import { FEATURE_KEYS, FEATURES, featureForPath } from '@/lib/config/plans'
import { getTenantFeatures } from '@/lib/config/tenant-features'
import { headers } from 'next/headers'
import { getImpersonationState, stopImpersonation } from '@/lib/actions/impersonate'
import { resolveTenantId } from '@/lib/tenant/context'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, full_name, is_super_admin, tenant_id, impersonating_tenant_id')
    .eq('id', user.id)
    .maybeSingle()

  const { data: orgSettings } = await supabase
    .from('organization_settings')
    .select('name, logo_storage_path')
    .eq('tenant_id', await resolveTenantId())
    .maybeSingle()

  const isAdmin = profile?.role === 'admin'
  const isSuperAdmin = (profile as any)?.is_super_admin === true
  const orgName = orgSettings?.name ?? 'DRONE'

  // Le estado de impersonation ANTES de buscar tenantData
  const impersonation = await getImpersonationState()

  const adminSupa = createAdminClient()

  // "Acessar" expirou (cookie de 4h) mas o perfil ainda aponta para a empresa: volta para a própria conta
  if (isSuperAdmin && !impersonation.active && (profile as { impersonating_tenant_id?: string | null } | null)?.impersonating_tenant_id) {
    await adminSupa.from('profiles').update({ impersonating_tenant_id: null }).eq('id', user.id)
  }

  // Abas liberadas: plano do tenant (Super Admin → Planos e abas) + ajustes do cliente.
  // Impersonation mostra exatamente o que o cliente vê; Super Admin fora dela vê tudo.
  const viewTenantId = impersonation.active && impersonation.tenantId
    ? impersonation.tenantId
    : (profile as { tenant_id?: string | null } | null)?.tenant_id ?? null
  const { features: tenantFeatures } = await getTenantFeatures(viewTenantId)
  const enabledFeatures = isSuperAdmin && !impersonation.active ? FEATURE_KEYS : tenantFeatures

  // Bloqueio de verdade: aba fora do plano não abre nem digitando o endereço
  const pathname = (await headers()).get('x-pathname') ?? ''
  const pathFeature = featureForPath(pathname)
  const blocked = !!pathFeature && !enabledFeatures.includes(pathFeature)

  // Logo dinamica
  const rawLogo = (orgSettings as any)?.logo_storage_path
  let sidebarLogoUrl = '/drone.png'
  if (rawLogo && rawLogo.trim() && rawLogo !== 'null') {
    if (rawLogo.startsWith('http')) { sidebarLogoUrl = rawLogo }
    else {
      const { data } = adminSupa.storage.from('public-assets').getPublicUrl(rawLogo)
      sidebarLogoUrl = data.publicUrl
    }
  }

  return (
    <div className="flex min-h-screen bg-background">
      {/* Banner de Impersonation */}
      {impersonation.active && (
        <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between gap-4 bg-amber-400 px-6 py-2 text-sm font-medium text-amber-900 shadow-md">
          <div className="flex items-center gap-2">
            <Eye size={16} strokeWidth={2} />
            <span>
              Voce esta visualizando como:{' '}
              <strong>{impersonation.tenantName}</strong>
            </span>
          </div>
          <form action={stopImpersonation}>
            <button
              type="submit"
              className="flex items-center gap-1.5 rounded-full bg-amber-900 px-3 py-1 text-xs font-semibold text-amber-100 hover:bg-amber-800 transition-colors"
            >
              <ArrowLeft size={12} />
              Voltar ao Super Admin
            </button>
          </form>
        </div>
      )}

      <aside className={`flex w-56 shrink-0 flex-col bg-brand-800 p-4${impersonation.active ? ' mt-9' : ''}`}>
        <div className="mb-6 flex justify-center py-4">
          <img
            src={sidebarLogoUrl}
            alt={orgName}
            className="h-8 w-auto object-contain brightness-0 invert"
          />
        </div>
        <div className="flex-1">
          <SidebarNav isAdmin={isAdmin} isSuperAdmin={isSuperAdmin} features={enabledFeatures} />
        </div>
        <div className="mt-4 border-t border-white/10 pt-3">
          <div className="flex items-center gap-1.5 px-2.5 pb-2">
            <div className="flex-1">
              <RefreshButton variant="dark" />
            </div>
            <NotificationBell userId={user.id} />
          </div>
          <p className="truncate px-2.5 text-xs text-brand-100/70">{profile?.full_name ?? user.email}</p>
          <form action={signOut}>
            <button
              type="submit"
              className="mt-1 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-brand-100/70 hover:bg-white/5 hover:text-white"
            >
              <LogOut size={16} strokeWidth={1.75} />
              Sair
            </button>
          </form>
        </div>
      </aside>
      <main className={`flex-1 p-6${impersonation.active ? ' mt-9' : ''}`}>
        {blocked ? (
          <div className="mx-auto mt-16 max-w-md rounded-xl border border-gray-200 bg-white p-8 text-center">
            <p className="text-base font-semibold text-gray-900">
              {FEATURES.find(f => f.key === pathFeature)?.label ?? 'Esta área'} não está liberada no seu plano
            </p>
            <p className="mt-2 text-sm text-gray-500">Fale com o administrador da sua licença para liberar esta aba.</p>
          </div>
        ) : children}
      </main>
      <RealtimeWatcher />
      {profile?.role === 'admin' && <AssistantPanel />}
    </div>
  )
}
