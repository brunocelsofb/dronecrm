// ─── Marca do produto (plataforma) ────────────────────────────────────────────
// Usada onde ainda não se sabe a empresa (login comum) e como reserva quando a
// empresa não tem logo. A marca de cada empresa fica em organization_settings.
// Logo oficial em public/drone-logo.png. O fundo do login comum vem das configurações
// da conta da plataforma (empresa do Super Admin → Papéis de parede), não fica fixo aqui.

export const PLATFORM_BRAND = {
  name: 'Comercial Drone',
  logoUrl: '/drone-logo.png',
  bgColor: '#1B556B',
} as const

// Link de login com a marca de uma empresa (o slug vem de tenants.slug)
export function tenantLoginPath(slug: string): string {
  return `/login?empresa=${encodeURIComponent(slug)}`
}
