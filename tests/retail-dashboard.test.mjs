// Testes das contas do Painel do Varejo. Valores esperados calculados à mão.
import test from 'node:test'
import assert from 'node:assert/strict'
import { monthBounds, summarizeSales, breakEvenProgress, changePct } from '../src/lib/retail/dashboard-calc.ts'

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`)

test('mês no fuso de Brasília, inclusive na virada', () => {
  const b = monthBounds(new Date('2026-10-22T20:47:00Z')) // 22/10 17:47 em Brasília
  assert.deepEqual([b.start, b.end, b.prevStart, b.day, b.days], ['2026-10-01T03:00:00.000Z', '2026-11-01T03:00:00.000Z', '2026-09-01T03:00:00.000Z', 22, 31])
  const late = monthBounds(new Date('2026-11-01T02:30:00Z')) // 31/10 23:30 em Brasília: ainda outubro
  assert.equal(late.start, '2026-10-01T03:00:00.000Z'); assert.equal(late.day, 31)
  const dec = monthBounds(new Date('2026-12-15T12:00:00Z'))
  assert.equal(dec.end, '2027-01-01T03:00:00.000Z')
  const jan = monthBounds(new Date('2027-01-10T12:00:00Z'))
  assert.equal(jan.prevStart, '2026-12-01T03:00:00.000Z')
  assert.equal(monthBounds(new Date('2028-02-10T12:00:00Z')).days, 29) // bissexto
  assert.equal(monthBounds(new Date('2027-02-10T12:00:00Z')).days, 28)
  assert.equal(b.label, 'outubro de 2026')
})

test('resumo de vendas', () => {
  const s = summarizeSales([{ revenue: 220, contribution: 61, missingCost: 0 }, { revenue: 100, contribution: 20, missingCost: 1 }])
  assert.equal(s.orders, 2); assert.equal(s.revenue, 320); assert.equal(s.avgTicket, 160); assert.equal(s.contribution, 81)
  close(s.marginPct, 25.3125); assert.equal(s.missingCostUnits, 1)
  assert.deepEqual(summarizeSales([]), { orders: 0, revenue: 0, avgTicket: 0, contribution: 0, marginPct: 0, missingCostUnits: 0 })
})

test('ponto de equilíbrio do mês', () => {
  const s = summarizeSales([{ revenue: 220, contribution: 61, missingCost: 0 }, { revenue: 100, contribution: 20, missingCost: 0 }])
  const b = breakEvenProgress(5000, s, 20, 22, 31)
  assert.equal(b.covered, 81); assert.equal(b.missingContribution, 4919)
  assert.equal(b.missingRevenue, 19433.09)   // 4919 ÷ 0,253125 = 19.433,086…
  assert.equal(b.perDayRevenue, 1943.31)     // 10 dias restantes (22 a 31)
  assert.equal(b.projectedContribution, 114.14) // 81 ÷ 22 × 31
  close(b.pct, 1.62); assert.equal(b.reached, false)
  // sem vendas: usa a margem desejada (20%) → 5000 ÷ 0,20
  assert.equal(breakEvenProgress(5000, summarizeSales([]), 20, 1, 30).missingRevenue, 25000)
  const ok = breakEvenProgress(100, summarizeSales([{ revenue: 500, contribution: 150, missingCost: 0 }]), 20, 10, 30)
  assert.equal(ok.reached, true); assert.equal(ok.pct, 100); assert.equal(ok.missingRevenue, 0)
  assert.equal(breakEvenProgress(0, s, 20, 1, 30), null)
})

test('variação contra o mês anterior', () => {
  close(changePct(150, 100), 50); close(changePct(50, 100), -50); assert.equal(changePct(10, 0), null)
})
