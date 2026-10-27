import { test } from 'node:test'
import assert from 'node:assert/strict'
import { needsSplit, proposeSplit } from '../src/lib/retail/split.ts'

test('detecta lista na célula', () => {
  assert.equal(needsSplit('Dark Blue / Mocha Mousse', 'G / G'), true)
  assert.equal(needsSplit('Preto', 'P/M/G/GG'), true)
  assert.equal(needsSplit('Preto', 'M'), false)
})

test('cores e tamanhos em pares, 1 de cada', () => {
  const p = proposeSplit('Dark Blue / Mocha Mousse', 'G / G', 2)
  assert.deepEqual(p.rows, [{ color: 'Dark Blue', size: 'G', qty: 1 }, { color: 'Mocha Mousse', size: 'G', qty: 1 }])
  assert.equal(p.sure, true)
})

test('uma cor e vários tamanhos', () => {
  const p = proposeSplit('Preto', 'P/M/G/GG', 4)
  assert.deepEqual(p.rows.map(r => `${r.color} ${r.size} ${r.qty}`), ['Preto P 1', 'Preto M 1', 'Preto G 1', 'Preto GG 1'])
  const q = proposeSplit('Preto', 'P/M/G/GG', 8)
  assert.equal(q.sure, false)
  assert.equal(q.rows.reduce((t, r) => t + r.qty, 0), 8)
})

test('repetidos somam (Vanila/Vanila/Preto em G/M/M)', () => {
  const p = proposeSplit('Vanila/Vanila/Preto', 'G/M/M', 3)
  assert.deepEqual(p.rows, [{ color: 'Vanila', size: 'G', qty: 1 }, { color: 'Vanila', size: 'M', qty: 1 }, { color: 'Preto', size: 'M', qty: 1 }])
})

test('tamanho de conjunto ou com quantidade pede conferência', () => {
  assert.equal(proposeSplit('Azul', 'Colete M / Calça 40', 1).sure, false)
  assert.equal(proposeSplit('Dark Blue', '2M / 1 P', 3).sure, false)
  assert.equal(proposeSplit('Preta / Vanila / Mocha Mousse', 'M / P e M / M', 4).sure, false)
})
