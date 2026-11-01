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

import { validateRenewalLevels, resolveRenewalLevels, renewalSlotFor, slotDays, renewalLevelLabel } from '../src/lib/agent/renewal-templates.ts'
import { checkParams, agentTaskDef } from '../src/lib/agent/agent-tasks.ts'

test('marcos dos avisos: padrão igual a antes', () => {
  const L = resolveRenewalLevels(undefined)
  assert.deepEqual(L, { prep: 90, a1: 60, a2: 30, a3: 15 })
  assert.equal(renewalSlotFor(-1, L), 0)
  assert.equal(renewalSlotFor(15, L), 15)
  assert.equal(renewalSlotFor(16, L), 30)
  assert.equal(renewalSlotFor(60, L), 60)
  assert.equal(renewalSlotFor(90, L), 90)
  assert.equal(renewalSlotFor(91, L), null)
})

test('marcos dos avisos: prazos da empresa', () => {
  const L = { prep: 120, a1: 45, a2: 20, a3: 7 }
  assert.equal(renewalSlotFor(100, L), 90)  // degrau "preparar"
  assert.equal(renewalSlotFor(45, L), 60)
  assert.equal(renewalSlotFor(21, L), 60)
  assert.equal(renewalSlotFor(20, L), 30)
  assert.equal(renewalSlotFor(7, L), 15)
  assert.equal(slotDays(60, L), 45)
  assert.equal(renewalLevelLabel('30', L), '20 dias antes')
  assert.equal(renewalLevelLabel('0', L), 'Após o vencimento')
})

test('marcos inválidos: recusa ao salvar e cai no padrão ao ler', () => {
  assert.ok('error' in validateRenewalLevels({ prep: 60, a1: 60, a2: 30, a3: 15 }))
  assert.ok('error' in validateRenewalLevels({ prep: 90, a1: 60, a2: 30, a3: 0 }))
  assert.ok('error' in validateRenewalLevels({ prep: 400, a1: 60, a2: 30, a3: 15 }))
  assert.deepEqual(resolveRenewalLevels({ prep: 10, a1: 60 }), { prep: 90, a1: 60, a2: 30, a3: 15 })
  assert.ok('levels' in validateRenewalLevels({ prep: '100', a1: 50, a2: 25, a3: 10 }))
})

test('prazos das tarefas: limites de cada campo', () => {
  assert.ok('error' in checkParams(agentTaskDef('measurement_alerts'), { due_day: 29 }))
  assert.deepEqual(checkParams(agentTaskDef('ruler_overdue'), { repeat_days: 0 }), { values: { repeat_days: 0 } })
  assert.ok('error' in checkParams(agentTaskDef('inactive_hunter'), { inactive_months: 1.5 }))
})

import { checkOptions, briefingSections, customRunsOn, customStatusLabel, ALL_BRIEFING_SECTIONS } from '../src/lib/agent/agent-tasks.ts'

test('destinatários: só os campos que a tarefa aceita, validados', () => {
  const r = checkOptions(agentTaskDef('renewal_alerts'), { assignee: '', notify_whatsapp: '(62) 99999-0000', notify_email: ' Gestor@Empresa.com ', briefing_extra: 'x' })
  assert.deepEqual(r, { options: { assignee: null, notify_whatsapp: '62999990000', notify_email: 'gestor@empresa.com' } })
  assert.ok('error' in checkOptions(agentTaskDef('renewal_alerts'), { notify_whatsapp: '123' }))
  assert.ok('error' in checkOptions(agentTaskDef('renewal_alerts'), { notify_email: 'sem-arroba' }))
  assert.ok('error' in checkOptions(agentTaskDef('measurement_alerts'), { assignee: 'nao-e-uuid' }))
  assert.deepEqual(checkOptions(agentTaskDef('measurement_alerts'), { notify_whatsapp: '62999990000' }), { options: { assignee: null } })
})

test('resumo do dia: seções (padrão = tudo) e pedido extra', () => {
  assert.equal(briefingSections({}).size, ALL_BRIEFING_SECTIONS.length)
  assert.deepEqual([...briefingSections({ briefing_sections: ['leads', 'xx'] })], ['leads'])
  const ok = checkOptions(agentTaskDef('briefing'), { briefing_sections: ['renovacoes', 'urgentes'], briefing_extra: ' top 5 ' })
  assert.deepEqual(ok, { options: { notify_whatsapp: null, briefing_sections: ['renovacoes', 'urgentes'], briefing_extra: 'top 5' } })
  assert.ok('error' in checkOptions(agentTaskDef('briefing'), { briefing_sections: ['urgentes'] }))
  assert.ok('options' in checkOptions(agentTaskDef('briefing'), { briefing_sections: [], briefing_extra: 'só isto' }))
})

test('tarefa escrita mensal', () => {
  const s = { enabled: true, days: [], pausedUntil: null, monthDay: 5 }
  assert.equal(customRunsOn(s, '2026-11-05'), true)
  assert.equal(customRunsOn(s, '2026-11-06'), false)
  assert.equal(customRunsOn({ ...s, pausedUntil: '2026-11-10' }, '2026-11-05'), false)
  assert.equal(customRunsOn({ ...s, monthDay: null, days: [4] }, '2026-11-05'), true) // quinta
  assert.equal(customStatusLabel(s, '2026-11-01'), 'Ativa · todo dia 5 do mês')
})

import { runPreview, inPreview, record } from '../src/lib/agent/agent-preview.ts'

test('prévia: anota dentro, nada fora; erro não escapa', async () => {
  assert.equal(inPreview(), false)
  const r = await runPreview(async () => { assert.equal(inPreview(), true); record({ kind: 'nota', text: 'a' }); await new Promise(res => setTimeout(res, 5)); record({ kind: 'nota', text: 'b' }); return 1 })
  assert.equal(r.result, 1)
  assert.deepEqual(r.items.map(i => i.text), ['a', 'b'])
  record({ kind: 'nota', text: 'fora' }) // sem efeito
  const e = await runPreview(async () => { record({ kind: 'nota', text: 'x' }); throw new Error('falhou') })
  assert.equal(e.error, 'falhou')
  assert.equal(e.items.length, 1)
  assert.equal(inPreview(), false)
})
