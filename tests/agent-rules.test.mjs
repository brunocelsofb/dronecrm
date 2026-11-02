import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RULE_CRITERIA, validateRule, ruleSentence, suggestedRules, renderRuleText, criterionDef } from '../src/lib/agent/rules-catalog.ts'

const ALL = ['pipeline', 'propostas', 'leads', 'contracts', 'surveys', 'tickets']
const U = '11111111-2222-3333-4444-555555555555'
const base = { name: 'Parada', criterion: 'opp_idle', threshold: 10, conditions: {}, days: [1, 2, 3, 4, 5], actions: { task: { enabled: true, title: 'Retomar — {{nome}}', text: '', due_days: 1, assignee: 'owner' } } }

test('catálogo: chaves únicas, limites coerentes, frase com {n}', () => {
  const keys = RULE_CRITERIA.map(c => c.key)
  assert.equal(new Set(keys).size, keys.length)
  for (const c of RULE_CRITERIA) {
    assert.ok(c.min <= c.def && c.def <= c.max, c.key)
    assert.ok(c.sentence.includes('{n}'), c.key)
    assert.ok(c.explain && c.ownerLabel, c.key)
  }
})

test('validação: critério da licença, número no limite, ação obrigatória', () => {
  assert.ok('rule' in validateRule(base, ALL))
  assert.match(validateRule(base, ['leads']).error, /licença/)
  assert.ok('error' in validateRule({ ...base, threshold: 0 }, ALL))
  assert.ok('error' in validateRule({ ...base, threshold: 2.5 }, ALL))
  assert.ok('error' in validateRule({ ...base, actions: {} }, ALL))
  assert.ok('error' in validateRule({ ...base, days: [] }, ALL))
  assert.ok('error' in validateRule({ ...base, name: '  ' }, ALL))
})

test('validação: só as condições do critério, e opções fechadas', () => {
  const r = validateRule({ ...base, conditions: { pipeline_id: U, min_value: '1500.555', lead_source: 'site', priority: 'x' } }, ALL)
  assert.deepEqual(r.rule.conditions, { pipeline_id: U, min_value: 1500.56 })
  assert.ok('error' in validateRule({ ...base, criterion: 'lead_stale', threshold: 2, conditions: { lead_source: 'inventada' } }, ALL))
  assert.ok('rule' in validateRule({ ...base, criterion: 'lead_stale', threshold: 2, conditions: { lead_source: 'formulario_site' } }, ALL))
  assert.ok('error' in validateRule({ ...base, criterion: 'opp_stage_stuck', conditions: { stage_id: U } }, ALL))
  assert.ok('error' in validateRule({ ...base, actions: { notify: { enabled: true, assignee: 'qualquer' } } }, ALL))
  assert.ok('error' in validateRule({ ...base, actions: { whatsapp: { enabled: true, to: '123' } } }, ALL))
  assert.equal(validateRule(base, ALL).rule.agent, 'hunter')
})

test('frase: diz exatamente o que a regra faz', () => {
  const s = ruleSentence({ ...base, conditions: { min_value: 5000 }, actions: { ...base.actions, whatsapp: { enabled: true, to: null } } }, { fmtBRL: v => `R$ ${v.toFixed(2).replace('.', ',')}` })
  assert.equal(s, 'QUANDO oportunidade aberta sem atividade há 10 dias com valor a partir de R$ 5000,00 → abrir a tarefa "Retomar — {{nome}}" para responsável da oportunidade (prazo 1 dia(s)); mandar a lista no WhatsApp do gestor.')
  assert.match(ruleSentence({ ...base, criterion: 'ticket_overdue', threshold: 1, conditions: { priority: 'muito_critica' } }), /prioridade Urgente/)
})

test('sugeridas: só critérios da licença, desligadas e válidas', () => {
  const all = suggestedRules(ALL)
  assert.ok(all.length >= 4)
  for (const r of all) { assert.equal(r.enabled, false); assert.ok('rule' in validateRule(r, ALL), r.name) }
  assert.ok(suggestedRules(['leads']).every(r => criterionDef(r.criterion).feature === 'leads'))
  assert.equal(renderRuleText('{{nome}} há {{dias}} · {{x}}', { nome: 'ACME', dias: '3' }), 'ACME há 3 · {{x}}')
})

import { THEMES, themesFor, isThemeKey } from '../src/lib/rules/central.ts'
import { AGENT_TASKS } from '../src/lib/agent/agent-tasks.ts'
import { resolveSlaDays, validateSlaDays, PRIORITY_SLA_DAYS } from '../src/lib/utils/gut-matrix.ts'

test('central: cada tarefa e cada critério estão em exatamente um tema', () => {
  for (const t of AGENT_TASKS) assert.equal(THEMES.filter(th => th.tasks.includes(t.key)).length, 1, t.key)
  for (const c of RULE_CRITERIA) assert.equal(THEMES.filter(th => th.criteria.includes(c.key)).length, 1, c.key)
  assert.ok(isThemeKey('renovacao') && !isThemeKey('x'))
  assert.deepEqual(themesFor(['leads']).map(t => t.key), ['leads'])
  assert.ok(themesFor(['varejo']).length === 0)
})

test('prazo do chamado por prioridade: padrão, empresa e validação', () => {
  assert.deepEqual(resolveSlaDays(null), PRIORITY_SLA_DAYS)
  assert.equal(resolveSlaDays({ critica: 4, muito_critica: 0 }).critica, 4)
  assert.equal(resolveSlaDays({ muito_critica: 0 }).muito_critica, 1)
  assert.ok('error' in validateSlaDays({ muito_critica: 1, critica: 2, pouco_critica: 3 }))
  assert.deepEqual(validateSlaDays({ muito_critica: '1', critica: 2, pouco_critica: 5, nao_critica: 10 }), { days: { muito_critica: 1, critica: 2, pouco_critica: 5, nao_critica: 10 } })
})

import { EVENT_ACTIONS, eventTaskKey, isEventKey } from '../src/lib/rules/events.ts'

test('ações de evento: chaves únicas, frase e momento', () => {
  const keys = EVENT_ACTIONS.map(e => e.key)
  assert.equal(new Set(keys).size, keys.length)
  for (const e of EVENT_ACTIONS) { assert.ok(e.sentence.includes('→'), e.key); assert.ok(['ganho', 'renovado', 'perdido', 'implantacao'].includes(e.when)) }
  assert.equal(eventTaskKey('won_impl_kickoff'), 'evt:won_impl_kickoff')
  assert.ok(isEventKey('avulso_billing') && !isEventKey('briefing'))
})
