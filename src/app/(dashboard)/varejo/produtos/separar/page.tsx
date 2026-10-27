import Link from 'next/link'
import { redirect } from 'next/navigation'
import { hasFeature } from '@/lib/auth/access'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { requireTenantId } from '@/lib/tenant/context'
import { getSupportSession } from '@/lib/tenant/support'
import { needsSplit, proposeSplit } from '@/lib/retail/split'
import { SplitView, type SplitItem } from '@/components/retail/split-view'

export const dynamic = 'force-dynamic'

// Separar cores e tamanhos: linhas da planilha com várias cores/tamanhos numa célula
export default async function RetailSplitPage() {
  const access = await hasFeature('varejo')
  if (!access) redirect('/')
  const support = await getSupportSession()
  const db = await createScopedAdmin(await requireTenantId())
  const { data } = await db.from('retail_product_variants')
    .select('id, color, size, stock, product_id, retail_products!inner(code, name, status)')
    .or('color.like.*/*,size.like.*/*').limit(2000)
  type R = { id: string; color: string | null; size: string | null; stock: number; product_id: string; retail_products: { code: string; name: string; status: string } }
  const items: SplitItem[] = ((data ?? []) as unknown as R[])
    .filter(v => v.retail_products.status !== 'arquivado' && needsSplit(v.color, v.size))
    .map(v => ({ id: v.id, productId: v.product_id, code: v.retail_products.code, name: v.retail_products.name, color: v.color, size: v.size, stock: Number(v.stock), proposal: proposeSplit(v.color, v.size, Number(v.stock)) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Link href="/varejo/produtos" className="text-sm text-brand-700 hover:underline">← Produtos</Link>
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Separar cores e tamanhos</h1>
        <p className="text-sm text-gray-600">Algumas linhas da planilha vieram com várias cores ou tamanhos na mesma célula (ex.: &quot;Dark Blue / Mocha Mousse&quot;, tamanho &quot;G / G&quot;). Para o sistema isso é uma cor só: a cliente não consegue escolher e o estoque fica errado. O Drone propõe a separação; confira e confirme.</p>
      </div>
      {!access.isAdmin || support
        ? <p className="rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-700">Só a administradora da loja separa as linhas.</p>
        : <SplitView items={items} />}
    </div>
  )
}
