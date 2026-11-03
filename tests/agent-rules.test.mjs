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
    if (c.kind !== 'evento') assert.ok(c.sentence.includes('{n}'), c.key)
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
  assert.deepEqual(themesFor(['leads']).map(t => t.key), ['leads', 'areas'])
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

import { isEventCriterion, PIPELINE_TYPES } from '../src/lib/agent/rules-catalog.ts'
import { profileProblems } from '../src/lib/people/profile-complete.ts'

const ev = { name: 'Avulso ganho', criterion: 'evt_won', threshold: 9, conditions: { pipeline_type: 'servico_avulso' }, executor: 'agent',
  actions: { task: { enabled: true, title: 'Executar — {{nome}}', text: 'Combine e execute', due_days: 2, assignee: 'area:11111111-2222-3333-4444-555555555555' } } }

test('regra por evento: sem número e sem dias, tipo de funil, quem faz, área', () => {
  assert.ok(isEventCriterion('evt_won') && !isEventCriterion('opp_idle'))
  const r = validateRule(ev, ALL).rule
  assert.equal(r.threshold, 0)
  assert.deepEqual(r.days, [0, 1, 2, 3, 4, 5, 6])
  assert.equal(r.executor, 'agent')
  assert.equal(r.conditions.pipeline_type, 'servico_avulso')
  assert.ok('error' in validateRule({ ...ev, conditions: { pipeline_type: 'x' } }, ALL))
  assert.ok('error' in validateRule({ ...ev, criterion: 'evt_stage', conditions: {} }, ALL))
  assert.equal(validateRule({ ...ev, executor: 'qualquer' }, ALL).rule.executor, 'manual')
  assert.ok(PIPELINE_TYPES.servico_avulso)
})

test('e-mail interno: destinos (responsável, área, pessoa, e-mail), assunto e texto', () => {
  const base = { ...ev, actions: { email: { enabled: true, to: ['owner', 'area:11111111-2222-3333-4444-555555555555', 'Fin@Empresa.com'], subject: 'Churn {{nome}}', body: 'Encerrar cobrança' } } }
  assert.deepEqual(validateRule(base, ALL).rule.actions.email.to, ['owner', 'area:11111111-2222-3333-4444-555555555555', 'fin@empresa.com'])
  assert.ok('error' in validateRule({ ...base, actions: { email: { enabled: true, to: [], subject: 'x', body: 'y' } } }, ALL))
  assert.ok('error' in validateRule({ ...base, actions: { email: { enabled: true, to: ['nada'], subject: 'x', body: 'y' } } }, ALL))
  assert.ok('error' in validateRule({ ...base, actions: { email: { enabled: true, to: ['owner'], subject: '', body: 'y' } } }, ALL))
  assert.match(ruleSentence(validateRule(base, ALL).rule, { area: () => 'Faturamento' }), /o agente escreve e envia o e-mail "Churn \{\{nome\}\}" para responsável da oportunidade, a área Faturamento, fin@empresa.com/)
})

test('cadastro completo: nome e sobrenome, telefone, área e e-mail', () => {
  assert.deepEqual(profileProblems({ full_name: 'Ana Souza', phone: '(62) 99999-0000', department: 'tecnico', email: 'ana@x.com' }), [])
  assert.deepEqual(profileProblems({ full_name: 'Ana', phone: '123', department: '', email: 'x' }), ['nome e sobrenome', 'telefone com DDD', 'área de trabalho', 'e-mail'])
})

import { renewalMoveCheck, overrideProblem } from '../src/lib/rules/renewal-process.ts'

test('processo de renovação: entrar antes do prazo ou sair dentro dele pede digitar mudar', () => {
  const base = { renewalStageId: 'R', prepDays: 90 }
  assert.equal(renewalMoveCheck({ ...base, fromStageId: 'G', toStageId: 'R', daysLeft: 120 }).ok, false)
  assert.equal(renewalMoveCheck({ ...base, fromStageId: 'G', toStageId: 'R', daysLeft: 90 }).ok, true)
  assert.equal(renewalMoveCheck({ ...base, fromStageId: 'R', toStageId: 'G', daysLeft: 45 }).ok, false)
  assert.equal(renewalMoveCheck({ ...base, fromStageId: 'R', toStageId: 'G', daysLeft: 120 }).ok, true)
  assert.equal(renewalMoveCheck({ ...base, fromStageId: 'A', toStageId: 'B', daysLeft: 10 }).ok, true)
  assert.equal(renewalMoveCheck({ renewalStageId: null, prepDays: 90, fromStageId: 'G', toStageId: 'R', daysLeft: 200 }).ok, true)
  assert.equal(renewalMoveCheck({ ...base, fromStageId: 'G', toStageId: 'R', daysLeft: null }).ok, true)
  assert.ok(overrideProblem(null))
  assert.equal(overrideProblem({ word: 'MUDAR', reason: '' }), null) // motivo é opcional
  assert.ok(overrideProblem({ word: 'trocar', reason: 'cliente pediu para antecipar' }))
  assert.equal(overrideProblem({ word: ' mudar ' }), null)
})

