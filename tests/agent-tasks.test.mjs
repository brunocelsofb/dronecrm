import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AGENT_TASKS, taskState, runsOn, isPaused, normDays, weekdayOf, daysLabel, statusLabel, customTaskMessage, isAgentTaskKey, todayBrIso } from '../src/lib/agent/agent-tasks.ts'

test('catálogo: chaves únicas e padrões iguais aos de antes', () => {
  const keys = AGENT_TASKS.map(t => t.key)
  assert.equal(new Set(keys).size, keys.length)
  assert.deepEqual(taskState('briefing').days, [1, 2, 3, 4, 5])
  assert.deepEqual(taskState('inactive_hunter').days, [1])
  assert.deepEqual(taskState('renewal_alerts').days, [0, 1, 2, 3, 4, 5, 6])
  assert.ok(isAgentTaskKey('briefing') && !isAgentTaskKey('outra'))
})

test('sem linha na tabela: comportamento antigo (resumo só em dia útil, hunter só segunda)', () => {
  assert.equal(weekdayOf('2026-11-02'), 1) // segunda
  assert.equal(runsOn(taskState('briefing'), '2026-11-02'), true)
  assert.equal(runsOn(taskState('briefing'), '2026-11-01'), false) // domingo
  assert.equal(runsOn(taskState('inactive_hunter'), '2026-11-03'), false)
  assert.equal(runsOn(taskState('renewal_alerts'), '2026-11-01'), true)
})

test('desligar, dias e pausa (até a data, inclusive)', () => {
  const s = taskState('renewal_alerts', { enabled: true, days: [2, 4], paused_until: '2026-11-10' })
  assert.equal(isPaused(s, '2026-11-10'), true)
  assert.equal(isPaused(s, '2026-11-11'), false)
  assert.equal(runsOn(s, '2026-11-10'), false) // terça, mas pausada
  assert.equal(runsOn(s, '2026-11-12'), true)  // quinta
  assert.equal(runsOn(s, '2026-11-11'), false) // quarta não marcada
  assert.equal(runsOn(taskState('briefing', { enabled: false, days: [1] }), '2026-11-02'), false)
  assert.equal(taskState('briefing', { enabled: true, days: [1], paused_until: 'lixo' }).pausedUntil, null)
})

test('dias normalizados e rótulos', () => {
  assert.deepEqual(normDays([5, '1', 1, 9, -1, 2.5]), [1, 5])
  assert.deepEqual(normDays('x'), [])
  assert.equal(daysLabel([1, 2, 3, 4, 5]), 'segunda a sexta')
  assert.equal(daysLabel([0, 1, 2, 3, 4, 5, 6]), 'todos os dias')
  assert.equal(daysLabel([1, 3]), 'Seg, Qua')
  assert.equal(statusLabel({ enabled: true, days: [1], pausedUntil: '2026-12-01' }, '2026-11-01'), 'Pausada até 01/12/2026')
  assert.equal(statusLabel({ enabled: false, days: [1], pausedUntil: null }, '2026-11-01'), 'Desligada')
})

test('mensagem da tarefa escrita e hoje em Brasília', () => {
  assert.equal(customTaskMessage(' Vencimentos ', ' a\nb '), '🤖 *Vencimentos*\n\na\nb')
  assert.equal(todayBrIso(Date.parse('2026-11-02T02:00:00Z')), '2026-11-01')
})
