import Link from 'next/link'
import { redirect } from 'next/navigation'
import { hasFeature } from '@/lib/auth/access'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { getSupportSession } from '@/lib/tenant/support'
import { ScanCount, type CountVariant } from '@/components/retail/scan-count'

export const dynamic = 'force-dynamic'

// Somar ou contar peças: à mão (busca e +1) ou com leitor de código de barras (bipa e soma)
export default async function RetailScanPage() {
  if (!(await hasFeature('varejo'))) redirect('/')
  const support = await getSupportSession()
  const db = await createScopedAdmin()
  const { data } = await db.from('retail_product_variants')
    .select('id, sku, barcode, color, size, stock, active, retail_products!inner(code, name, category, status)')
    .eq('active', true).neq('retail_products.status', 'arquivado').limit(20000)
  type R = { id: string; sku: string; barcode: string | null; color: string | null; size: string | null; stock: number; retail_products: { code: string; name: string; category: string | null } }
  const variants: CountVariant[] = ((data ?? []) as unknown as R[]).map(v => ({
    id: v.id, sku: v.sku, barcode: v.barcode, color: v.color, size: v.size, stock: Number(v.stock),
    code: v.retail_products.code, name: v.retail_products.name, category: v.retail_products.category,
  })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR') || `${a.color}${a.size}`.localeCompare(`${b.color}${b.size}`, 'pt-BR'))
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Link href="/varejo/estoque" className="text-sm text-brand-700 hover:underline">← Histórico do estoque</Link>
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Somar peças</h1>
        <p className="text-sm text-gray-600">Chegou mercadoria? Busque a peça e toque em +1, ou bipe a etiqueta com o leitor de código de barras. Nada muda no estoque até você tocar em <strong>Lançar</strong>.</p>
      </div>
      {support ? <p className="rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-700">Acesso de suporte é só leitura.</p> : <ScanCount variants={variants} />}
    </div>
  )
}