import { resolveRulerSettings, DEFAULT_RULER_STEPS } from '../src/lib/agent/renewal-ruler.ts'

test('régua: passos com áreas da empresa e "concluído quando"', () => {
  assert.equal(DEFAULT_RULER_STEPS[0].days_before, 90)
  const s = resolveRulerSettings({ renewal_ruler: { steps: [
    { id: 'aviso', label: 'Aviso', days_before: 60, areas: [] },
    { id: 'x', label: 'Análise', days_before: 45, areas: ['area:11111111-2222-3333-4444-555555555555', 'inexistente'] },
    { id: 'y', label: 'Prep', days_before: 90, areas: [], done_when: 'client_notice' },
  ] } })
  assert.equal(s.steps[0].done_when, 'client_notice') // id antigo "aviso"
  assert.deepEqual(s.steps[1].areas, ['area:11111111-2222-3333-4444-555555555555'])
  assert.equal(s.steps[1].done_when, 'manual')
  assert.equal(s.steps[2].done_when, 'client_notice')
})

import { buildRunSteps, openStepIndexes, stepGroup, RULER_MODEL_STEPS } from '../src/lib/agent/renewal-ruler.ts'

test('régua: quem faz, anexo e passos em paralelo', () => {
  const s = resolveRulerSettings({ renewal_ruler: { steps: [
    { id: 'a', label: 'A', days_before: 60, areas: ['area:11111111-2222-3333-4444-555555555555'] },
    { id: 'b', label: 'B', days_before: 55, areas: [], who: 'agent', instructions: ' pauta ', requires_file: true, with_previous: true },
    { id: 'c', label: 'C', days_before: 50, areas: [], who: 'xx', with_previous: true },
    { id: 'd', label: 'D', days_before: 40, areas: [] },
  ] } })
  assert.equal(s.steps[0].who, 'areas')       // legado com área da empresa
  assert.equal(s.steps[1].who, 'agent')
  assert.equal(s.steps[1].instructions, 'pauta')
  assert.equal(s.steps[1].requires_file, true)
  assert.equal(s.steps[2].who, 'owner')        // valor inválido → consultor
  assert.equal(s.steps[0].with_previous, false)
  const run = buildRunSteps(s.steps, '2027-03-31')
  assert.deepEqual(stepGroup(run, 0), [0, 1, 2])
  assert.deepEqual(openStepIndexes(run), [0])
  run[0].notified_at = run[1].notified_at = run[2].notified_at = 'x'
  run[1].done_at = 'y'
  assert.deepEqual(openStepIndexes(run), [0, 2])
  run[0].done_at = run[2].done_at = 'y'
  assert.deepEqual(openStepIndexes(run), [3])
  assert.equal(RULER_MODEL_STEPS.length, 9)
  assert.equal(resolveRulerSettings({}).skip_by, 'team')
  assert.equal(resolveRulerSettings({}).escalate_after_days, 3)
  assert.equal(resolveRulerSettings({ renewal_ruler: { escalate_after_days: 0 } }).escalate_after_days, 0)
  const sa = resolveRulerSettings({ renewal_ruler: { steps: [{ label: 'X', days_before: 5, who: 'agent', send_areas: ['area:11111111-2222-3333-4444-555555555555', 'comercial'] }] } })
  assert.deepEqual(sa.steps[0].send_areas, ['area:11111111-2222-3333-4444-555555555555'])
  assert.equal(resolveRulerSettings({ renewal_ruler: { skip_by: 'admin' } }).skip_by, 'admin')
  assert.ok(RULER_MODEL_STEPS.every(x => resolveRulerSettings({ renewal_ruler: { steps: [x] } }).steps.length === 1))
})

