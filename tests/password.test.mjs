import { test } from 'node:test'
import assert from 'node:assert/strict'
import { passwordProblem } from '../src/lib/auth/password.ts'

test('regras de senha: tamanho, letras e números, diferente da atual, sem o e-mail', () => {
  assert.match(passwordProblem('abc123'), /8 caracteres/)
  assert.match(passwordProblem('abcdefgh'), /letras e números/)
  assert.match(passwordProblem('12345678'), /letras e números/)
  assert.equal(passwordProblem('drone2026x'), null)
  assert.match(passwordProblem('drone2026x', { current: 'drone2026x' }), /diferente/)
  assert.match(passwordProblem('brunocelsofb99', { email: 'brunocelsofb+meta@gmail.com' }), /e-mail/)
  assert.match(passwordProblem('x'.repeat(70) + '123'), /72/)
})
