// ─── Varejo: chamadas aos serviços de pagamento (servidor) ────────────────────
// InfinitePay — documentação pública do checkout (infinitepay.io/checkout-documentacao):
//   POST https://api.checkout.infinitepay.io/links          (handle, items em centavos, order_nsu, redirect_url, webhook_url, customer)
//   POST https://api.checkout.infinitepay.io/payment_check  (handle, order_nsu, transaction_nsu, slug) → { paid, amount, paid_amount, capture_method }
//   A documentação não mostra o nome do campo do link na resposta: aceitamos url / payment_url / checkout_url / link.
// Mercado Pago — Checkout Pro (referência da API):
//   POST https://api.mercadopago.com/checkout/preferences  (Bearer token da loja) → init_point
//   GET  https://api.mercadopago.com/v1/payments/{id}       → status, external_reference, transaction_amount, payment_method_id, payment_type_id
// O aviso (webhook) só diz "olhe este pagamento": o Drone sempre confere no serviço antes de marcar Pago.

import { createAdminClient } from '@/lib/supabase/admin'
import { decryptSecret } from '@/lib/ai/tenant-key'
import { cleanHandle, paidMethod, readPaymentSetup, toCents, type PayProvider, type PaymentSetup } from '@/lib/retail/payments'

const IP_API = 'https://api.checkout.infinitepay.io'
const MP_API = 'https://api.mercadopago.com'
const TIMEOUT = 15_000

export type PaymentAccounts = { setup: PaymentSetup; ipHandle: string | null; ipToken: string | null; mpToken: string | null }

export async function loadPaymentAccounts(tenantId: string): Promise<PaymentAccounts> {
  const { data } = await createAdminClient().from('organization_settings')
    .select('retail_settings, retail_mp_token_enc, retail_ip_token_enc').eq('tenant_id', tenantId).maybeSingle()
  const raw = ((data as { retail_settings?: Record<string, unknown> } | null)?.retail_settings ?? {}) as Record<string, unknown>
  const setup = readPaymentSetup(raw.payments)
  const dec = (v: unknown) => {
    if (!v) return null
    try { return decryptSecret(String(v)) } catch (e) { console.error('[varejo-pagamento] chave ilegível:', e instanceof Error ? e.message : e); return null }
  }
  return { setup, ipHandle: setup.infinitepay_handle, ipToken: dec(data?.retail_ip_token_enc), mpToken: dec(data?.retail_mp_token_enc) }
}

async function call(url: string, init: RequestInit): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT)
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal, cache: 'no-store' })
    const text = await r.text()
    let body: Record<string, unknown> | null = null
    try { body = text ? JSON.parse(text) as Record<string, unknown> : null } catch { body = null }
    return { status: r.status, body }
  } finally { clearTimeout(t) }
}

export type CreateLinkInput = {
  provider: Exclude<PayProvider, 'manual'>
  accounts: PaymentAccounts
  ref: string             // referência única deste link
  token: string           // token público do pedido (rotas de retorno e de aviso)
  amount: number          // total em R$
  description: string     // "Pedido nº 12 · Loja"
  choice: 'pix' | 'card'
  maxInstallments: number
  customer: { name: string | null; phone: string | null }
  baseUrl: string
}

