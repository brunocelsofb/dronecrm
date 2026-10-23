// Testes do funil da loja (etapa, prazo de "parado", sugestão de perdido e mensagens).
import test from 'node:test'
import assert from 'node:assert/strict'
import { stageOf, followUp, readFunnel, FUNNEL_DEFAULTS, itemsText, nudgeMessage, nextMoves, firstName } from '../src/lib/retail/funnel.ts'

const base = { created_at: '2026-10-23T10:00:00Z', stage_at: '2026-10-23T10:00:00Z', proposal_sent_at: null, proposal_accepted_at: null, last_nudge_at: null }
const at = iso => new Date(iso)

test('etapa vem da situação do pedido e da proposta', () => {
  assert.equal(stageOf({ status: 'carrinho' }), 'carrinho')
  assert.equal(stageOf({ status: 'enviado_atendimento', proposal_sent_at: null }), 'atendimento')
  assert.equal(stageOf({ status: 'enviado_atendimento', proposal_sent_at: 'x', proposal_accepted_at: null }), 'proposta')
  assert.equal(stageOf({ status: 'aguardando_pagamento', proposal_sent_at: 'x', proposal_accepted_at: 'y' }), 'pagamento')
  assert.equal(stageOf({ status: 'pago' }), 'pago')
  assert.equal(stageOf({ status: 'enviado' }), 'entrega')
  assert.equal(stageOf({ status: 'entregue' }), 'entrega')
  assert.equal(stageOf({ status: 'cancelado' }), 'perdido')
})

test('carrinho fica parado depois de 2 h (padrão)', () => {
  const o = { ...base, status: 'carrinho' }
  assert.equal(followUp(o, FUNNEL_DEFAULTS, at('2026-10-23T11:59:00Z')).overdue, false)
  assert.equal(followUp(o, FUNNEL_DEFAULTS, at('2026-10-23T12:00:00Z')).overdue, true)
})

test('proposta conta a partir do envio, não da criação', () => {
  const o = { ...base, status: 'enviado_atendimento', proposal_sent_at: '2026-10-24T10:00:00Z' }
  const r = followUp(o, FUNNEL_DEFAULTS, at('2026-10-25T10:00:00Z')) // 24 h depois do envio; prazo 48 h
  assert.equal(r.stage, 'proposta'); assert.equal(r.overdue, false); assert.equal(r.hoursInStage, 24)
  assert.equal(followUp(o, FUNNEL_DEFAULTS, at('2026-10-26T10:00:00Z')).overdue, true)
})

test('lembrete enviado zera o prazo, mas não a sugestão de perdido', () => {
  const o = { ...base, status: 'enviado_atendimento', last_nudge_at: '2026-10-30T09:00:00Z' }
  const r = followUp(o, FUNNEL_DEFAULTS, at('2026-10-30T10:00:00Z')) // 7 dias na etapa; lembrete há 1 h
  assert.equal(r.overdue, false)
  assert.equal(r.suggestLost, true)
  assert.equal(followUp(o, FUNNEL_DEFAULTS, at('2026-10-31T09:00:00Z')).overdue, true)
})

test('pago e perdido nunca ficam "parados"', () => {
  for (const status of ['pago', 'enviado', 'cancelado']) {
    const r = followUp({ ...base, status }, FUNNEL_DEFAULTS, at('2027-01-01T00:00:00Z'))
    assert.equal(r.overdue, false); assert.equal(r.suggestLost, false)
  }
})

test('prazos: valores fora da faixa voltam ao padrão', () => {
  assert.deepEqual(readFunnel({ carrinho_h: 0, atendimento_h: '12', proposta_h: 9999, pagamento_h: 'x', lost_suggest_days: 30 }),
    { carrinho_h: 2, atendimento_h: 12, proposta_h: 48, pagamento_h: 24, lost_suggest_days: 30 })
  assert.deepEqual(readFunnel(null), FUNNEL_DEFAULTS)
})

test('texto das peças e primeiro nome', () => {
  assert.equal(itemsText(['Vestido Midi']), 'Vestido Midi')
  assert.equal(itemsText(['A', 'B', 'A']), 'A e B')
  assert.equal(itemsText(['A', 'B', 'C', 'D', 'E']), 'A, B e mais 3 peças')
  assert.equal(firstName('  MARIA da silva'), 'Maria')
})

test('mensagens de recuperação por etapa', () => {
  const d = { store: 'Loja X', customer: 'ana souza', number: 12, items: ['Saia'], proposalUrl: 'https://a/p', validUntil: '2026-10-30', paymentLink: 'https://pay' }
  assert.match(nudgeMessage('carrinho', d), /^Oi, Ana! Aqui é da Loja X\. Vi que você separou Saia/)
  assert.match(nudgeMessage('proposta', d), /pedido nº 12 continua disponível até 30\/10\/2026\. Quer que eu ajuste alguma coisa\? O link é este: https:\/\/a\/p$/)
  assert.match(nudgeMessage('pagamento', d), /O link para pagar é este: https:\/\/pay/)
  assert.equal(nudgeMessage('pago', d), null)
  assert.match(nudgeMessage('atendimento', { ...d, customer: null }), /^Oi! /)
})

test('próximos passos não voltam etapa', () => {
  assert.deepEqual(nextMoves('pagamento').map(m => m.status), ['pago'])
  assert.ok(!nextMoves('atendimento').some(m => m.status === 'carrinho'))
  assert.deepEqual(nextMoves('perdido'), [])
})
