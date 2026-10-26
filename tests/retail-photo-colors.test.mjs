import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readPhotoMeta, photosForColor, colorCoverage, missingModelColors, insertModelPhoto, isAiPhotoPath } from '../src/lib/retail/photo-colors.ts'

const T = 't1'
const real = `${T}/produtos/p/areia.jpg`, realOff = `${T}/produtos/p/off.jpg`, ai = `${T}/ia/look-1.jpg`, any = `${T}/produtos/p/detalhe.jpg`

test('lê o meta: só fotos e cores da peça; foto do Estúdio conta como com modelo', () => {
  const m = readPhotoMeta({ [real]: { color: 'Areia' }, [realOff]: { color: 'Roxo' }, sobra: { color: 'Areia' } }, [real, realOff, ai], ['Areia', 'Off White'])
  assert.deepEqual(m[real], { color: 'Areia', model: false })
  assert.deepEqual(m[realOff], { color: null, model: false }) // cor que não existe na peça
  assert.deepEqual(m[ai], { color: null, model: true })
  assert.equal('sobra' in m, false)
  assert.equal(isAiPhotoPath(ai), true)
  assert.equal(isAiPhotoPath(real), false)
})

test('fotos da cor: as da cor primeiro, depois as sem cor', () => {
  const photos = [any, real, realOff]
  const m = readPhotoMeta({ [real]: { color: 'Areia' }, [realOff]: { color: 'Off White' } }, photos, ['Areia', 'Off White'])
  assert.deepEqual(photosForColor(photos, m, 'Areia'), [real, any])
  assert.deepEqual(photosForColor(photos, m, 'Off White'), [realOff, any])
  assert.deepEqual(photosForColor(photos, m, null), photos)
  assert.deepEqual(photosForColor([real], m, 'Off White'), [real]) // nada da cor nem sem cor: mostra todas
})

test('aviso do Estúdio: só peça com mais de uma cor, e diz qual foto real serve de base', () => {
  const photos = [real, realOff, ai]
  const m = readPhotoMeta({ [real]: { color: 'Areia' }, [realOff]: { color: 'Off White' }, [ai]: { color: 'Areia', model: true } }, photos, ['Areia', 'Off White'])
  assert.deepEqual(colorCoverage(photos, m, ['Areia', 'Off White']), [{ color: 'Areia', model: true, reference: 0 }, { color: 'Off White', model: false, reference: 1 }])
  assert.deepEqual(missingModelColors(photos, m, ['Areia', 'Off White']).map(c => c.color), ['Off White'])
  assert.deepEqual(missingModelColors(photos, m, ['Areia']), []) // uma cor só: sem aviso
  const semFoto = missingModelColors([real], readPhotoMeta({ [real]: { color: 'Areia' } }, [real], ['Areia', 'Preto']), ['Areia', 'Preto'])
  assert.deepEqual(semFoto, [{ color: 'Areia', model: false, reference: 0 }, { color: 'Preto', model: false, reference: null }])
})

test('foto com modelo publicada entra depois das outras com modelo, na frente das demais', () => {
  const ai2 = `${T}/ia/look-2.jpg`
  const m = readPhotoMeta({}, [ai, real, any], [])
  assert.deepEqual(insertModelPhoto([ai, real, any], m, ai2), [ai, ai2, real, any])
  assert.deepEqual(insertModelPhoto([real, any], readPhotoMeta({}, [real, any], []), ai2), [ai2, real, any])
  assert.deepEqual(insertModelPhoto([ai, real], m, ai), [ai, real]) // já estava: não duplica
})
