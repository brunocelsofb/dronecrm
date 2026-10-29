import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readiness } from '../src/lib/retail/readiness.ts'

const base = { status: 'rascunho', price: 157.9, duplicated: false, photos: [], meta: {}, variants: [] }
const v = (color, size, stock = 1) => ({ color, size, stock, active: true })

test('linha com cores juntas: primeiro passo é o cadastro', () => {
  const r = readiness({ ...base, variants: [v('Preto', 'P/M/G/GG', 4)] })
  assert.equal(r.next.key, 'cadastro'); assert.equal(r.ready, false)
})

test('foto de cada cor é obrigatória em peça com várias cores', () => {
  const r = readiness({ ...base, photos: ['a'], meta: { a: { color: 'Preto', model: false } }, variants: [v('Preto', 'P'), v('Areia', 'P')] })
  assert.equal(r.next.key, 'fotos'); assert.match(r.next.detail, /Areia/)
})

test('tudo certo e rascunho: falta publicar; publicada sem modelo já está pronta (modelo recomendado)', () => {
  const ok = { ...base, photos: ['a', 'b'], meta: { a: { color: 'Preto', model: false }, b: { color: 'Areia', model: false } }, variants: [v('Preto', 'P'), v('Areia', 'P')] }
  assert.equal(readiness(ok).next.key, 'publicar')
  const pub = readiness({ ...ok, status: 'publicado' })
  assert.equal(pub.ready, true); assert.equal(pub.next.key, 'modelo')
})

test('sem preço e sem estoque', () => {
  const r = readiness({ ...base, price: null, variants: [v('Preto', 'P', 0)] })
  assert.equal(r.next.key, 'preco'); assert.equal(r.blocking, 4)
})
