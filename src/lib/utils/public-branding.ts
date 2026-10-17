import { createAdminClient } from '@/lib/supabase/admin'
import { resolveTenantId } from '@/lib/tenant/context'
import { PLATFORM_BRAND } from '@/lib/config/platform'

export type PublicBranding = {
  wallpaperUrl: string | null
  loginBgUrl: string | null
  bgColor: string
  logoUrl: string | null
  companyName: string
}

export async function getPublicBranding(tenantId?: string | null): Promise<PublicBranding> {
  const admin = createAdminClient()
  const { data: s } = await admin
    .from('organization_settings')
    .select('support_bg_url, login_bg_url, logo_storage_path, logo_url, company_name, public_bg_color')
    .eq('tenant_id', tenantId ?? await resolveTenantId())
    .maybeSingle()

  // Logo: prioridade logo_url (URL direta) > logo_storage_path (bucket) > logo do produto (reserva)
  let logoUrl: string | null = PLATFORM_BRAND.logoUrl

  const directUrl = (s as any)?.logo_url
  if (directUrl && directUrl.startsWith('http')) {
    logoUrl = directUrl
  } else {
    const rawLogo = s?.logo_storage_path
    if (rawLogo && rawLogo.trim() && rawLogo !== 'null') {
      if (rawLogo.startsWith('http')) { logoUrl = rawLogo }
      else {
        const { data } = admin.storage.from('public-assets').getPublicUrl(rawLogo)
        logoUrl = data.publicUrl
      }
    }
  }

  const rawBg = s?.support_bg_url
  const wallpaperUrl = (rawBg && rawBg.startsWith('https://')) ? rawBg : null

  const rawLogin = (s as any)?.login_bg_url
  const loginBgUrl = (rawLogin && rawLogin.startsWith('https://')) ? rawLogin : null

  return {
    wallpaperUrl,
    loginBgUrl,
    bgColor: (s as any)?.public_bg_color || '#1B556B',
    logoUrl,
    companyName: s?.company_name ?? PLATFORM_BRAND.name,
  }
}

// Login comum (ainda não se sabe a empresa): logo e nome do produto; fundo e cor
// da conta da plataforma (empresa do Super Admin), editáveis nas Configurações dela.
export async function getPlatformBranding(): Promise<PublicBranding> {
  const admin = createAdminClient()
  const { data: sa } = await admin.from('profiles').select('tenant_id').eq('is_super_admin', true).not('tenant_id', 'is', null).limit(1).maybeSingle()
  const base: PublicBranding = { wallpaperUrl: null, loginBgUrl: null, bgColor: PLATFORM_BRAND.bgColor, logoUrl: PLATFORM_BRAND.logoUrl, companyName: PLATFORM_BRAND.name }
  if (!sa?.tenant_id) return base
  const b = await getPublicBranding(sa.tenant_id as string)
  return { ...base, wallpaperUrl: b.wallpaperUrl, loginBgUrl: b.loginBgUrl, bgColor: b.bgColor }
}
