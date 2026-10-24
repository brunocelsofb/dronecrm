import test from 'node:test'
import assert from 'node:assert/strict'
import worker, { storeParams } from '../src/worker.js'

test('repassa o domínio e o endereço de teste limpo', () => {
  assert.equal(storeParams(new URL('https://amaras.com.br/')), 'host=amaras.com.br')
  assert.equal(storeParams(new URL('https://x.workers.dev/?loja=Amaras<script>')), 'loja=amarasscript&host=x.workers.dev')
})

test('páginas vão para os arquivos estáticos; rota desconhecida da API dá 404', async () => {
  let served = null
  const env = { ASSETS: { fetch: req => { served = new URL(req.url).pathname; return new Response('ok') } }, DRONE_API: 'https://drone.test/api/vitrine/v1' }
  await worker.fetch(new Request('https://loja.test/peca/1'), env, {})
  assert.equal(served, '/peca/1')
  const r = await worker.fetch(new Request('https://loja.test/api/nada'), env, {})
  assert.equal(r.status, 404)
})

test('pedido é repassado ao Drone com o domínio', async () => {
  const calls = []
  globalThis.fetch = async (u, init) => { calls.push([u, init?.method]); return new Response('{"number":1}', { status: 201 }) }
  const env = { ASSETS: { fetch: () => new Response('') }, DRONE_API: 'https://drone.test/api/vitrine/v1' }
  const r = await worker.fetch(new Request('https://amaras.com.br/api/pedido', { method: 'POST', body: '{}' }), env, {})
  assert.equal(r.status, 201)
  assert.deepEqual(calls[0], ['https://drone.test/api/vitrine/v1/pedido?host=amaras.com.br', 'POST'])
})
