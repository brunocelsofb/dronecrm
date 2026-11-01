import { test } from 'node:test'
import assert from 'node:assert/strict'
import { THEO_TOOLS, THEO_PROVIDERS, effectiveTheoTools, toolsForPlanFeatures, estimateCostUsd, canUseTheo, theoSystemPrompt, toGeminiSchema, normalizeHistory, searchTerm, isTheoModel, defaultTheoModel } from '../src/lib/ai/theo-catalog.ts'

test('catálogo: nomes únicos, toda ferramenta com aba, tipo e esquema', () => {
  const names = THEO_TOOLS.map(t => t.name)
  assert.equal(new Set(names).size, names.length)
  for (const t of THEO_TOOLS) {
    assert.ok(t.feature && t.label && t.description && t.group, t.name)
    assert.ok(t.kind === 'consulta' || t.kind === 'acao', t.name)
    assert.equal(t.params.type, 'object')
    for (const r of t.params.required ?? []) assert.ok(r in t.params.properties, `${t.name}.${r}`)
  }
})

test('ferramentas da empresa: plano escolhido ∩ abas da licença', () => {
  const all = effectiveTheoTools(null, ['pipeline'])
  assert.ok(all.some(t => t.name === 'search_contracts'))
  assert.ok(all.some(t => t.name === 'minhas_atividades'))
  assert.ok(!all.some(t => t.name === 'buscar_leads'))
  const chosen = effectiveTheoTools(['search_contracts', 'buscar_leads'], ['pipeline'])
  assert.deepEqual(chosen.map(t => t.name), ['search_contracts'])
  assert.deepEqual(effectiveTheoTools([], ['pipeline', 'leads']), [])
  assert.ok(toolsForPlanFeatures(['varejo']).every(t => t.feature === '*' || t.feature === 'varejo'))
})

test('custo estimado por modelo e mudança de preço por data', () => {
  assert.equal(estimateCostUsd('anthropic', 'claude-haiku-5-5', 1_000_000, 1_000_000), 0.6)
  assert.equal(estimateCostUsd('gemini', 'gemini-3.8-flash', 1_000_000, 0, new Date('2026-12-31T12:00:00Z')), 0.75)
  assert.equal(estimateCostUsd('gemini', 'gemini-3.8-flash', 1_000_000, 0, new Date('2027-01-02T12:00:00Z')), 1.5)
  assert.equal(estimateCostUsd('openai', 'nao-existe', 1e6, 1e6), 0)
  for (const p of THEO_PROVIDERS) assert.ok(isTheoModel(p.id, defaultTheoModel(p.id)))
})

test('quem usa: admin sempre, outros só liberados', () => {
  assert.ok(canUseTheo('admin', 'u1', []))
  assert.ok(canUseTheo('user', 'u1', ['u1']))
  assert.ok(!canUseTheo('user', 'u1', ['u2']))
  assert.ok(!canUseTheo('user', 'u1', 'u1'))
})

test('instruções com o nome da empresa, nunca fixo', () => {
  assert.match(theoSystemPrompt('Amarás'), /CRM da Amarás/)
  assert.doesNotMatch(theoSystemPrompt('Amarás'), /ORBIS|Orbis/)
  assert.match(theoSystemPrompt(null), /CRM da empresa/)
})

test('esquema do Gemini e histórico normalizado', () => {
  const g = toGeminiSchema({ type: 'object', properties: { q: { type: 'string', description: 'x', enum: ['a'] } }, required: ['q'] })
  assert.deepEqual(g, { type: 'OBJECT', properties: { q: { type: 'STRING', description: 'x', enum: ['a'] } }, required: ['q'] })
  const h = normalizeHistory([{ role: 'assistant', text: 'oi' }, { role: 'user', text: 'a' }, { role: 'user', text: 'b' }, { role: 'assistant', text: ' ' }])
  assert.deepEqual(h, [{ role: 'user', text: 'a\n\nb' }])
  assert.equal(searchTerm('ana, (x)%*'), 'ana   x')
})
