import { test } from 'node:test'
import assert from 'node:assert/strict'
import { codesInText, utmCodesInText, linkedMeta, sumMeta, tokenState, metaAuthUrl, adAccountNumber, metaMonthlyCosts } from '../src/lib/ads/meta.ts'

test('acha o código da campanha no link do anúncio (normal, url_tags, codificado)', () => {
  assert.deepEqual(codesInText('https://loja.workers.dev/?loja=amaras&c=dia-das-maes'), ['dia-das-maes'])
  assert.deepEqual(codesInText(JSON.stringify({ url_tags: 'c=bio&utm_source=ig' })), ['bio'])
  assert.deepEqual(codesInText('https%3A%2F%2Fx.com%2F%3Floja%3Da%26c%3Dnatal-2'), ['natal-2'])
  assert.deepEqual(codesInText('https://x.com/?abc=1&cc=2'), [])
  assert.deepEqual(codesInText('%E0%A4%A'), [])
})

test('liga pelo código ou à mão; soma gasto, alcance e cliques', () => {
  const s = [
    { meta_campaign_id: '1', name: 'A', status: 'ACTIVE', spend: 100.5, reach: 1000, impressions: 3000, clicks: 40, codes: ['bio'], utm_codes: [] },
    { meta_campaign_id: '2', name: 'B', status: 'PAUSED', spend: 50, reach: 500, impressions: 900, clicks: 10, codes: [], utm_codes: ['black_friday'] },
    { meta_campaign_id: '3', name: 'C', status: 'ACTIVE', spend: 7, reach: 1, impressions: 1, clicks: 1, codes: ['outra'], utm_codes: [] },
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
  assert.equal(u.searchParams.get('scope'), 'ads_read,pages_show_list,pages_manage_metadata,pages_read_engagement,leads_retrieval')
  const u2 = new URL(metaAuthUrl({ version: 'v23.0', appId: '123', redirectUri: 'https://app/x', state: 's1', configId: '999' }))
  assert.equal(u2.searchParams.get('config_id'), '999')
  assert.equal(u2.searchParams.get('scope'), null)
  assert.equal(adAccountNumber('act_123456'), '123456')
})

test('Marketing: utm_campaign no link liga a campanha e o gasto entra por mês', () => {
  assert.deepEqual(utmCodesInText('https://site.com/lp?utm_source=meta&utm_campaign=black_friday'), ['black_friday'])
  assert.deepEqual(codesInText('https://site.com/lp?utm_campaign=black_friday'), [])
  const stats = [
    { meta_campaign_id: '2', name: 'B', status: 'ACTIVE', spend: 80, reach: 0, impressions: 0, clicks: 0, codes: [], utm_codes: ['black_friday'] },
    { meta_campaign_id: '5', name: 'E', status: 'ACTIVE', spend: 20, reach: 0, impressions: 0, clicks: 0, codes: [], utm_codes: [] },
  ]
  const months = [
    { meta_campaign_id: '2', year: 2026, month: 10, spend: 50.1 }, { meta_campaign_id: '2', year: 2026, month: 11, spend: 29.9 },
    { meta_campaign_id: '5', year: 2026, month: 10, spend: 20 }, { meta_campaign_id: '9', year: 2026, month: 10, spend: 999 },
  ]
  const out = metaMonthlyCosts(stats, months, [{ id: 'mk1', utm_campaign: 'black_friday', meta_campaign_ids: ['5'] }, { id: 'mk2', utm_campaign: 'outra', meta_campaign_ids: [] }])
  assert.deepEqual(out.sort((a, b) => a.month - b.month), [{ campaign_id: 'mk1', year: 2026, month: 10, amount: 70.1 }, { campaign_id: 'mk1', year: 2026, month: 11, amount: 29.9 }])
  assert.equal(linkedMeta(stats, { code: 'black_friday' }, 'varejo').length, 0)
})

test('lead do formulário: campos padrão do Meta e perguntas extras na mensagem', async () => {
  const { metaLeadFields, leadgenChanges } = await import('../src/lib/ads/meta.ts')
  const f = metaLeadFields([
    { name: 'full_name', values: ['Ana Souza'] }, { name: 'email', values: ['ANA@Ex.com '] }, { name: 'phone_number', values: ['+5511999990000'] },
    { name: 'company_name', values: ['Acme'] }, { name: 'qual_o_tamanho_da_equipe?', values: ['10 a 50'] }, { name: 'vazio', values: [] },
  ])
  assert.deepEqual(f, { name: 'Ana Souza', email: 'ana@ex.com', phone: '+5511999990000', company_name: 'Acme', cnpj: null, message: 'qual o tamanho da equipe: 10 a 50' })
  assert.equal(metaLeadFields([{ name: 'first_name', values: ['Rui'] }, { name: 'last_name', values: ['Lima'] }, { name: 'email', values: ['ruim'] }]).name, 'Rui Lima')
  assert.equal(metaLeadFields([{ name: 'email', values: ['ruim'] }]).email, null)
  const ch = leadgenChanges({ object: 'page', entry: [{ changes: [{ field: 'leadgen', value: { leadgen_id: 11, page_id: 22, form_id: 33, created_time: 1 } }, { field: 'feed', value: {} }] }] })
  assert.deepEqual(ch, [{ leadgen_id: '11', page_id: '22', form_id: '33', ad_id: null, created_time: 1 }])
  assert.deepEqual(leadgenChanges({ object: 'user', entry: [] }), [])
})

test('assinaturas do Meta: aviso (X-Hub-Signature-256) e pedido de exclusão (signed_request)', async () => {
  const { createHmac } = await import('node:crypto')
  const { validWebhookSignature, parseSignedRequest } = await import('../src/lib/ads/meta-crypto.ts')
  const body = '{"object":"page"}'
  const sig = 'sha256=' + createHmac('sha256', 'segredo').update(body).digest('hex')
  assert.equal(validWebhookSignature(body, sig, 'segredo'), true)
  assert.equal(validWebhookSignature(body + ' ', sig, 'segredo'), false)
  assert.equal(validWebhookSignature(body, null, 'segredo'), false)
  const b64 = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const payload = b64(JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: '123' }))
  const s = b64(createHmac('sha256', 'segredo').update(payload).digest())
  assert.equal(parseSignedRequest(`${s}.${payload}`, 'segredo')?.user_id, '123')
  assert.equal(parseSignedRequest(`${s}.${payload}`, 'outro'), null)
  assert.equal(parseSignedRequest('lixo', 'segredo'), null)
})
