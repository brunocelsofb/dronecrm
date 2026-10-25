// Lista do histórico do estoque (servidor): quando, peça, variação, tipo, mudança, quem
import Link from 'next/link'
import { STOCK_KINDS, stockKindLabel } from '@/lib/retail/stock'

export type StockMove = {
  id: string; created_at: string; kind: string; delta: number; before_qty: number; after_qty: number; note: string | null
  order_id: string | null; order_number: number | null; product_id: string | null; product: string | null; variant: string | null; by: string | null
}
const fmtDT = (d: string) => new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })

export function StockHistory({ moves, showProduct = true }: { moves: StockMove[]; showProduct?: boolean }) {
  if (!moves.length) return <p className="text-sm text-gray-500">Nenhuma movimentação ainda.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] text-sm">
        <thead className="text-left text-xs text-gray-500">
          <tr><th className="py-1.5 pr-3">Quando</th>{showProduct && <th className="py-1.5 pr-3">Peça</th>}<th className="py-1.5 pr-3">Variação</th><th className="py-1.5 pr-3">Tipo</th><th className="py-1.5 pr-3 text-right">Mudança</th><th className="py-1.5 pr-3 text-right">Saldo</th><th className="py-1.5">Quem / origem</th></tr>
        </thead>
        <tbody className="tabular-nums">
          {moves.map(m => (
            <tr key={m.id} className="border-t border-gray-100 align-top">
              <td className="py-1.5 pr-3 whitespace-nowrap text-gray-600">{fmtDT(m.created_at)}</td>
              {showProduct && <td className="py-1.5 pr-3">{m.product_id ? <Link href={`/varejo/produtos/${m.product_id}`} className="text-gray-900 hover:text-brand-700">{m.product ?? '—'}</Link> : <span className="text-gray-400">peça apagada</span>}</td>}
              <td className="py-1.5 pr-3 text-gray-700">{m.variant ?? '—'}</td>
              <td className="py-1.5 pr-3"><span className={`rounded px-1.5 py-0.5 text-[11px] ${STOCK_KINDS[m.kind]?.style ?? 'bg-gray-100 text-gray-700'}`}>{stockKindLabel(m.kind)}</span></td>
              <td className={`py-1.5 pr-3 text-right font-medium ${m.delta >= 0 ? 'text-positive-700' : 'text-negative-700'}`}>{m.delta > 0 ? '+' : ''}{m.delta}</td>
              <td className="py-1.5 pr-3 text-right whitespace-nowrap text-gray-700">{m.before_qty} → {m.after_qty}</td>
              <td className="py-1.5 text-xs text-gray-600">{m.order_id ? <Link href={`/varejo/pedidos/${m.order_id}`} className="text-brand-700 hover:underline">pedido nº {m.order_number ?? '?'}</Link> : (m.by ?? 'sistema')}{m.note ? <span className="block text-gray-400">{m.note}</span> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
