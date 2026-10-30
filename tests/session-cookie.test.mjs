import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sessionOnly } from '../src/lib/supabase/session-cookie.ts'

test('login some ao fechar o navegador: sem validade, mas exclusão continua valendo', () => {
  assert.deepEqual(sessionOnly({ path: '/', sameSite: 'lax', maxAge: 34560000 }), { path: '/', sameSite: 'lax' })
  assert.deepEqual(sessionOnly({ path: '/', expires: new Date(Date.now() + 1e9) }), { path: '/' })
  assert.deepEqual(sessionOnly({ path: '/', maxAge: 0 }), { path: '/', maxAge: 0 })
  const past = new Date(0)
  assert.equal(sessionOnly({ path: '/', expires: past }).expires, past)
  assert.equal(sessionOnly(undefined), undefined)
})
