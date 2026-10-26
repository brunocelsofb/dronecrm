import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lookPrompt, isAiPhotoUrl, modelPrompt, validModel, defaultModel } from '../src/lib/retail/ai-studio.ts'

test('prompt do look segue a ordem das imagens', () => {
  const p = lookPrompt(2, true)
  assert.match(p, /Vou te enviar 4 imagens/)
  assert.match(p, /As imagens 2 a 3 são as de peças/)
  assert.match(p, /A última imagem é a de um \(cenário\)\./)
  const s = lookPrompt(1, false)
  assert.match(s, /Vou te enviar 2 imagens/)
  assert.doesNotMatch(s, /cenário/)
  assert.match(s, /A segunda imagem é a de uma peça de roupa feminina\./)
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

import { parseLookCopy, copyPrompt } from '../src/lib/retail/ai-studio.ts'
test('texto do look: lê o JSON da IA e valida a ocasião', () => {
  const t = 'Claro!\n```json\n{"site":"Alfaiataria leve para o dia todo.","social":"Elegância para a vida real ✨","hashtags":["#modafeminina","look do dia"],"occasion":{"id":"trabalho","name":"Trabalho","why":"Corte reto e tom sóbrio."}}\n```'
  const c = parseLookCopy(t, ['trabalho', 'igreja'])
  assert.equal(c.site, 'Alfaiataria leve para o dia todo.')
  assert.deepEqual(c.hashtags, ['modafeminina', 'lookdodia'])
  assert.equal(c.occasion.id, 'trabalho')
  assert.equal(parseLookCopy(t, ['igreja']).occasion.id, null)
  assert.equal(parseLookCopy('sem json', []), null)
  // o modelo do pedido não vale como resposta
  assert.equal(parseLookCopy(copyPrompt({ store: 'X', essence: 'Y', pieces: [], occasions: [] }), []), null)
})

test('ficha das peças: diz qual peça, a cor e manda trocar a roupa da modelo', async () => {
  const { pieceBrief } = await import('../src/lib/retail/ai-studio.ts')
  const t = pieceBrief([{ name: 'Calça Paris Chique', category: 'Calças', color: 'Preto' }])
  assert.match(t, /Imagem 2: Calça Paris Chique \(tipo: Calças\), cor Preto/)
  assert.match(t, /ignore o rosto, o corpo e as outras roupas/)
  assert.match(t, /Tire da modelo a roupa que ocupa o mesmo lugar/)
  assert.match(t, /respeite a cor indicada/)
  assert.equal(pieceBrief([]), '')
  const two = pieceBrief([{ name: 'Blusa', category: null, color: null }, { name: 'Saia', category: 'Saias', color: 'Azul' }])
  assert.match(two, /Imagem 2: Blusa\./)
  assert.match(two, /Imagem 3: Saia \(tipo: Saias\), cor Azul/)
})

test('completar o look leva a essência da loja', async () => {
  const { completeLookBrief } = await import('../src/lib/retail/ai-studio.ts')
  const t = completeLookBrief('Elegância para a vida real')
  assert.match(t, /Elegância para a vida real/)
  assert.match(t, /blusa se a peça for uma calça/)
})
