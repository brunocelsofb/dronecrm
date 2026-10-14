import { createAdminClient } from '@/lib/supabase/admin'
import { SupportForm } from './support-form'
import { LogoBadge } from '@/components/ui/logo-badge'
import { resolvePublicTenantId } from '@/lib/tenant/context'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

export default async function PublicSupportPage({ searchParams }: { searchParams: Promise<{ empresa?: string }> }) {
  const { empresa } = await searchParams
  const tenantId = await resolvePublicTenantId(empresa ?? null)
  const admin = createAdminClient()
  const { data: settings } = await admin
    .from('organization_settings')
    .select('support_bg_url, company_name, logo_storage_path, public_bg_color')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  const rawLogo = settings?.logo_storage_path
  const rawWallpaper = settings?.support_bg_url
  const bgColor = (settings as any)?.public_bg_color || '#1B556B'

  let finalLogoUrl: string | null = null
  if (rawLogo && rawLogo.trim() && rawLogo !== 'null') {
    if (rawLogo.startsWith('http')) { finalLogoUrl = rawLogo }
    else {
      const { data } = admin.storage.from('public-assets').getPublicUrl(rawLogo)
      finalLogoUrl = data.publicUrl
    }
  }

  const wallpaperUrl = (rawWallpaper && rawWallpaper.startsWith('https://')) ? rawWallpaper : null

  const bgStyle = {
    backgroundColor: bgColor,
    backgroundImage: wallpaperUrl ? `url('${wallpaperUrl}')` : undefined,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
  }

  return (
    <div className="relative min-h-screen w-full">
      <div className="fixed inset-0 pointer-events-none -z-10" style={bgStyle} />
      <main className="min-h-screen w-full flex flex-col items-center justify-start py-12 px-4">
        <div className="w-full max-w-2xl flex flex-col gap-5">
          <div className="w-full rounded-2xl bg-white/97 shadow-2xl overflow-hidden">
            <div className="p-6 pb-0">
              <div className="w-full border-b-4 border-[#E98C5F] pb-4 mb-6 flex flex-row items-center justify-between gap-4">
                <div className="flex-shrink-0">
                  <LogoBadge src={finalLogoUrl ?? undefined} />
                </div>
                <div className="flex flex-col items-end text-right">
                  <h1 className="text-xl md:text-2xl font-bold text-[#1B556B]">Abrir chamado de suporte</h1>
                  <p className="text-xs md:text-sm font-medium text-[#32AF9D] mt-1">Conta pra gente o que está acontecendo.</p>
                </div>
              </div>
            </div>
            <div className="p-6 pt-0">
              <SupportForm empresa={empresa} />
            </div>
          </div>
          <p className="text-center text-xs text-white/40">
            {settings?.company_name ?? 'ORBIS Engenharia'} © {new Date().getFullYear()}
          </p>
        </div>
      </main>
    </div>
  )
}
