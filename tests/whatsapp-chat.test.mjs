import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evoAckStatus, nextDelivery, evoStatusUpdates, quotedIdOf, reactionOf, applyReaction, unreadCount, normShortcut, slashQuery, matchQuickReplies, fillQuickReply, insertQuickReply } from '../src/lib/whatsapp/chat.ts'

test('tiques: situação da Evolution em texto ou número', () => {
  assert.equal(evoAckStatus('DELIVERY_ACK'), 'delivered')
  assert.equal(evoAckStatus('READ'), 'read'); assert.equal(evoAckStatus('PLAYED'), 'read')
  assert.equal(evoAckStatus(3), 'delivered'); assert.equal(evoAckStatus(4), 'read')
  assert.equal(evoAckStatus('SERVER_ACK'), 'sent'); assert.equal(evoAckStatus('PENDING'), null); assert.equal(evoAckStatus(null), null)
})

test('tique só avança', () => {
  assert.equal(nextDelivery(null, 'delivered'), 'delivered')
  assert.equal(nextDelivery('read', 'delivered'), null)
  assert.equal(nextDelivery('delivered', 'read'), 'read')
  assert.equal(nextDelivery('sent', 'sent'), null)
  assert.equal(nextDelivery('enviado', 'sent'), 'sent')
})

test('avisos de situação: formato v2 (keyId) e v1 (key.update), lista ou objeto', () => {
  assert.deepEqual(evoStatusUpdates({ keyId: 'ABC', messageId: 'interno', status: 'READ', fromMe: true }), [{ id: 'ABC', status: 'read', fromMe: true }])
  assert.deepEqual(evoStatusUpdates([{ key: { id: 'X', fromMe: true }, update: { status: 3 } }, { key: { id: 'Y' } }]), [{ id: 'X', status: 'delivered', fromMe: true }])
  assert.deepEqual(evoStatusUpdates(null), [])
})

test('citação: id da mensagem respondida em qualquer tipo', () => {
  assert.equal(quotedIdOf({ extendedTextMessage: { text: 'oi', contextInfo: { stanzaId: 'Q1' } } }), 'Q1')
  assert.equal(quotedIdOf({ imageMessage: { contextInfo: { stanzaId: 'Q2' } } }), 'Q2')
  assert.equal(quotedIdOf({ conversation: 'oi' }, { contextInfo: { stanzaId: 'Q3' } }), 'Q3')
  assert.equal(quotedIdOf({ conversation: 'oi' }), null)
})

test('reações: põe, troca e tira', () => {
  assert.deepEqual(reactionOf({ reactionMessage: { key: { id: 'M1' }, text: '👍' } }), { targetId: 'M1', emoji: '👍' })
  assert.equal(reactionOf({ conversation: 'x' }), null)
  assert.deepEqual(applyReaction({}, 'them', '❤️'), { them: '❤️' })
  assert.deepEqual(applyReaction({ them: '❤️', me: '👍' }, 'me', ''), { them: '❤️' })
  assert.deepEqual(applyReaction(null, 'me', '😂'), { me: '😂' })
})

test('não lidas: depois da última leitura e da última resposta', () => {
  const m = [
    { direction: 'recebido', created_at: '2026-10-30T10:00:00Z' },
    { direction: 'enviado', created_at: '2026-10-30T11:00:00Z' },
    { direction: 'recebido', created_at: '2026-10-30T12:00:00Z' },
    { direction: 'recebido', created_at: '2026-10-30T13:00:00Z' },
  ]
  assert.equal(unreadCount(m, '2026-10-30T09:00:00Z', '2026-01-01T00:00:00Z'), 2)
  assert.equal(unreadCount(m, '2026-10-30T12:30:00Z', '2026-01-01T00:00:00Z'), 1)
  assert.equal(unreadCount(m, null, '2026-10-30T14:00:00Z'), 0)
  assert.equal(unreadCount([{ direction: 'recebido', created_at: '2026-10-30T10:00:00Z' }], null, '2026-10-29T00:00:00Z'), 1)
})

