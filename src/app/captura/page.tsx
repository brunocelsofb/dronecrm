import { getPublicBranding } from '@/lib/utils/public-branding'
import { LeadCaptureForm } from '@/components/leads/lead-capture-form'
import { LogoBadge } from '@/components/ui/logo-badge'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePublicTenantId } from '@/lib/tenant/context'

export const dynamic = 'force-dynamic'

export default async function PublicCapturePage({ searchParams }: { searchParams: Promise<{ phone?: string; empresa?: string }> }) {
  const { phone, empresa } = await searchParams
  const tenantId = await resolvePublicTenantId(empresa ?? null)

  const { wallpaperUrl, bgColor, logoUrl, companyName } = await getPublicBranding(tenantId)

  // lead_bg_url tem prioridade sobre support_bg_url
  const admin = createAdminClient()
  const { data: s } = await admin
    .from('organization_settings')
    .select('lead_bg_url')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  const leadBg = (s as any)?.lead_bg_url
  const finalWallpaper = (leadBg && leadBg.startsWith('https://')) ? leadBg : wallpaperUrl

  const bgStyle = {
    backgroundColor: bgColor,
    backgroundImage: finalWallpaper ? `url('${finalWallpaper}')` : undefined,
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
                  <LogoBadge src={logoUrl ?? undefined} />
                </div>
                <div className="flex flex-col items-end text-right">
                  <h1 className="text-xl md:text-2xl font-bold text-[#1B556B]">Fale com a gente</h1>
                  <p className="text-xs md:text-sm font-medium text-[#32AF9D] mt-1">
                    Preencha os dados abaixo e entraremos em contato.
                  </p>
                </div>
              </div>
            </div>
            <div className="p-6 pt-0">
              <LeadCaptureForm defaultPhone={phone} empresa={empresa} />
            </div>
          </div>
          <p className="text-center text-xs text-white/40">
            {companyName} © {new Date().getFullYear()}
          </p>
        </div>
      </main>
    </div>
  )
}
