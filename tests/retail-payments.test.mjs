// Testes das regras do link de pagamento (InfinitePay / Mercado Pago / manual).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readPaymentSetup, cleanHandle, paidMethod, checkPayment, reusableLink, toCents, providerFor } from '../src/lib/retail/payments.ts'

test('configuração: padrão manual e InfiniteTag limpa', () => {
  assert.deepEqual(readPaymentSetup(null), { pix_provider: 'manual', card_provider: 'manual', infinitepay_handle: null })
  const s = readPaymentSetup({ pix_provider: 'infinitepay', card_provider: 'mercadopago', infinitepay_handle: '$Amaras_Loja' })
  assert.equal(s.infinitepay_handle, 'amaras_loja')
  assert.equal(providerFor(s, 'pix'), 'infinitepay'); assert.equal(providerFor(s, 'card'), 'mercadopago')
  assert.equal(readPaymentSetup({ pix_provider: 'stripe' }).pix_provider, 'manual')
  assert.equal(cleanHandle('@a'), null); assert.equal(cleanHandle('loja com espaço'), null)
})

test('centavos sem erro de arredondamento', () => {
  assert.equal(toCents(189.9), 18990); assert.equal(toCents(0.29), 29); assert.equal(toCents(1234.565), 123457)
})

test('forma paga a partir da resposta do serviço', () => {
  assert.equal(paidMethod('infinitepay', { capture_method: 'pix' }), 'pix')
  assert.equal(paidMethod('infinitepay', { capture_method: 'credit_card' }), 'card')
  assert.equal(paidMethod('mercadopago', { payment_method_id: 'pix', payment_type_id: 'bank_transfer' }), 'pix')
  assert.equal(paidMethod('mercadopago', { payment_method_id: 'master', payment_type_id: 'credit_card' }), 'card')
  assert.equal(paidMethod('mercadopago', { payment_method_id: 'bolbradesco', payment_type_id: 'ticket' }), 'outro')
})

test('valor menor não fecha; forma trocada fecha com aviso', () => {
  const pix = { choice: 'pix', amount: 190 }
  assert.deepEqual(checkPayment(pix, { amount: 190, method: 'pix' }), { ok: true, alert: null })
  assert.equal(checkPayment(pix, { amount: 189.99, method: 'pix' }).ok, false)
  const swapped = checkPayment(pix, { amount: 190, method: 'card' })
  assert.equal(swapped.ok, true); assert.match(swapped.alert, /escolheu Pix .* pagou com cartão/)
  assert.equal(checkPayment({ choice: 'card', amount: 200 }, { amount: 210.5, method: 'card' }).ok, true) // juros do parcelamento pagos pela cliente
})

test('reaproveita o link só da mesma condição e do mesmo resumo', () => {
  const links = {
    a: { choice: 'pix', provider: 'infinitepay', url: 'https://x/a', amount: 1, discount: 0, version: 'v1', created_at: '' },
    b: { choice: 'card', provider: 'mercadopago', url: 'https://x/b', amount: 1, discount: 0, version: 'v2', created_at: '' },
  }
  assert.equal(reusableLink(links, 'pix', 'v1')?.ref, 'a')
  assert.equal(reusableLink(links, 'pix', 'v2'), null)
  assert.equal(reusableLink(links, 'card', 'v2')?.link.url, 'https://x/b')
  assert.equal(reusableLink(null, 'card', 'v2'), null)
})