test('respostas rápidas: atalho, busca e variáveis', () => {
  assert.equal(normShortcut('/Boas Vindas!'), 'boas-vindas')
  assert.equal(slashQuery('/ped'), 'ped'); assert.equal(slashQuery('oi /pr'), 'pr'); assert.equal(slashQuery('oi/pr'), null); assert.equal(slashQuery('oi'), null)
  assert.equal(slashQuery('/'), '')
  const list = [{ shortcut: 'preco', body: 'Nosso preço…' }, { shortcut: 'pix', body: 'Chave pix' }, { shortcut: 'oi', body: 'Olá {nome}' }]
  assert.deepEqual(matchQuickReplies(list, 'p').map(r => r.shortcut), ['pix', 'preco'])
  assert.equal(matchQuickReplies(list, '').length, 3)
  assert.equal(fillQuickReply('Olá {nome}, aqui é {atendente}.', { nome: 'Maria Souza', atendente: 'Bruno' }), 'Olá Maria, aqui é Bruno.')
  assert.equal(fillQuickReply('Olá {nome}!', { nome: null }), 'Olá !')
  assert.equal(insertQuickReply('Bom dia /oi', 'Olá Maria'), 'Bom dia Olá Maria')
  assert.equal(insertQuickReply('/oi', 'Olá'), 'Olá')
})

import { revokedIdOf, evoDeletedIds, revokedText } from '../src/lib/whatsapp/chat.ts'
test('apagada para todos: protocolo REVOKE e aviso DELETED', () => {
  assert.equal(revokedIdOf({ protocolMessage: { type: 'REVOKE', key: { id: 'R1' } } }), 'R1')
  assert.equal(revokedIdOf({ protocolMessage: { type: 0, key: { id: 'R2' } } }), 'R2')
  assert.equal(revokedIdOf({ protocolMessage: { type: 14, editedMessage: {} } }), null)
  assert.deepEqual(evoDeletedIds({ keyId: 'D1', status: 'DELETED' }), ['D1'])
  assert.deepEqual(evoDeletedIds([{ keyId: 'X', status: 'READ' }]), [])
  assert.equal(revokedText('enviado'), '🚫 Você apagou esta mensagem')
  assert.equal(revokedText('recebido'), '🚫 Esta mensagem foi apagada')
})

import { unwrapMessage } from '../src/lib/whatsapp/chat.ts'
test('envelope: outro aparelho, temporária e camadas', () => {
  const t = { extendedTextMessage: { text: 'oi', contextInfo: { stanzaId: 'Q' } } }
  assert.deepEqual(unwrapMessage({ deviceSentMessage: { destinationJid: 'x', message: t } }), t)
  assert.deepEqual(unwrapMessage({ ephemeralMessage: { message: { deviceSentMessage: { message: { conversation: 'a' } } } } }), { conversation: 'a' })
  assert.deepEqual(unwrapMessage({ conversation: 'b' }), { conversation: 'b' })
  assert.equal(unwrapMessage(null), null)
  assert.deepEqual(unwrapMessage({ messageContextInfo: { a: 1 }, ephemeralMessage: { message: { conversation: 'c' } } }), { messageContextInfo: { a: 1 }, conversation: 'c' })
})

import { canonPhone, samePhone, phoneVariants } from '../src/lib/whatsapp/chat.ts'
test('mesmo número com e sem 55 / com e sem o 9', () => {
  assert.equal(canonPhone('5562999677609'), '62999677609')
  assert.equal(canonPhone('62999677609'), '62999677609')
  assert.equal(canonPhone('556299677609'), '62999677609')
  assert.ok(samePhone('5562999677609', '62999677609'))
  assert.ok(!samePhone('5562999677609', '6299967760'))
  assert.ok(!samePhone('5511999677609', '62999677609'))
  assert.deepEqual(phoneVariants('62999677609').sort(), ['556299677609', '5562999677609', '6299677609', '62999677609'].sort())
})
