// Aviso de pagamento do Varejo (InfinitePay ou Mercado Pago).
// O aviso só indica qual pagamento olhar: o Drone confere direto no serviço, com a
// conta da loja dona do pedido, antes de marcar Pago. Aviso falso não fecha pedido.
import { NextResponse, type NextRequest } from 'next/server'
import { confirmRetailPayment, orderByToken } from '@/lib/retail/checkout-server'
import { loadPaymentAccounts, verifyInfinitePay, verifyMercadoPago } from '@/lib/retail/payment-providers'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const ok = () => NextResponse.json({ ok: true })

export async function POST(req: NextRequest, { params }: { params: Promise<{ provider: string; token: string }> }) {
  const { provider, token } = await params
  if (provider !== 'infinitepay' && provider !== 'mercadopago') return NextResponse.json({ error: 'not found' }, { status: 404 })
  const order = await orderByToken(token)
  if (!order) return ok() // pedido inexistente: responde 200 para o serviço não insistir
  let body: Record<string, unknown> = {}
  try { body = await req.json() as Record<string, unknown> } catch { body = {} }
  const accounts = await loadPaymentAccounts(order.tenant_id)

  try {
    if (provider === 'infinitepay') {
      const str = (k: string) => (typeof body[k] === 'string' || typeof body[k] === 'number' ? String(body[k]) : '')
      const order_nsu = str('order_nsu'), transaction_nsu = str('transaction_nsu'), slug = str('invoice_slug') || str('slug')
      if (!order_nsu || !transaction_nsu || !slug || !order.payment_links?.[order_nsu]) return ok()
      const v = await verifyInfinitePay(accounts, { order_nsu, transaction_nsu, slug, receipt_url: str('receipt_url') || null })
      if (!v) return NextResponse.json({ error: 'verificação indisponível' }, { status: 400 }) // a InfinitePay tenta de novo
      await confirmRetailPayment(order, 'infinitepay', v)
      return ok()
    }
    // Mercado Pago: ?type=payment&data.id=123 ou corpo { type, data: { id } }
    const type = String(body.type ?? req.nextUrl.searchParams.get('type') ?? req.nextUrl.searchParams.get('topic') ?? '')
    const data = (body.data && typeof body.data === 'object' ? body.data : {}) as Record<string, unknown>
    const id = String(data.id ?? req.nextUrl.searchParams.get('data.id') ?? req.nextUrl.searchParams.get('id') ?? '')
    if (type !== 'payment' || !/^\d{1,30}$/.test(id)) return ok()
    const v = await verifyMercadoPago(accounts, id)
    if (!v) return NextResponse.json({ error: 'verificação indisponível' }, { status: 500 }) // o Mercado Pago tenta de novo
    await confirmRetailPayment(order, 'mercadopago', v)
    return ok()
  } catch (e) {
    console.error('[varejo-pagamento] aviso:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'erro' }, { status: provider === 'infinitepay' ? 400 : 500 })
  }
}
