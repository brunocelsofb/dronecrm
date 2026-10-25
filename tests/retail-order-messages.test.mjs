import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildConta, readTemplates, renderTemplate, trackingText, DEFAULT_TEMPLATES, firstName } from '../src/lib/retail/order-messages.ts'

const money = n => `R$ ${n.toFixed(2).replace('.', ',')}`

test('memória de cálculo do pedido', () => {
  const c = buildConta({ items: [{ name: 'Calça Paris', color: 'Bege', size: '38', qty: 1, unit_price: 200, total: 200 }, { name: 'Blusa', color: null, size: 'M', qty: 2, unit_price: 74.95, total: 149.9 }],
    subtotal: 349.9, discount: 17.5, loyaltyDiscount: 0, shipping: 15, total: 347.4, paymentLabel: 'Pix · 5% no Pix' }, money)
  assert.equal(c, 'Calça Paris · Bege / 38 · 1 × R$ 200,00 = R$ 200,00\nBlusa · M · 2 × R$ 74,95 = R$ 149,90\nSubtotal: R$ 349,90\nDesconto: − R$ 17,50\nFrete: R$ 15,00\nTotal: R$ 347,40\nPagamento: Pix · 5% no Pix')
  // sem ajustes: não repete o subtotal
  assert.equal(buildConta({ items: [{ name: 'Saia', color: null, size: null, qty: 1, unit_price: 99.9, total: 99.9 }], subtotal: 99.9, discount: 0, loyaltyDiscount: 0, shipping: 0, total: 99.9 }, money), 'Saia · 1 × R$ 99,90 = R$ 99,90\nTotal: R$ 99,90')
})

test('modelo: troca variáveis e enxuga linhas vazias', () => {
  const t = renderTemplate('Seu pedido nº {{numero}} saiu ✓\n{{rastreio}}\n\nAcompanhe: {{link_pedido}}', { numero: '12', rastreio: '', link_pedido: 'https://x/p' })
  assert.equal(t, 'Seu pedido nº 12 saiu ✓\n\nAcompanhe: https://x/p')
  assert.equal(renderTemplate('Oi, {{nome}}! {{desconhecida}}fim', { nome: 'Ana' }), 'Oi, Ana! fim')
  assert.equal(trackingText({ carrier: 'Correios', code: 'AB123456789BR', url: null }), 'Correios: AB123456789BR')
  assert.equal(trackingText({ carrier: null, code: null, url: null }), '')
  assert.equal(firstName('  Ana Maria Lima '), 'Ana')
})

test('modelos: vazio volta ao padrão', () => {
  const t = readTemplates({ pago: { wa: '  Recebemos! ', subject: '', email: 'x' }, outro: 1 })
  assert.equal(t.pago.wa, 'Recebemos!'); assert.equal(t.pago.subject, DEFAULT_TEMPLATES.pago.subject); assert.equal(t.pago.email, 'x')
  assert.deepEqual(t.recebido, DEFAULT_TEMPLATES.recebido)
  assert.deepEqual(readTemplates(null), DEFAULT_TEMPLATES)
})