import { isWaiting, shouldNotifyOverdue } from '../src/lib/agent/renewal-ruler.ts'
test('régua: aguardando o cliente não cobra até a data', () => {
  const st = { due_date: '2027-03-16', done_at: null, overdue_notified_at: null, waiting_until: '2027-03-25' }
  assert.equal(isWaiting(st, '2027-03-20'), true)
  assert.equal(shouldNotifyOverdue(st, '2027-03-20', 3), false)
  assert.equal(shouldNotifyOverdue(st, '2027-03-26', 3), true)
})

import { normalizeUf } from '../src/lib/geo/uf.ts'
test('estado: sigla, nome e variações viram UF', () => {
  assert.equal(normalizeUf('sp'), 'SP')
  assert.equal(normalizeUf('São Paulo'), 'SP')
  assert.equal(normalizeUf('sao paulo'), 'SP')
  assert.equal(normalizeUf('Belo Horizonte - MG'), 'MG')
  assert.equal(normalizeUf('Distrito Federal'), 'DF')
  assert.equal(normalizeUf('XX'), null)
  assert.equal(normalizeUf(''), null)
})

import { mapCompra, matchWatcher, parseTerms, pncpDate, isOpen, normText } from '../src/lib/pncp/catalog.ts'
test('licitações: leitura do PNCP e monitoramento por objeto', () => {
  const r = mapCompra({
    numeroControlePNCP: '123-1-000001/2026', objetoCompra: 'Contratação de empresa para MANUTENÇÃO preventiva de equipamentos médico-hospitalares',
    orgaoEntidade: { cnpj: '12345678000199', razaoSocial: 'Hospital X' }, unidadeOrgao: { ufSigla: 'SP', municipioNome: 'Campinas' },
    modalidadeId: 6, valorTotalEstimado: 250000, dataEncerramentoProposta: '2026-11-20T10:00:00', situacaoCompraId: 1,
  })
  assert.equal(r.uf, 'SP')
  assert.equal(r.data_encerramento, '2026-11-20T10:00:00-03:00')
  assert.ok(r.objeto_norm.includes('manutencao preventiva de equipamentos medico-hospitalares'))
  const w = { keywords: ['Equipamentos médico-hospitalares'], exclude: [], ufs: ['SP'], modalidades: [6], min_value: 100000, max_value: null }
  assert.deepEqual(matchWatcher(r, w), ['Equipamentos médico-hospitalares'])
  assert.deepEqual(matchWatcher(r, { ...w, ufs: ['RJ'] }), [])
  assert.deepEqual(matchWatcher(r, { ...w, exclude: ['preventiva'] }), [])
  assert.deepEqual(matchWatcher(r, { ...w, min_value: 300000 }), [])
  assert.deepEqual(matchWatcher({ ...r, valor_estimado: 0 }, { ...w, min_value: 300000 }).length, 1) // sigiloso não descarta
  assert.equal(isOpen(r, Date.parse('2026-11-19T00:00:00Z')), true)
  assert.equal(isOpen(r, Date.parse('2026-11-21T00:00:00Z')), false)
  assert.equal(isOpen({ ...r, situacao_id: 2 }, 0), false)
  assert.deepEqual(parseTerms('engenharia clínica, Engenharia Clinica\nmanutenção;'), ['engenharia clínica', 'manutenção'])
  assert.equal(pncpDate('2026-01-02'), '2026-01-02T00:00:00-03:00')
  assert.equal(normText(' Órgão  Público '), 'orgao publico')
})

import { termHits, stem } from '../src/lib/pncp/catalog.ts'
test('licitações: palavras em qualquer ordem, plural e frase exata', () => {
  const t = normText('Contratação de empresa especializada para manutenção preventiva, corretiva e calibração com fornecimento de peças em equipamentos médico-hospitalar')
  assert.equal(termHits(t, 'manutenção equipamentos médicos'), true)
  assert.equal(termHits(t, 'calibrações de equipamentos hospitalares'), true)
  assert.equal(termHits(t, 'engenharia clínica'), false)
  assert.equal(termHits(t, '"manutenção equipamentos"'), false)   // frase exata
  assert.equal(termHits(t, '"manutenção preventiva"'), true)
  assert.equal(termHits(normText('serviços em hospitais estaduais'), 'hospital'), true)
  assert.equal(stem('hospitais'), 'hospita')
})
