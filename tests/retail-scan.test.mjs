import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findByCode, normalizeBarcode, scanChanges } from '../src/lib/retail/scan.ts'

const L = [
  { id: 'a', sku: 'PC732-PRETO-P', barcode: '7891234567890', stock: 2, category: 'Calças' },
  { id: 'b', sku: 'PC732-PRETO-M', barcode: null, stock: 1, category: 'Calças' },
  { id: 'c', sku: 'BL1-M', barcode: '789000', stock: 3, category: 'Blusas' },
]

test('acha pelo código de barras ou pelo SKU, sem espaço e sem caixa', () => {
  assert.equal(normalizeBarcode(' 789 123 '), '789123')
  assert.equal(findByCode(L, '7891234567890')?.id, 'a')
  assert.equal(findByCode(L, 'pc732-preto-m')?.id, 'b')
  assert.equal(findByCode(L, '000'), null)
})

test('entrada soma o que foi lido', () => {
  assert.deepEqual(scanChanges('entrada', { a: 3 }, L), [{ variant_id: 'a', before: 2, after: 5, mode: 'add', qty: 3 }])
})

test('contagem: lido fica igual; igual ao sistema não muda; zerar só a categoria escolhida', () => {
  assert.deepEqual(scanChanges('contagem', { a: 1, c: 3 }, L), [{ variant_id: 'a', before: 2, after: 1, mode: 'set', qty: 1 }])
  const z = scanChanges('contagem', { a: 2 }, L, { category: 'Calças', zeroMissing: true })
  assert.deepEqual(z, [{ variant_id: 'b', before: 1, after: 0, mode: 'set', qty: 0 }])
  assert.equal(scanChanges('contagem', { a: 2 }, L, { category: 'Calças', zeroMissing: false }).length, 0)
})
