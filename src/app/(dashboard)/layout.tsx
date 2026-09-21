import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { SidebarNav } from '@/components/layout/sidebar-nav'
import { signOut } from '@/lib/actions/auth'
import { RefreshButton } from '@/components/layout/refresh-button'
import { NotificationBell } from '@/components/layout/notification-bell'
import { AssistantPanel } from '@/components/assistant/assistant-panel'
import { RealtimeWatcher } from '@/components/layout/realtime-watcher'
import { LogOut } from 'lucide-react'
import { getEffectivePlan } from '@/lib/config/plans'

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
    .select('role, full_name, is_super_admin')
    .eq('id', user.id)
    .maybeSingle()

  const { data: orgSettings } = await supabase
    .from('organization_settings')
    .select('name, logo_storage_path')
    .eq('id', 'default')
    .maybeSingle()

  // Busca plano e trial do tenant atual
  const { data: tenantData } = await supabase
    .from('tenants')
    .select('plan, trial_ends_at')
    .maybeSingle()

  const isAdmin = profile?.role === 'admin'
  const isSuperAdmin = (profile as any)?.is_super_admin === true
  const orgName = orgSettings?.name ?? 'DRONE'

  // Plano efetivo: se ainda estiver em trial, libera enterprise
  const effectivePlan = getEffectivePlan(
    tenantData?.plan ?? 'starter',
    tenantData?.trial_ends_at ?? null
  )

  // Logo dinamica: storage path -> URL publica, fallback /drone.png
  const adminSupa = (await import('@/lib/supabase/admin')).createAdminClient()
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
      <aside className="flex w-56 shrink-0 flex-col bg-brand-800 p-4">
        <div className="mb-6 flex justify-center py-4">
          <img
            src={sidebarLogoUrl}
            alt={orgName}
            className="h-8 w-auto object-contain brightness-0 invert"
          />
        </div>
        <div className="flex-1">
          <SidebarNav isAdmin={isAdmin} isSuperAdmin={isSuperAdmin} effectivePlan={effectivePlan} />
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
      <main className="flex-1 p-6">{children}</main>
      <RealtimeWatcher />
      {profile?.role === 'admin' && <AssistantPanel />}
    </div>
  )
}
