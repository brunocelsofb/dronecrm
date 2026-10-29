import { test } from 'node:test'
import assert from 'node:assert/strict'
import { codesInText, linkedMeta, sumMeta, tokenState, metaAuthUrl, adAccountNumber } from '../src/lib/retail/meta-ads.ts'

test('acha o código da campanha no link do anúncio (normal, url_tags, codificado)', () => {
  assert.deepEqual(codesInText('https://loja.workers.dev/?loja=amaras&c=dia-das-maes'), ['dia-das-maes'])
  assert.deepEqual(codesInText(JSON.stringify({ url_tags: 'c=bio&utm_source=ig' })), ['bio'])
  assert.deepEqual(codesInText('https%3A%2F%2Fx.com%2F%3Floja%3Da%26c%3Dnatal-2'), ['natal-2'])
  assert.deepEqual(codesInText('https://x.com/?abc=1&cc=2'), [])
  assert.deepEqual(codesInText('%E0%A4%A'), [])
})

test('liga pelo código ou à mão; soma gasto, alcance e cliques', () => {
  const s = [
    { meta_campaign_id: '1', name: 'A', status: 'ACTIVE', spend: 100.5, reach: 1000, impressions: 3000, clicks: 40, codes: ['bio'] },
    { meta_campaign_id: '2', name: 'B', status: 'PAUSED', spend: 50, reach: 500, impressions: 900, clicks: 10, codes: [] },
    { meta_campaign_id: '3', name: 'C', status: 'ACTIVE', spend: 7, reach: 1, impressions: 1, clicks: 1, codes: ['outra'] },
  ]
  const l = linkedMeta(s, { code: 'bio', meta_campaign_ids: ['2'] })
  assert.deepEqual(l.map(x => x.name), ['A', 'B'])
  assert.deepEqual(sumMeta(l), { spend: 150.5, reach: 1500, impressions: 3900, clicks: 50 })
  assert.deepEqual(linkedMeta(s, { code: 'nada', meta_campaign_ids: null }), [])
})

test('situação do acesso e endereço de autorização', () => {
  const now = new Date('2026-10-29T12:00:00Z')
  assert.equal(tokenState(null, now), 'ok')
  assert.equal(tokenState('2026-10-28T12:00:00Z', now), 'vencido')
  assert.equal(tokenState('2026-11-03T12:00:00Z', now), 'vence-logo')
  assert.equal(tokenState('2026-12-20T12:00:00Z', now), 'ok')
  const u = new URL(metaAuthUrl({ version: 'v23.0', appId: '123', redirectUri: 'https://app/x', state: 's1' }))
  assert.equal(u.pathname, '/v23.0/dialog/oauth')
  assert.equal(u.searchParams.get('scope'), 'ads_read')
  const u2 = new URL(metaAuthUrl({ version: 'v23.0', appId: '123', redirectUri: 'https://app/x', state: 's1', configId: '999' }))
  assert.equal(u2.searchParams.get('config_id'), '999')
  assert.equal(u2.searchParams.get('scope'), null)
  assert.equal(adAccountNumber('act_123456'), '123456')
})
