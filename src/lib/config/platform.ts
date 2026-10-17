// ─── Marca do produto (plataforma) ────────────────────────────────────────────
// Usada onde ainda não se sabe a empresa (login comum) e como reserva quando a
// empresa não tem logo. A marca de cada empresa fica em organization_settings.
// Para trocar o logo oficial: substitua public/drone.svg (ou aponte logoUrl para o novo arquivo).

export const PLATFORM_BRAND = {
  name: 'Comercial Drone',
  logoUrl: '/drone.svg',
  bgColor: '#1B556B',
} as const

// Link de login com a marca de uma empresa (o slug vem de tenants.slug)
export function tenantLoginPath(slug: string): string {
  return `/login?empresa=${encodeURIComponent(slug)}`
}
