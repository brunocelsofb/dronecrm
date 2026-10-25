import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lookPrompt, isAiPhotoUrl, modelPrompt, validModel, defaultModel } from '../src/lib/retail/ai-studio.ts'

test('prompt do look segue a ordem das imagens', () => {
  const p = lookPrompt(2, true)
  assert.match(p, /Vou te enviar 4 imagens/)
  assert.match(p, /As imagens 2 a 3 são as peças/)
  assert.match(p, /A última imagem é a de um provador/)
  const s = lookPrompt(1, false)
  assert.match(s, /Vou te enviar 2 imagens/)
  assert.doesNotMatch(s, /provador/)
})

test('selo de IA só para fotos do Estúdio da própria loja', () => {
  const t = '243a5db1-2905-4b5e-9cc9-40555174b2af'
  assert.equal(isAiPhotoUrl(`https://x.supabase.co/storage/v1/object/public/retail-media/${t}/ia/look-1.jpg`, t), true)
  assert.equal(isAiPhotoUrl(`https://x.supabase.co/storage/v1/object/public/retail-media/${t}/produtos/p/1.jpg`, t), false)
  assert.equal(isAiPhotoUrl(null, t), false)
})

test('modelo virtual e modelos de IA', () => {
  assert.match(modelPrompt({ age: '30 anos', body: '', skin: 'negra', hair: '', style: '', extra: '' }), /fictícia.*Idade aparente: 30 anos.*Tom de pele: negra/s)
  assert.equal(validModel('openai', defaultModel('openai')), true)
  assert.equal(validModel('gemini', 'qualquer'), false)
})
