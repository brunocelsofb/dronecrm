import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nameKey, suggestGroups, pickMain, samePrice, colorIssue, photosAfter, similarColors, similarColorKey } from '../src/lib/retail/merge.ts'

const m = (id, colors, extra = {}) => ({ id, code: id, name: 'Calça Paris', colors, price: 157.9, promo_price: null, status: 'rascunho', photos: 0, stock: 1, ...extra })

test('agrupa pelo nome sem acento, caixa e espaços; ignora arquivadas', () => {
  assert.equal(nameKey('  Calça   Paris Chique '), 'calca paris chique')
  const g = suggestGroups([{ name: 'Calça Isabel', status: 'rascunho' }, { name: 'calca  isabel', status: 'publicado' }, { name: 'Blusa', status: 'rascunho' }, { name: 'Blusa', status: 'arquivado' }])
  assert.equal(g.length, 1)
  assert.equal(g[0].length, 2)
})

test('principal sugerida: mais cores, depois publicada, depois com preço', () => {
  assert.equal(pickMain([m('a', ['Preto']), m('b', ['Areia', 'Preto'])]).id, 'b')
  assert.equal(pickMain([m('a', ['Preto']), m('b', ['Azul'], { status: 'publicado' })]).id, 'b')
  assert.equal(pickMain([m('a', ['Preto'], { price: null }), m('b', ['Azul'])]).id, 'b')
})

test('preço diferente pede escolha', () => {
  assert.equal(samePrice([m('a', ['P']), m('b', ['A'])]), true)
  assert.equal(samePrice([m('a', ['P']), m('b', ['A'], { price: 89.9 })]), false)
})

test('cor: sem cor ou repetida precisa de nome; renomear resolve', () => {
  const g = [m('a', ['Natural']), m('b', ['Natural']), m('c', [null])]
  assert.equal(colorIssue(g[0], g, {}), 'cor repetida')
  assert.equal(colorIssue(g[2], g, {}), 'sem cor')
  assert.equal(colorIssue(g[1], g, { b: 'Natural Claro' }), null)
  assert.equal(colorIssue(g[0], g, { b: 'Natural Claro' }), null)
  assert.equal(colorIssue(g[2], g, { c: 'Preto' }), null)
  assert.equal(colorIssue(m('d', ['Preto', 'Azul']), g, {}), null) // várias cores: não renomeia
  assert.equal(photosAfter([m('a', [], { photos: 3 }), m('b', [], { photos: 6 })]), 9)
})

test('cores parecidas: Preta/Preto, Marron/Marrom, Off White/Offwhite; cores diferentes não', () => {
  assert.equal(similarColorKey('Preta'), similarColorKey('Preto'))
  assert.equal(similarColorKey('Marron'), similarColorKey('Marrom'))
  assert.equal(similarColorKey('Off White'), similarColorKey('offwhite'))
  assert.notEqual(similarColorKey('Verde'), similarColorKey('Vermelho'))
  assert.notEqual(similarColorKey('Areia'), similarColorKey('Azul'))
  assert.deepEqual(similarColors(['Preta', 'Azul'], ['Preto', 'Azul']), [['Preta', 'Preto']])
  assert.deepEqual(similarColors(['Azul'], ['Azul']), [])
})

test('preço por cor: vazio segue a peça; promoção só da cor; preço próprio não herda a promoção da peça', async () => {
  const { variantPrice } = await import('../src/lib/retail/products.ts')
  const p = { price: 157.9, promo_price: null }
  assert.deepEqual(variantPrice(p, { price: null, promo_price: null }), { price: 157.9, promo_price: null, final: 157.9 })
  assert.deepEqual(variantPrice(p, { price: null, promo_price: 99.9 }), { price: 157.9, promo_price: 99.9, final: 99.9 })
  assert.equal(variantPrice({ price: 157.9, promo_price: 129.9 }, { price: null, promo_price: null }).final, 129.9)
  assert.equal(variantPrice({ price: 157.9, promo_price: 129.9 }, { price: 169.9, promo_price: null }).final, 169.9)
  assert.equal(variantPrice({ price: null, promo_price: null }, {}).final, null)
})
