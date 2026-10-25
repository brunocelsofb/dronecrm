import Link from 'next/link'
import { redirect } from 'next/navigation'
import { hasFeature } from '@/lib/auth/access'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { STOCK_KINDS } from '@/lib/retail/stock'
import { loadStockMoves } from '@/lib/retail/stock-server'
import { StockHistory } from '@/components/retail/stock-history'

export const dynamic = 'force-dynamic'

export default async function RetailStockHistoryPage({ searchParams }: { searchParams: Promise<{ tipo?: string }> }) {
  if (!(await hasFeature('varejo'))) redirect('/')
  const { tipo } = await searchParams
  const kind = tipo && STOCK_KINDS[tipo] ? tipo : null
  const db = await createScopedAdmin()
  const moves = await loadStockMoves(db, { kind, limit: 300 })
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Link href="/varejo/produtos" className="text-sm text-brand-700 hover:underline">← Produtos</Link>
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Histórico do estoque</h1>
        <p className="text-sm text-gray-500">Toda mudança de saldo, com o motivo, quem fez e o saldo antes e depois. Mostra as 300 mais recentes.</p>
      </div>
      <div className="flex flex-wrap gap-2 text-sm">
        <Link href="/varejo/estoque" className={`rounded-full border px-3 py-1 ${!kind ? 'border-brand-700 bg-brand-100 text-brand-800' : 'border-gray-300 text-gray-700'}`}>Todos</Link>
        {Object.entries(STOCK_KINDS).map(([k, v]) => (
          <Link key={k} href={`/varejo/estoque?tipo=${k}`} className={`rounded-full border px-3 py-1 ${kind === k ? 'border-brand-700 bg-brand-100 text-brand-800' : 'border-gray-300 text-gray-700'}`}>{v.label}</Link>
        ))}
      </div>
      <section className="rounded-xl border border-gray-200 bg-white p-4"><StockHistory moves={moves} /></section>
    </div>
  )
}