export async function createProviderLink(i: CreateLinkInput): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const back = `${i.baseUrl}/loja/proposta/${i.token}?retorno=1`
  const hook = `${i.baseUrl}/api/webhook/varejo-pagamento/${i.provider}/${i.token}`
  try {
    if (i.provider === 'infinitepay') {
      const handle = cleanHandle(i.accounts.ipHandle)
      if (!handle) return { ok: false, error: 'InfiniteTag da loja não configurada.' }
      const phone = i.customer.phone ? `+55${i.customer.phone.replace(/\D/g, '')}` : null
      const r = await call(`${IP_API}/links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(i.accounts.ipToken ? { Authorization: `Bearer ${i.accounts.ipToken}` } : {}) },
        body: JSON.stringify({
          handle, order_nsu: i.ref, redirect_url: back, webhook_url: hook,
          items: [{ quantity: 1, price: toCents(i.amount), description: i.description.slice(0, 120) }],
          ...(i.customer.name || phone ? { customer: { ...(i.customer.name ? { name: i.customer.name.slice(0, 100) } : {}), ...(phone ? { phone_number: phone } : {}) } } : {}),
        }),
      })
      const url = [r.body?.url, r.body?.payment_url, r.body?.checkout_url, r.body?.link].find(v => typeof v === 'string' && /^https:\/\//.test(v as string)) as string | undefined
      if (r.status >= 200 && r.status < 300 && url) return { ok: true, url }
      console.error('[varejo-pagamento] InfinitePay recusou o link:', r.status, JSON.stringify(r.body ?? {}).slice(0, 300))
      return { ok: false, error: `A InfinitePay não gerou o link (${r.status}). Confira a InfiniteTag em Preço e fidelidade.` }
    }
    if (!i.accounts.mpToken) return { ok: false, error: 'Chave do Mercado Pago não configurada.' }
    const r = await call(`${MP_API}/checkout/preferences`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${i.accounts.mpToken}` },
      body: JSON.stringify({
        items: [{ title: i.description.slice(0, 120), quantity: 1, unit_price: Math.round(i.amount * 100) / 100, currency_id: 'BRL' }],
        external_reference: i.ref,
        notification_url: hook,
        back_urls: { success: back, pending: back, failure: back },
        payment_methods: { installments: i.choice === 'pix' ? 1 : Math.max(1, i.maxInstallments) },
        ...(i.customer.name ? { payer: { name: i.customer.name.slice(0, 100) } } : {}),
      }),
    })
    const url = r.body?.init_point
    if (r.status >= 200 && r.status < 300 && typeof url === 'string') return { ok: true, url }
    console.error('[varejo-pagamento] Mercado Pago recusou o link:', r.status, JSON.stringify(r.body ?? {}).slice(0, 300))
    return { ok: false, error: r.status === 401 ? 'A chave do Mercado Pago foi recusada. Confira em Preço e fidelidade.' : `O Mercado Pago não gerou o link (${r.status}).` }
  } catch (e) {
    console.error('[varejo-pagamento] falha ao gerar link:', e instanceof Error ? e.message : e)
    return { ok: false, error: 'O serviço de pagamento não respondeu. Tente de novo em instantes.' }
  }
}

export type Verified = { paid: boolean; ref: string | null; amount: number; method: 'pix' | 'card' | 'outro'; tx: string | null; receiptUrl: string | null }

// InfinitePay: confere a transação informada no aviso ou no retorno
export async function verifyInfinitePay(accounts: PaymentAccounts, p: { order_nsu: string; transaction_nsu: string; slug: string; receipt_url?: string | null }): Promise<Verified | null> {
  const handle = cleanHandle(accounts.ipHandle)
  if (!handle) return null
  const r = await call(`${IP_API}/payment_check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(accounts.ipToken ? { Authorization: `Bearer ${accounts.ipToken}` } : {}) },
    body: JSON.stringify({ handle, order_nsu: p.order_nsu, transaction_nsu: p.transaction_nsu, slug: p.slug }),
  })
  if (r.status < 200 || r.status >= 300 || !r.body) return null
  const cents = Number(r.body.amount ?? 0)
  return {
    paid: r.body.paid === true, ref: p.order_nsu, amount: Number.isFinite(cents) ? cents / 100 : 0,
    method: paidMethod('infinitepay', { capture_method: r.body.capture_method }), tx: p.transaction_nsu,
    receiptUrl: p.receipt_url && /^https:\/\//.test(p.receipt_url) ? p.receipt_url : null,
  }
}

// Mercado Pago: busca o pagamento pelo número
export async function verifyMercadoPago(accounts: PaymentAccounts, paymentId: string): Promise<Verified | null> {
  if (!accounts.mpToken || !/^\d{1,30}$/.test(paymentId)) return null
  const r = await call(`${MP_API}/v1/payments/${paymentId}`, { headers: { Authorization: `Bearer ${accounts.mpToken}` } })
  if (r.status < 200 || r.status >= 300 || !r.body) return null
  return {
    paid: r.body.status === 'approved', ref: typeof r.body.external_reference === 'string' ? r.body.external_reference : null,
    amount: Number(r.body.transaction_amount ?? 0) || 0,
    method: paidMethod('mercadopago', { payment_method_id: r.body.payment_method_id, payment_type_id: r.body.payment_type_id }),
    tx: String(r.body.id ?? paymentId), receiptUrl: null,
  }
}
