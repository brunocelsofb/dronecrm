import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { WallpaperManager } from '@/components/settings/wallpaper-manager'
import { resolveTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { isPlatformOwner } from '@/lib/auth/platform-owner'

export default async function WallpapersPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') redirect('/settings')

  const admin = (await createScopedAdmin())
  const { data: s } = await admin
    .from('organization_settings')
    .select('login_bg_url, support_bg_url, nps_bg_url, survey_clinica_bg_url, survey_hospitalar_bg_url, lead_bg_url, public_bg_color')
    .eq('tenant_id', await resolveTenantId())
    .maybeSingle()

  // Fundo do login comum é da plataforma: só o Super Admin, na própria conta, vê e muda
  const platformOwner = await isPlatformOwner()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Papéis de Parede</h1>
        <p className="mt-0.5 text-sm text-gray-500">{platformOwner ? 'Imagens de fundo das telas públicas e da tela de login (a tela de login vale para todas as empresas).' : 'Imagens de fundo das telas públicas da sua empresa. A tela de login é a mesma para todas as empresas e é definida pela plataforma.'}</p>
      </div>
      <WallpaperManager
        loginBgUrl={(s as any)?.login_bg_url ?? null}
        showLogin={platformOwner}
        supportBgUrl={(s as any)?.support_bg_url ?? null}
        npsBgUrl={(s as any)?.nps_bg_url ?? null}
        clinicaBgUrl={(s as any)?.survey_clinica_bg_url ?? null}
        hospitalarBgUrl={(s as any)?.survey_hospitalar_bg_url ?? null}
        leadBgUrl={(s as any)?.lead_bg_url ?? null}
        bgColor={(s as any)?.public_bg_color ?? '#1B556B'}
      />
    </div>
  )
}
