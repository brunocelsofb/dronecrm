import Link from 'next/link'
import { redirect } from 'next/navigation'
import { hasFeature } from '@/lib/auth/access'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { requireTenantId } from '@/lib/tenant/context'
import { getSupportSession } from '@/lib/tenant/support'
import { suggestGroups, type MergeMember } from '@/lib/retail/merge'
import { MergeView } from '@/components/retail/merge-view'

export const dynamic = 'force-dynamic'

// Juntar cores: cadastros da mesma peça (uma cor por código) viram uma peça só com várias cores
export default async function RetailMergePage() {
  const access = await hasFeature('varejo')
  if (!access) redirect('/')
  const support = await getSupportSession()
  const db = await createScopedAdmin(await requireTenantId())
  const { data } = await db.from('retail_products')
    .select('id, code, name, price, promo_price, status, photos, retail_product_variants(color, stock, active)')
    .neq('status', 'arquivado').order('name').limit(5000)
  type R = { id: string; code: string; name: string; price: number | null; promo_price: number | null; status: string; photos: string[] | null; retail_product_variants: { color: string | null; stock: number; active: boolean }[] }
  const members: MergeMember[] = ((data ?? []) as unknown as R[]).map(p => {
    const vs = (p.retail_product_variants ?? []).filter(v => v.active)
    return {
      id: p.id, code: p.code, name: p.name, status: p.status,
      price: p.price === null ? null : Number(p.price), promo_price: p.promo_price === null ? null : Number(p.promo_price),
      colors: [...new Set(vs.map(v => v.color))], photos: (p.photos ?? []).length, stock: vs.reduce((t, v) => t + Number(v.stock ?? 0), 0),
    }
  })
  const groups = suggestGroups(members)
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Link href="/varejo/produtos" className="text-sm text-brand-700 hover:underline">← Produtos</Link>
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Juntar cores</h1>
        <p className="text-sm text-gray-600">Quando cada cor foi cadastrada com um código (ex.: PROV002, PROV002-AZ, PROV002-PT), junte numa peça só. Fica 1 linha em Produtos e 1 cartão na vitrine, com as bolinhas de cor que trocam a foto.</p>
      </div>
      {!access.isAdmin || support
        ? <p className="rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-700">Só a administradora da loja junta peças.</p>
        : <MergeView groups={groups} all={members} />}
    </div>
  )
}
