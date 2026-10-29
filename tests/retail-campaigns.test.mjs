import { test } from 'node:test'
import assert from 'node:assert/strict'
import { campaignCode, campaignLink, campaignResult, renderCampaignMessage, selectAudience } from '../src/lib/retail/campaigns.ts'

const today = new Date('2026-10-29T12:00:00Z')
const c = (id, extra = {}) => ({ id, name: `Maria ${id}`, phone: '31999990000', optin: true, birth_date: null, last_purchase: null, total: 0, categories: [], ...extra })

test('só entra quem autorizou WhatsApp e tem telefone', () => {
  const r = selectAudience([c('a'), c('b', { optin: false }), c('c', { phone: null })], 'todas', {}, today)
  assert.deepEqual(r.map(x => x.id), ['a'])
})

test('aniversariantes do mês, em ordem do dia', () => {
  const r = selectAudience([c('a', { birth_date: '1990-11-20' }), c('b', { birth_date: '1985-11-03' }), c('c', { birth_date: '1990-10-01' })], 'aniversariantes', { month: 11 }, today)
  assert.deepEqual(r.map(x => x.id), ['b', 'a'])
})

test('inativas: última compra antes do limite; sem compra não entra', () => {
  const r = selectAudience([c('a', { last_purchase: '2026-06-01' }), c('b', { last_purchase: '2026-10-20' }), c('d')], 'inativas', { days: 90 }, today)
  assert.deepEqual(r.map(x => x.id), ['a'])
})

test('categoria e melhores clientes', () => {
  const L = [c('a', { categories: ['Calças'], total: 500 }), c('b', { categories: ['Blusas'], total: 900 }), c('c', { total: 100 })]
  assert.deepEqual(selectAudience(L, 'categoria', { category: 'calças' }, today).map(x => x.id), ['a'])
  assert.deepEqual(selectAudience(L, 'melhores', { top: 2 }, today).map(x => x.id), ['b', 'a'])
  assert.deepEqual(selectAudience(L, 'nenhum', {}, today), [])
})

test('código, link e mensagem', () => {
  assert.equal(campaignCode('Dia das Mães 2027!'), 'dia-das-maes-2027')
  assert.equal(campaignLink('https://x.dev/', 'amaras', 'dia-das-maes'), 'https://x.dev/?loja=amaras&c=dia-das-maes')
  assert.equal(renderCampaignMessage('Oi, {nome}! {loja}: {link}', { nome: 'Ana Paula Souza', loja: 'Amarás', link: 'L' }), 'Oi, Ana! Amarás: L')
})

test('resultado: vendido sem frete, retorno e custo por venda', () => {
  const r = campaignResult([{ total: 210, shipping: 10, cost: 80, paid: true }, { total: 100, shipping: 0, cost: 40, paid: true }, { total: 50, shipping: 0, cost: 20, paid: false }], 100)
  assert.deepEqual(r, { orders: 3, paid: 2, sold: 300, grossMargin: 180, roas: 3, costPerSale: 50 })
  assert.equal(campaignResult([], 0).roas, null)
})
