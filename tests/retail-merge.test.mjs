import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nameKey, suggestGroups, pickMain, samePrice, colorIssue, photosAfter } from '../src/lib/retail/merge.ts'

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
