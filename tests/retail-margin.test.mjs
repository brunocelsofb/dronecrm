// Testes das contas de preço do Varejo. Rodar: npm run test:varejo
// Valores esperados calculados à mão (comentados ao lado), não pela própria função.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  referencePrice, analyzePrice, analyzeOrder, loyaltyCostPct, breakEvenRevenue, cashbackBalance, everyRewards, tierFor,
  readLoyalty, readPricing, DEFAULT_LOYALTY, readTaxRegimes, regimeAt, pricingAt, simplesAnexoIRate, analyzeLines, loyaltyMessage, regimeTax, MEI_DAS_2026, conditionOptions, readPaymentConditions,
} from '../src/lib/retail/margin.ts'

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`)
const P = (o = {}) => ({ tax_pct: 6, card_pct: 4, other_pct: 0, per_piece: 3, target_margin_pct: 20, fixed_monthly: 5000, avg_ticket: 0, avg_pieces: 0, ...o })
const L = (o = {}) => ({ ...DEFAULT_LOYALTY, enabled: true, mode: 'cashback', cashback_pct: 5, ...o })
const OFF = { ...DEFAULT_LOYALTY, enabled: false }

test('preço de referência: exemplo do Sebrae (markup divisor)', () => {
  // (60 + 3) ÷ (1 − 0,06 − 0,04 − 0,05 − 0,20) = 63 ÷ 0,65 = 96,923… → para cima no centavo: 96,93
  const r = referencePrice(60, P(), L())
  assert.equal(r.ok, true); assert.equal(r.price, 96.93)
  close(r.markup, 96.93 / 60)
  const a = analyzePrice(96.93, 60, P(), L())
  // contribuição = 96,93 − 60 − 3 − 15% × 96,93 (14,5395) = 19,3905
  close(a.contribution, 19.3905); assert.ok(a.marginPct >= 20, 'nunca abaixo da margem desejada')
  close(a.marginPct, 19.3905 / 96.93 * 100)
  // 1 centavo a menos já fica abaixo de 20%
  assert.ok(analyzePrice(96.92, 60, P(), L()).marginPct < 20)
})

test('markup ≠ margem: custo 50, sem custos variáveis, margem 50% → preço 100, markup 2,00 (100% sobre o custo)', () => {
  const r = referencePrice(50, P({ tax_pct: 0, card_pct: 0, per_piece: 0, target_margin_pct: 50 }), OFF)
  assert.equal(r.price, 100); close(r.markup, 2)
  const a = analyzePrice(100, 50, P({ tax_pct: 0, card_pct: 0, per_piece: 0 }), OFF)
  close(a.marginPct, 50); close(a.markupPct, 100)
})

test('"custo × 2" (R$ 120) com os mesmos custos dá margem de 32,5%', () => {
  // 120 − 60 − 3 − 15% × 120 (18) = 39 → 39 ÷ 120 = 32,5%
  const a = analyzePrice(120, 60, P(), L())
  close(a.contribution, 39); close(a.marginPct, 32.5); close(a.markup, 2)
})

test('preço mínimo (sem prejuízo) e ponto de equilíbrio', () => {
  // mínimo = 63 ÷ (1 − 0,15) = 74,117… → 74,12
  const a = analyzePrice(96.93, 60, P(), L())
  assert.equal(a.minPrice, 74.12)
  assert.ok(analyzePrice(74.12, 60, P(), L()).contribution >= 0)
  assert.ok(analyzePrice(74.11, 60, P(), L()).contribution < 0)
  // 5000 ÷ 19,3905 = 257,86 → 258 peças
  assert.equal(a.breakEvenUnits, 258)
  assert.equal(breakEvenRevenue(5000, 20), 25000)
  assert.equal(breakEvenRevenue(5000, 0), null)
  assert.equal(analyzePrice(60, 60, P(), L()).breakEvenUnits, null) // contribuição negativa: não há equilíbrio
})

test('conta impossível e custo ausente', () => {
  const r = referencePrice(60, P({ tax_pct: 30, card_pct: 10, target_margin_pct: 60 }), OFF)
  assert.equal(r.ok, false); assert.match(r.reason, /100%/)
  assert.equal(referencePrice(0, P(), OFF).ok, false)
})

test('custo da fidelidade nos 3 formatos', () => {
  assert.equal(loyaltyCostPct(OFF), 0)
  assert.equal(loyaltyCostPct(L({ cashback_pct: 7 })), 7)
  assert.equal(loyaltyCostPct(L({ mode: 'progressivo' })), 10) // maior degrau da escada padrão
  // a cada R$ 1000 ganha 10%, compra média 250 (a compra com desconto também conta): 10 × 250 ÷ 1000 = 2,5%
  close(loyaltyCostPct(L({ mode: 'cada_x', every_unit: 'valor', every_amount: 1000, every_pct: 10 }), 250), 2.5)
  // sem compra média, considera compra = X → todo prêmio a cada compra: 10%
  close(loyaltyCostPct(L({ mode: 'cada_x', every_unit: 'valor', every_amount: 1000, every_pct: 10 })), 10)
  // a cada 4 peças ganha 10%, 2 peças por compra: 10 × 2 ÷ 4 = 5%; a cada 5 compras: 10 ÷ 5 = 2%
  close(loyaltyCostPct(L({ mode: 'cada_x', every_unit: 'pecas', every_amount: 4, every_pct: 10 }), 0, 2), 5)
  close(loyaltyCostPct(L({ mode: 'cada_x', every_unit: 'compras', every_amount: 5, every_pct: 10 })), 2)
  // nunca mais que o próprio desconto
  close(loyaltyCostPct(L({ mode: 'cada_x', every_unit: 'pecas', every_amount: 2, every_pct: 10 }), 0, 5), 10)
})

test('fidelidade "a cada X": simulação de compras confere com as fórmulas (a compra com desconto também conta)', () => {
  // valor: compras de R$ 250, a cada R$ 1000 pagos ganha 10% na seguinte
  const sim = (unitOf, every, buys) => {
    let full = 0, disc = 0, counted = 0, earned = 0, used = 0
    for (let i = 0; i < 20000; i++) {
      const t = buys(i), price = t.value
      full += price
      let paid = price
      if (Math.floor(counted / every) - used > 0) { paid = price * 0.9; disc += price * 0.1; used++ }
      counted += unitOf({ ...t, paid })
    }
    return (disc / full) * 100
  }
  close(sim(t => t.paid, 1000, () => ({ value: 250, pieces: 1 })), 10 * 250 / 1000, 0.15)       // ≈ 2,5% (a compra com desconto conta menos)
  close(sim(t => t.pieces, 4, () => ({ value: 200, pieces: 2 })), 10 * 2 / 4, 0.01)            // 5%
  close(sim(() => 1, 5, () => ({ value: 180, pieces: 1 })), 10 / 5, 0.01)                         // 2%
})

test('regime de imposto pela data da venda e Simples Nacional (Anexo I)', () => {
  const regimes = readTaxRegimes([
    { regime: 'outro', rate_pct: 4, since: '2026-01-01' },
    { regime: 'presumido', rate_pct: 11.5, since: '2026-11-01' },
    { regime: 'xyz', rate_pct: 1, since: '2026-05-01' },
  ])
  assert.equal(regimes.length, 2)
  assert.equal(regimeAt(regimes, '2025-12-31'), null)
  assert.equal(regimeAt(regimes, '2026-10-31').rate_pct, 4)
  assert.equal(regimeAt(regimes, '2026-11-01T02:30:00Z').rate_pct, 4)   // 31/10 23:30 em Brasília
  assert.equal(regimeAt(regimes, '2026-11-01T03:00:00Z').rate_pct, 11.5) // 01/11 00:00 em Brasília
  assert.equal(pricingAt(P(), regimes, '2026-12-10').tax_pct, 11.5)
  assert.equal(pricingAt(P(), [], '2026-12-10').tax_pct, 6) // sem regime: usa o valor da tela
  // (370.000,01 × 9,5% − 13.860) ÷ 370.000,01 = 5,754% (exemplo publicado da 3ª faixa)
  const r = simplesAnexoIRate(370000.01)
  assert.equal(r.faixa, 3); close(r.effective, 5.754, 0.001)
  close(simplesAnexoIRate(100000).effective, 4)
  close(simplesAnexoIRate(180000).effective, 4)                      // limite da 1ª faixa
  close(simplesAnexoIRate(360000).effective, (360000 * 0.073 - 5940) / 360000 * 100)
  close(simplesAnexoIRate(4800000).effective, (4800000 * 0.19 - 378000) / 4800000 * 100)
  assert.equal(simplesAnexoIRate(4800000.01), null)
  assert.equal(simplesAnexoIRate(0), null)
})

test('ganho por item e frase da fidelidade', () => {
  const lines = analyzeLines([{ qty: 2, unit_price: 120, unit_cost: 60 }, { qty: 1, unit_price: 100, unit_cost: null }], P(), L())
  // 240 − 2×(60+3) − 15% × 240 = 240 − 126 − 36 = 78 → 39 por peça
  assert.equal(lines[0].contribution, 78); assert.equal(lines[0].unitContribution, 39); close(lines[0].marginPct, 32.5)
  assert.equal(lines[1].contribution, null)
  const fmt = n => `R$ ${n.toFixed(2).replace('.', ',')}`
  const lp = L({ mode: 'cada_x', every_unit: 'pecas', every_amount: 4, every_pct: 10 })
  assert.equal(loyaltyMessage('Maria', 'AMARÁS', lp, { mode: 'cada_x', available: 0, progress: 3, missing: 1 }, fmt),
    'Oi, Maria! Você já comprou 3 peças na AMARÁS. Falta 1 peça para ganhar 10% de desconto.')
  assert.equal(loyaltyMessage('Maria', 'AMARÁS', lp, { mode: 'cada_x', available: 1, progress: 0, missing: 4 }, fmt),
    'Oi, Maria! Você ganhou 10% de desconto na sua próxima compra na AMARÁS!')
  assert.equal(loyaltyMessage('Ana', 'Loja', L({ mode: 'cada_x', every_unit: 'compras', every_amount: 5, every_pct: 15 }), { mode: 'cada_x', available: 0, progress: 3, missing: 2 }, fmt),
    'Oi, Ana! Você já fez 3 compras na Loja. Faltam 2 compras para ganhar 15% de desconto.')
  assert.equal(loyaltyMessage('Ana', 'Loja', L(), { mode: 'cashback', balance: 12.5, nextExpiry: '2026-12-01T12:00:00Z' }, fmt),
    'Oi, Ana! Você tem R$ 12,50 de crédito na Loja para usar em roupas. Ele vale até 01/12.')
  assert.equal(loyaltyMessage('Ana', 'Loja', L(), { mode: 'cashback', balance: 0, nextExpiry: null }, fmt), null)
})

test('pedido: margem real, desconto máximo e mínimo com a margem desejada', () => {
  // 2 × R$ 120 (custo 60), desconto 20 → receita 220; custo 2×60 + 2×3 = 126; variáveis 15% × 220 = 33
  const o = analyzeOrder([{ qty: 2, unit_price: 120, unit_cost: 60 }], 20, P(), L())
  assert.equal(o.revenue, 220); assert.equal(o.cost, 126); assert.equal(o.variableCost, 33); assert.equal(o.contribution, 61)
  close(o.marginPct, 61 / 220 * 100)
  assert.equal(o.minRevenue, 148.24)       // 126 ÷ 0,85 = 148,235…
  assert.equal(o.maxDiscount, 71.76)       // 220 − 148,24
  assert.equal(o.minRevenueTarget, 193.85) // 126 ÷ 0,65 = 193,846…
  assert.equal(o.missingCost, 0)
  // formatos de desconto: o custo já está no desconto do pedido (não soma de novo)
  const d = analyzeOrder([{ qty: 2, unit_price: 120, unit_cost: 60 }], 20, P(), L({ mode: 'progressivo' }))
  assert.equal(d.variableCost, 22) // 10% × 220
  const miss = analyzeOrder([{ qty: 1, unit_price: 100, unit_cost: null }, { qty: 3, unit_price: 50, unit_cost: 20 }], 0, P(), OFF)
  assert.equal(miss.missingCost, 1)
})

test('cashback: usa primeiro o crédito que vence antes; vencido some; nunca negativo', () => {
  const e = [
    { kind: 'credito', amount: 10, at: '2026-01-01T12:00:00Z', expires_at: '2026-03-01T12:00:00Z' },
    { kind: 'credito', amount: 20, at: '2026-02-01T12:00:00Z', expires_at: '2026-05-01T12:00:00Z' },
    { kind: 'uso', amount: 15, at: '2026-02-15T12:00:00Z' },
  ]
  assert.equal(cashbackBalance(e, new Date('2026-02-20T12:00:00Z')).balance, 15)
  assert.equal(cashbackBalance(e, new Date('2026-04-01T12:00:00Z')).balance, 15) // os 10 do 1º já foram usados
  assert.equal(cashbackBalance(e, new Date('2026-05-02T12:00:00Z')).balance, 0)
  const b = cashbackBalance(e, new Date('2026-02-20T12:00:00Z'))
  assert.equal(b.nextExpiry, '2026-05-01T12:00:00Z'); assert.equal(b.expiringAmount, 15)
  assert.equal(cashbackBalance([{ kind: 'credito', amount: 10, at: '2026-01-01T00:00:00Z', expires_at: '2026-03-01T00:00:00Z' }], new Date('2026-03-02T00:00:00Z')).balance, 0)
})

test('a cada R$ X e progressivo', () => {
  const l = L({ mode: 'cada_x', every_unit: 'valor', every_amount: 1000, every_pct: 10 })
  assert.deepEqual(everyRewards(2350, 1, l), { available: 1, progress: 350, missing: 650 })
  assert.deepEqual(everyRewards(999.99, 0, l), { available: 0, progress: 999.99, missing: 0.01 })
  const t = L({ mode: 'progressivo' })
  assert.deepEqual(tierFor(1499.99, t), { pct: 5, next: { min: 1500, pct: 8 }, missing: 0.01 })
  assert.deepEqual(tierFor(3000, t), { pct: 10, next: null, missing: null })
  assert.equal(tierFor(100, t).pct, 0)
})

test('leitura das configurações descarta valores inválidos', () => {
  const l = readLoyalty({ enabled: true, mode: 'xyz', cashback_pct: -3, tiers: [{ min: 3000, pct: 10 }, { min: 500, pct: 5 }, { min: 'a', pct: 1 }] })
  assert.equal(l.mode, 'cashback'); assert.equal(l.cashback_pct, 5)
  assert.deepEqual(l.tiers, [{ min: 500, pct: 5 }, { min: 3000, pct: 10 }])
  assert.equal(readPricing({ tax_pct: '6,5', card_pct: 200 }).tax_pct, 6.5)
  assert.equal(readPricing({ card_pct: 200 }).card_pct, 0)
  assert.equal(readPricing({}).target_margin_pct, 30) // sem configurar: margem padrão, não 0
  assert.equal(readPricing({ target_margin_pct: '' }).target_margin_pct, 30)
})

test('propriedade: em 20 mil casos aleatórios, o preço sugerido é o menor centavo que atinge a margem', () => {
  let seed = 42; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  let checked = 0
  for (let i = 0; i < 20000; i++) {
    const p = P({ tax_pct: +(rnd() * 15).toFixed(2), card_pct: +(rnd() * 6).toFixed(2), other_pct: +(rnd() * 5).toFixed(2), per_piece: +(rnd() * 8).toFixed(2), target_margin_pct: +(rnd() * 60).toFixed(1) })
    const l = rnd() < 0.5 ? OFF : L({ cashback_pct: +(rnd() * 10).toFixed(1) })
    const cost = +(1 + rnd() * 500).toFixed(2)
    const r = referencePrice(cost, p, l)
    if (!r.ok) continue
    checked++
    assert.ok(analyzePrice(r.price, cost, p, l).marginPct >= p.target_margin_pct - 1e-9, `abaixo: ${JSON.stringify({ cost, p, price: r.price })}`)
    assert.ok(analyzePrice(r.price - 0.01, cost, p, l).marginPct < p.target_margin_pct + 1e-9, `não é o mínimo: ${JSON.stringify({ cost, p, price: r.price })}`)
  }
  assert.ok(checked > 15000)
})

test('MEI e Simples pelo faturado', () => {
  const mei = readTaxRegimes([{ regime: 'mei', since: '2026-01-01', rate_pct: 9 }])[0]
  assert.equal(mei.rate_pct, 0); assert.equal(mei.das_monthly, 82.05) // DAS comércio 2026
  assert.deepEqual(regimeTax(mei, 50000), { tax_pct: 0, fixed_extra: 82.05, rbt12: 50000, overLimit: false })
  assert.equal(regimeTax(mei, 81000.01).overLimit, true)
  const p = pricingAt(P({ fixed_monthly: 5000 }), [mei], '2026-06-01', 0)
  assert.equal(p.tax_pct, 0); close(p.fixed_monthly, 5082.05)
  assert.equal(MEI_DAS_2026.comercio, 82.05)
  // Simples: 300 mil no Drone + 70 mil,01 fora = 370 mil,01 → 5,754% (3ª faixa)
  const sim = readTaxRegimes([{ regime: 'simples', since: '2026-01-01', outside_revenue_12m: 70000.01 }])[0]
  close(regimeTax(sim, 300000).tax_pct, 5.754, 0.001)
  close(regimeTax(sim, 0).tax_pct, 4) // 70 mil fora do Drone: 1ª faixa
  const zero = readTaxRegimes([{ regime: 'simples', since: '2026-01-01' }])[0]
  assert.equal(regimeTax(zero, 0).tax_pct, 4) // sem faturamento: 1ª faixa
  close(pricingAt(P(), [zero], '2026-06-01', 100000).tax_pct, 4)
  assert.equal(regimeTax(zero, 5_000_000).overLimit, true)
})

test('condições de pagamento: Pix com desconto e cartão com taxa', () => {
  const c = readPaymentConditions({ pix: { discount_pct: 5, fee_pct: 0 }, card: { max_installments: 3, fee_pct: 4.99 } })
  // 2 × 120 (custo 60), sem fidelidade, imposto 6%, custo por peça 3
  const opts = conditionOptions([{ qty: 2, unit_price: 120, unit_cost: 60 }], 0, P({ card_pct: 99 }), OFF, c)
  const pix = opts.find(o => o.id === 'pix'), card = opts.find(o => o.id === 'card')
  // Pix: 240 − 5% (12) = 228; variáveis 6% × 228 = 13,68; ganho 228 − 126 − 13,68 = 88,32
  assert.equal(pix.discount, 12); assert.equal(pix.total, 228); assert.equal(pix.analysis.contribution, 88.32)
  // Cartão: 240; variáveis (6 + 4,99)% × 240 = 26,376; ganho 240 − 126 − 26,376 = 87,62 · 3x de 80,00
  assert.equal(card.total, 240); assert.equal(card.installmentValue, 80); assert.equal(card.analysis.contribution, 87.62)
  assert.equal(card.label, 'Cartão em até 3x sem juros'); assert.equal(pix.label, 'Pix à vista com 5% de desconto')
  const off = conditionOptions([{ qty: 1, unit_price: 100, unit_cost: 50 }], 0, P(), OFF, readPaymentConditions({ card: { enabled: false } }))
  assert.equal(off.length, 1)
})
