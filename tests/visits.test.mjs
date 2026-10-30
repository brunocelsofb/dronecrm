import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pageRef, referrerHost, sourceLabel, visitMetrics, periodOf, daysBetween, isBot, deviceOf, change, pageKey } from '../src/lib/analytics/visits.ts'

test('endereço da página: host sem www, caminho limpo, utm e código da campanha', () => {
  const r = pageRef('https://www.Orbis.com.br/LP/Diagnostico/?utm_source=Meta&utm_medium=cpc&utm_campaign=Black_Friday&c=dia-das-maes#topo')
  assert.equal(r.host, 'orbis.com.br'); assert.equal(r.path, '/lp/diagnostico')
  assert.equal(r.utm.utm_campaign, 'black_friday'); assert.equal(r.campaign_code, 'dia-das-maes')
  assert.equal(pageRef('https://x.com/index.html').path, '/')
  assert.equal(pageRef('javascript:alert(1)'), null)
  assert.equal(pageKey('x.com', '/'), 'x.com'); assert.equal(pageKey('x.com', '/a'), 'x.com/a')
})

test('origem: utm vence; senão o site que mandou; mesmo site não conta', () => {
  assert.equal(sourceLabel({ utm_source: 'meta', utm_medium: 'cpc' }), 'Meta (Facebook/Instagram) — anúncio')
  assert.equal(sourceLabel({ referrer_host: 'l.instagram.com' }), 'Instagram')
  assert.equal(sourceLabel({ referrer_host: 'google.com.br' }), 'Google')
  assert.equal(sourceLabel({}), 'Direto ou link sem origem')
  assert.equal(referrerHost('https://www.orbis.com.br/x', 'orbis.com.br'), null)
  assert.equal(referrerHost('https://l.facebook.com/', 'orbis.com.br'), 'l.facebook.com')
})

test('métricas: únicos por dia, abandono e tempo médio (com teto de 30 min)', () => {
  const base = { host: 'x', path: '/', utm_source: null, utm_medium: null, utm_campaign: null, campaign_code: null, referrer_host: null, device: null, started_at: '' }
  const m = visitMetrics([
    { ...base, visited_on: '2026-10-01', visitor_day: 'a', duration_ms: 4000, engaged: false },
    { ...base, visited_on: '2026-10-01', visitor_day: 'a', duration_ms: 20000, engaged: true },
    { ...base, visited_on: '2026-10-02', visitor_day: 'a', duration_ms: 99999999, engaged: true },
  ])
  assert.equal(m.visits, 3); assert.equal(m.uniques, 2)
  assert.equal(Math.round(m.bounceRate * 1000), 333)
  assert.equal(m.avgMs, (4000 + 20000 + 1800000) / 3)
  assert.deepEqual(visitMetrics([]), { visits: 0, uniques: 0, bounceRate: null, avgMs: null })
  assert.equal(change(150, 100), 0.5); assert.equal(change(5, 0), null)
})

test('períodos: este mês × mesmo trecho do mês anterior; mês passado; 30 dias', () => {
  const p = periodOf('mes', '2026-10-30')
  assert.deepEqual([p.from, p.to, p.prevFrom, p.prevTo], ['2026-10-01', '2026-10-31', '2026-09-01', '2026-10-01'])
  const q = periodOf('mes', '2026-03-10')
  assert.deepEqual([q.from, q.to, q.prevFrom, q.prevTo], ['2026-03-01', '2026-03-11', '2026-02-01', '2026-02-11'])
  const m = periodOf('mes-passado', '2026-10-30')
  assert.deepEqual([m.from, m.to, m.prevFrom, m.prevTo], ['2026-09-01', '2026-10-01', '2026-08-01', '2026-09-01'])
  const d = periodOf('30d', '2026-10-30')
  assert.deepEqual([d.from, d.to], ['2026-10-01', '2026-10-31'])
  assert.equal(daysBetween('2026-10-01', '2026-10-04').length, 3)
})

test('robôs e aparelho', () => {
  assert.equal(isBot('facebookexternalhit/1.1'), true)
  assert.equal(isBot('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile Safari'), false)
  assert.equal(isBot(''), true)
  assert.equal(deviceOf(390, 'Mozilla/5.0 (iPhone) Mobile'), 'celular')
  assert.equal(deviceOf(1440, 'Mozilla/5.0 (Windows NT 10.0)'), 'computador')
})
