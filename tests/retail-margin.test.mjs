// Testes das contas de preço do Varejo. Rodar: npm run test:varejo
// Valores esperados calculados à mão (comentados ao lado), não pela própria função.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  referencePrice, analyzePrice, analyzeOrder, loyaltyCostPct, breakEvenRevenue, cashbackBalance, everyRewards, tierFor,
  readLoyalty, readPricing, DEFAULT_LOYALTY,
} from '../src/lib/retail/margin.ts'

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`)
const P = (o = {}) => ({ tax_pct: 6, card_pct: 4, other_pct: 0, per_piece: 3, target_margin_pct: 20, fixed_monthly: 5000, avg_ticket: 0, ...o })
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
  // a cada R$ 1000 ganha 10%, ticket médio 250: 10 × 250 ÷ 1250 = 2%
  close(loyaltyCostPct(L({ mode: 'cada_x', every_amount: 1000, every_pct: 10 }), 250), 2)
  // sem ticket médio, considera ticket = 1000: 10 × 1000 ÷ 2000 = 5%
  close(loyaltyCostPct(L({ mode: 'cada_x', every_amount: 1000, every_pct: 10 })), 5)
})

test('fidelidade "a cada R$ X": simulação de compras confere com a fórmula', () => {
  // Cliente compra sempre R$ 250 (preço cheio). Ao juntar R$ 1000 pagos cheios, a compra seguinte tem 10%.
  let fullVolume = 0, discount = 0, acc = 0
  for (let i = 0; i < 5000; i++) {
    fullVolume += 250
    if (acc >= 1000) { discount += 25; acc = 0 } else acc += 250
  }
  close((discount / fullVolume) * 100, 2, 0.01) // ≈ 2% (fórmula: 10 × 250 ÷ 1250)
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
  const l = L({ mode: 'cada_x', every_amount: 1000, every_pct: 10 })
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
