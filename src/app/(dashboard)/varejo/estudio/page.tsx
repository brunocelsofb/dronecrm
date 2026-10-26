import { redirect } from 'next/navigation'
import { hasFeature } from '@/lib/auth/access'
import { requireTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { getSupportSession } from '@/lib/tenant/support'
import { retailPhotoUrl } from '@/lib/retail/products'
import { readOccasions } from '@/lib/retail/storefront'
import { readPhotoMeta } from '@/lib/retail/photo-colors'
import { StudioView, type StudioImage, type StudioProduct } from '@/components/retail/studio-view'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export default async function RetailStudioPage() {
  const access = await hasFeature('varejo')
  if (!access) redirect('/')
  const support = await getSupportSession()
  if (!access.isAdmin || support) {
    return (
      <div className="mx-auto max-w-2xl space-y-3">
        <h1 className="text-xl font-semibold text-gray-900">Estúdio IA</h1>
        <p className="rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-700">O Estúdio IA é usado só pela administradora da loja, com a conta de IA dela.</p>
      </div>
    )
  }
  const tenantId = await requireTenantId()
  const db = await createScopedAdmin(tenantId)
  const [{ data: conns }, { data: imgs }, { data: prods }, { data: looks }, { data: sf }] = await Promise.all([
    db.from('retail_ai_connections').select('provider, key_last4, model').eq('user_id', access.userId),
    db.from('retail_ai_images').select('id, kind, title, path, provider, model, created_at, copy, inputs').order('created_at', { ascending: false }).limit(300),
    db.from('retail_products').select('id, code, name, photos, photo_meta, status, retail_product_variants(color, active)').neq('status', 'arquivado').order('name').limit(2000),
    db.from('retail_looks').select('id, name, cover_photo').order('position').limit(200),
    db.from('retail_storefronts').select('occasions').maybeSingle(),
  ])
  const images: StudioImage[] = (imgs ?? []).map(i => {
    const inp = (i.inputs ?? {}) as { pieces?: { product_id?: string }[]; target?: { product_id?: string; color?: string | null } | null }
    return {
      id: i.id as string, kind: i.kind as StudioImage['kind'], title: i.title as string | null, url: retailPhotoUrl(i.path as string), provider: i.provider as string, created_at: i.created_at as string, copy: (i.copy as StudioImage['copy']) ?? null,
      pieces: [...new Set((inp.pieces ?? []).map(x => String(x.product_id ?? '')).filter(Boolean))],
      target: inp.target?.product_id ? { product_id: String(inp.target.product_id), color: inp.target.color ?? null } : null,
    }
  })
  const products: StudioProduct[] = (prods ?? []).map(p => {
    const paths = ((p.photos ?? []) as string[]).filter(x => typeof x === 'string' && x)
    const colors = [...new Set(((p.retail_product_variants ?? []) as { color: string | null; active: boolean }[]).filter(v => v.active && v.color).map(v => v.color as string))]
    const meta = readPhotoMeta(p.photo_meta, paths, colors)
    return {
      id: p.id as string, code: p.code as string, name: p.name as string, status: p.status as string, colors, meta,
      paths, photos: paths.map(ph => (/^https:\/\//.test(ph) ? ph : retailPhotoUrl(ph))),
    }
  })
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Estúdio IA</h1>
        <p className="text-sm text-gray-600">Crie fotos de look sem precisar de sessão de fotos: uma modelo virtual (pessoa que não existe) veste as suas peças num cenário. Tudo com a sua conta de IA, e fica guardado no banco de imagens da loja para publicar.</p>
      </div>
      <StudioView
        connections={(conns ?? []).map(c => ({ provider: c.provider as 'gemini' | 'openai', last4: c.key_last4 as string | null, model: c.model as string | null }))}
        images={images} products={products} looks={(looks ?? []).map(l => ({ id: l.id as string, name: l.name as string }))}
        occasions={readOccasions(sf?.occasions).map(o => ({ id: o.id, name: o.name }))}
      />
    </div>
  )
}
