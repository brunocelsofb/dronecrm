import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { PLATFORM_BRAND } from '@/lib/config/platform'
import { SidebarNav } from '@/components/layout/sidebar-nav'
import { signOut } from '@/lib/actions/auth'
import { RefreshButton } from '@/components/layout/refresh-button'
import { NotificationBell } from '@/components/layout/notification-bell'
import { AssistantPanel } from '@/components/assistant/assistant-panel'
import { RealtimeWatcher } from '@/components/layout/realtime-watcher'
import { LogOut, Eye, ArrowLeft } from 'lucide-react'
import { FEATURE_KEYS, FEATURES, featureForPath } from '@/lib/config/plans'
import { featuresForUser, readProfileFeatures } from '@/lib/auth/access-profiles'
import { PageFrame } from '@/components/layout/page-frame'
import { getTenantFeatures } from '@/lib/config/tenant-features'
import { headers } from 'next/headers'
import { getImpersonationState } from '@/lib/actions/impersonate'
import { getSupportSession, isStaleImpersonation } from '@/lib/tenant/support'
import { DPA_VERSION } from '@/lib/legal/dpa'
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
    .select('role, access_profile, full_name, is_super_admin, tenant_id, impersonating_tenant_id')
    .eq('id', user.id)
    .maybeSingle()

  const { data: orgSettings } = await supabase
    .from('organization_settings')
    .select('name, logo_storage_path, profile_features')
    .eq('tenant_id', await resolveTenantId())
    .maybeSingle()

  const isAdmin = profile?.role === 'admin'
  const isSuperAdmin = (profile as any)?.is_super_admin === true
  const orgName = orgSettings?.name ?? PLATFORM_BRAND.name

  // Le estado de impersonation ANTES de buscar tenantData
  const impersonation = await getImpersonationState()
  // Acesso de suporte: sem liberação válida (expirou/revogada) encerra na hora
  if (isSuperAdmin && impersonation.active && await isStaleImpersonation()) redirect('/api/support/end')
  const supportSession = isSuperAdmin && impersonation.active ? await getSupportSession() : null

  const adminSupa = createAdminClient()
  const requestPathEarly = (await headers()).get('x-pathname') ?? ''

  // "Acessar" expirou (cookie de 4h) mas o perfil ainda aponta para a empresa: volta para a própria conta
  if (isSuperAdmin && !impersonation.active && (profile as { impersonating_tenant_id?: string | null } | null)?.impersonating_tenant_id) {
    await adminSupa.from('profiles').update({ impersonating_tenant_id: null }).eq('id', user.id)
  }

  // Admin da empresa: aviso enquanto o contrato de dados da versão atual não for aceito
  let dpaPending = false
  if (isAdmin && !impersonation.active && (profile as { tenant_id?: string | null } | null)?.tenant_id) {
    const { data: acc } = await adminSupa.from('dpa_acceptances').select('id')
      .eq('tenant_id', (profile as { tenant_id: string }).tenant_id).eq('version', DPA_VERSION).maybeSingle()
    dpaPending = !acc && !requestPathEarly.startsWith('/settings/privacidade')
  }

  // Abas liberadas: plano do tenant (Super Admin → Planos e abas) + ajustes do cliente.
  // Impersonation mostra exatamente o que o cliente vê; Super Admin fora dela vê tudo.
  const viewTenantId = impersonation.active && impersonation.tenantId
    ? impersonation.tenantId
    : (profile as { tenant_id?: string | null } | null)?.tenant_id ?? null
  const { features: tenantFeatures } = await getTenantFeatures(viewTenantId)
  const planFeatures = isSuperAdmin && !impersonation.active ? FEATURE_KEYS : tenantFeatures
  // Perfil de acesso: Admin (e Super Admin) vê o plano inteiro; os demais, plano ∩ perfil
  const enabledFeatures = featuresForUser({
    isAdmin: isAdmin || isSuperAdmin,
    profile: (profile as { access_profile?: string | null } | null)?.access_profile,
    planFeatures,
    matrix: readProfileFeatures((orgSettings as { profile_features?: unknown } | null)?.profile_features),
  })

  // Logo dinamica
  const rawLogo = (orgSettings as any)?.logo_storage_path
  let sidebarLogoUrl: string = PLATFORM_BRAND.logoUrl
  if (rawLogo && rawLogo.trim() && rawLogo !== 'null') {
    if (rawLogo.startsWith('http')) { sidebarLogoUrl = rawLogo }
    else {
      const { data } = adminSupa.storage.from('public-assets').getPublicUrl(rawLogo)
      sidebarLogoUrl = data.publicUrl
    }
  }

  // Aba fora do plano, aberta direto pelo endereço: nem carrega o conteúdo
  const requestPath = (await headers()).get('x-pathname') ?? ''
  const requestFeature = featureForPath(requestPath)
  if (requestFeature && !enabledFeatures.includes(requestFeature)) {
    // Vai para a primeira aba liberada (Configurações só abre para Admin;
    // sem nenhuma aba, "Minha conta", que é sempre liberada)
    const reason = planFeatures.includes(requestFeature) ? 'perfil' : 'plano'
    const first = FEATURES.find(f => enabledFeatures.includes(f.key))
    const target = isAdmin || isSuperAdmin ? '/settings' : first ? first.paths[0] : '/minha-conta'
    redirect(`${target}?bloqueado=${encodeURIComponent(requestFeature)}&motivo=${reason}`)
  }

  return (
    <div className="flex min-h-screen bg-background">
      {/* Banner de Impersonation */}
      {impersonation.active && (
        <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between gap-4 bg-amber-400 px-6 py-2 text-sm font-medium text-amber-900 shadow-md">
          <div className="flex items-center gap-2">
            <Eye size={16} strokeWidth={2} />
            <span>
              Acesso de suporte (só leitura) em{' '}
              <strong>{impersonation.tenantName}</strong>
              {supportSession && <> · liberado até {new Date(supportSession.grant.expiresAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · cada tela fica registrada para a empresa</>}
            </span>
          </div>
          {/* Sair por GET: em sessão de suporte toda ação (POST) é bloqueada no proxy */}
          <a
            href="/api/support/end?saida=1"
            className="flex items-center gap-1.5 rounded-full bg-amber-900 px-3 py-1 text-xs font-semibold text-amber-100 no-underline hover:bg-amber-800 transition-colors"
          >
            <ArrowLeft size={12} />
            Voltar ao Super Admin
          </a>
        </div>
      )}

      {/* Barra fina de ícones (fixa na lateral); cada grupo abre a continuação ao lado */}
      <aside className={`sticky z-40 flex w-[88px] shrink-0 flex-col bg-brand-800 px-2 py-3 ${impersonation.active ? 'top-9 mt-9 h-[calc(100vh-2.25rem)]' : 'top-0 h-screen'}`}>
        <div className="mb-3 flex justify-center py-2">
          {/\.(jpe?g)(\?|$)/i.test(sidebarLogoUrl) ? (
            // JPG tem fundo: mostra com as cores originais
            <img src={sidebarLogoUrl} alt={orgName} className="h-7 w-auto max-w-[68px] rounded object-contain" />
          ) : (
            // PNG/SVG transparente: fica branco no fundo escuro
            <img src={sidebarLogoUrl} alt={orgName} className="h-7 w-auto max-w-[68px] object-contain brightness-0 invert" />
          )}
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          <SidebarNav isAdmin={isAdmin} isSuperAdmin={isSuperAdmin} features={enabledFeatures} />
        </div>
        <div className="mt-2 border-t border-white/10 pt-2">
          <div className="flex items-center justify-center gap-1 pb-1.5">
            <RefreshButton variant="rail" />
            <NotificationBell userId={user.id} />
          </div>
          <div className="flex items-center justify-center gap-1">
            <Link
              href="/minha-conta"
              title={`${profile?.full_name ?? user.email} — Minha conta`}
              aria-label="Minha conta"
              className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-[11px] font-semibold text-white hover:bg-white/20"
            >
              {initials(profile?.full_name ?? user.email ?? '')}
            </Link>
            <form action={signOut}>
              <button
                type="submit"
                title="Sair"
                aria-label="Sair"
                className="flex items-center justify-center rounded-md p-1.5 text-brand-100/70 hover:bg-white/5 hover:text-white"
              >
                <LogOut size={16} strokeWidth={1.75} />
              </button>
            </form>
          </div>
        </div>
      </aside>
      <main className={`min-w-0 flex-1 p-6${impersonation.active ? ' mt-9' : ''}`}>
        {dpaPending && (
          <a href="/settings/privacidade" className="mb-4 block rounded-lg border border-warn-600/40 bg-warn-100 px-4 py-2 text-sm text-warn-700 no-underline hover:border-warn-600">
            Falta aceitar o Contrato de tratamento de dados (LGPD) da sua empresa. Leia e aceite em Configurações → Privacidade e dados →
          </a>
        )}
        {/* Bloqueio no navegador (trocar de tela pelo menu); pelo endereço, o redirect acima */}
        <PageFrame enabledFeatures={enabledFeatures} planFeatures={planFeatures}>{children}</PageFrame>
      </main>
      <RealtimeWatcher />
      {profile?.role === 'admin' && <AssistantPanel />}
    </div>
  )
}

// Iniciais do usuário para o atalho "Minha conta" na barra
function initials(name: string) {
  const parts = name.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?'
}
