import Link from 'next/link'
import { redirect } from 'next/navigation'
import { hasFeature } from '@/lib/auth/access'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { getSupportSession } from '@/lib/tenant/support'
import { retailPhotoUrl } from '@/lib/retail/products'
import { readPhotoMeta } from '@/lib/retail/photo-colors'
import { nameKey } from '@/lib/retail/merge'
import { readiness } from '@/lib/retail/readiness'
import { ReadyBoard, type ReadyItem } from '@/components/retail/ready-board'

export const dynamic = 'force-dynamic'

// Pronta para vender: cada peça com o que falta, na ordem, e um botão para resolver
export default async function RetailReadyPage() {
  if (!(await hasFeature('varejo'))) redirect('/')
  const support = await getSupportSession()
  const db = await createScopedAdmin()
  const { data } = await db.from('retail_products')
    .select('id, code, name, category, status, price, photos, photo_meta, retail_product_variants(color, size, stock, active)')
    .neq('status', 'arquivado').order('name').limit(5000)
  type R = { id: string; code: string; name: string; category: string | null; status: string; price: number | null; photos: string[] | null; photo_meta: unknown; retail_product_variants: { color: string | null; size: string | null; stock: number; active: boolean }[] }
  const rows = (data ?? []) as unknown as R[]
  const names = new Map<string, number>()
  for (const r of rows) names.set(nameKey(r.name), (names.get(nameKey(r.name)) ?? 0) + 1)
  const items: ReadyItem[] = rows.map(r => {
    const photos = (r.photos ?? []).filter(x => typeof x === 'string' && x)
    const vs = r.retail_product_variants ?? []
    const colors = [...new Set(vs.filter(v => v.active && v.color).map(v => v.color as string))]
    const meta = readPhotoMeta(r.photo_meta, photos, colors)
    const rd = readiness({ status: r.status, price: r.price === null ? null : Number(r.price), duplicated: (names.get(nameKey(r.name)) ?? 0) > 1, photos, meta, variants: vs })
    const joined = vs.some(v => v.active && (/\//.test(v.color ?? '') || /\//.test(v.size ?? '')))
    return {
      id: r.id, code: r.code, name: r.name, category: r.category, status: r.status, thumb: photos[0] ? (/^https:\/\//.test(photos[0]) ? photos[0] : retailPhotoUrl(photos[0])) : null,
      colors: colors.length, stock: vs.filter(v => v.active).reduce((t, v) => t + Number(v.stock ?? 0), 0),
      steps: rd.steps, next: rd.next, ready: rd.ready, blocking: rd.blocking, joined,
    }
  })
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Link href="/varejo/produtos" className="text-sm text-brand-700 hover:underline">← Produtos</Link>
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Pronta para vender</h1>
        <p className="text-sm text-gray-600">Cada peça mostra o que falta para aparecer certinha no site. Toque em <strong>Resolver</strong>: o Drone leva direto ao lugar certo. As que estão mais perto de ficar prontas aparecem primeiro.</p>
      </div>
      <ReadyBoard items={items} readOnly={!!support} />
    </div>
  )
}
