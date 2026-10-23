import { getPublicBranding, getPlatformBranding } from '@/lib/utils/public-branding'
import { tenantIdForSlug } from '@/lib/tenant/context'
import { PLATFORM_BRAND } from '@/lib/config/platform'
import { LoginForm } from './login-form'

export const dynamic = 'force-dynamic'

// Login comum mostra a marca do produto; ?empresa=<slug> mostra o logo e o nome daquela empresa.
// O fundo é sempre o da plataforma (definido pelo Super Admin em Papéis de Parede).
// Depois de entrar, o CRM usa sempre a empresa do usuário (não depende deste link).
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ empresa?: string }> }) {
  const { empresa } = await searchParams
  const tenantId = empresa ? await tenantIdForSlug(empresa) : null
  // Fundo e cor do login são sempre da plataforma (Super Admin); ?empresa só troca logo e nome
  const platform = await getPlatformBranding()
  const brand = tenantId ? await getPublicBranding(tenantId) : platform
  const { wallpaperUrl, loginBgUrl, bgColor } = platform
  const { logoUrl, companyName } = brand

  const bgStyle = {
    backgroundColor: bgColor,
    backgroundImage: (loginBgUrl || wallpaperUrl) ? `url('${loginBgUrl || wallpaperUrl}')` : undefined,
    backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat',
  }

  return (
    <div className="relative min-h-screen w-full">
      <div className="fixed inset-0 pointer-events-none -z-10" style={bgStyle} />
      <main className="min-h-screen w-full flex flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm flex flex-col gap-5">
          <div className="w-full rounded-2xl bg-white/97 shadow-2xl overflow-hidden">
            <div className="p-6 pb-0">
              <div className="w-full border-b-4 border-[#E98C5F] pb-4 mb-6 flex flex-row items-center justify-between gap-4">
                <div className="flex-shrink-0">
                  <img
                    src={logoUrl || PLATFORM_BRAND.logoUrl}
                    alt={companyName}
                    className="h-10 md:h-12 w-auto object-contain"
                  />
                </div>
                <div className="text-right flex-1">
                  <h1 className="text-xl font-bold text-[#1B556B]">Entrar</h1>
                </div>
              </div>
            </div>
            <div className="p-6 pt-0">
              <LoginForm />
            </div>
          </div>
          <p className="text-center text-xs text-white/40">{companyName} © {new Date().getFullYear()}</p>
        </div>
      </main>
    </div>
  )
}
