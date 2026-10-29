import Link from 'next/link'
import { redirect } from 'next/navigation'
import { hasFeature } from '@/lib/auth/access'
import { requireTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { getSupportSession } from '@/lib/tenant/support'
import { retailPhotoUrl } from '@/lib/retail/products'
import { readContent, readOccasions, readTheme, cleanSlug } from '@/lib/retail/storefront'
import { StorefrontAdmin, type LookRow, type ProductOption } from '@/components/retail/storefront-admin'

export const dynamic = 'force-dynamic'

export default async function RetailStorefrontPage() {
  const access = await hasFeature('varejo')
  if (!access) redirect('/')
  const tenantId = await requireTenantId()
  const db = await createScopedAdmin(tenantId)
  const [{ data: sf }, { data: org }, { data: prods }, { data: looks }, support] = await Promise.all([
    db.from('retail_storefronts').select('enabled, slug, domains, whatsapp, title, tagline, about, hero_photo, hero_photo_mobile, content, occasions, theme').eq('tenant_id', tenantId).maybeSingle(),
    db.from('organization_settings').select('company_name, name').eq('tenant_id', tenantId).maybeSingle(),
    db.from('retail_products').select('id, code, name, category, status, photos, occasions').neq('status', 'arquivado').order('name').limit(2000),
    db.from('retail_looks').select('id, name, occasion, description, product_ids, cover_photo, active, position').order('position').order('created_at').limit(200),
    getSupportSession(),
  ])
  const company = ((org?.company_name as string | null) || (org?.name as string | null) || '').trim()
  const products: ProductOption[] = ((prods ?? []) as { id: string; code: string; name: string; category: string | null; status: string; photos: string[] | null; occasions: string[] | null }[])
    .map(p => ({ id: p.id, code: p.code, name: p.name, category: p.category, published: p.status === 'publicado', photo: p.photos?.[0] ? retailPhotoUrl(p.photos[0]) : null, occasions: p.occasions ?? [] }))
  // Endereço da vitrine publicada na Cloudflare (da plataforma, igual para todas as lojas)
  const base = (process.env.NEXT_PUBLIC_STOREFRONT_URL ?? '').replace(/\/+$/, '') || null

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <Link href="/varejo/configurar" className="block text-sm text-brand-700 hover:underline">← Configurar loja</Link>
        <h1 className="text-xl font-semibold text-gray-900">Vitrine</h1>
        <p className="mt-1 text-sm text-gray-500">A landing da loja: as clientes escolhem por ocasião, montam a sacola, fazem um cadastro rápido e caem no seu WhatsApp. O pedido entra sozinho no Funil da loja como &quot;Novo pedido&quot;.</p>
      </div>
      <StorefrontAdmin
        initial={{
          enabled: !!sf?.enabled, slug: (sf?.slug as string | undefined) ?? cleanSlug(company) ?? '', domains: (sf?.domains as string[] | undefined) ?? [],
          whatsapp: (sf?.whatsapp as string | null) ?? '', title: (sf?.title as string | null) ?? company, tagline: (sf?.tagline as string | null) ?? '',
          about: (sf?.about as string | null) ?? '', hero_photo: (sf?.hero_photo as string | null) ?? null, hero_photo_mobile: (sf?.hero_photo_mobile as string | null) ?? null, content: readContent(sf?.content),
          occasions: readOccasions(sf?.occasions), theme: readTheme(sf?.theme),
        }}
        saved={!!sf}
        products={products}
        looks={(looks ?? []) as LookRow[]}
        storefrontBase={base}
        isAdmin={!!access.isAdmin && !support}
        canEdit={!support}
      />
    </div>
  )
}
