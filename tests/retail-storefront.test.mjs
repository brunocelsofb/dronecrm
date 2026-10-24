// Testes da vitrine pública (endereço, ocasiões e pedido que chega).
import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanSlug, cleanDomain, readOccasions, readTheme, parseStorefrontOrder, phoneBR, storefrontWhatsappText } from '../src/lib/retail/storefront.ts'

test('endereço e domínio', () => {
  assert.equal(cleanSlug('Amarás Moda Feminina'), 'amaras-moda-feminina')
  assert.equal(cleanSlug('a'), null)
  assert.equal(cleanDomain('https://www.Amaras.com.br/loja?x=1'), 'amaras.com.br')
  assert.equal(cleanDomain('loja.amaras.com.br:443'), 'loja.amaras.com.br')
  assert.equal(cleanDomain('localhost'), null)
  assert.equal(cleanDomain('amaras'), null)
})

test('ocasiões: nome limpo, id estável, sem repetir', () => {
  assert.deepEqual(readOccasions(['Trabalho', { name: 'Igreja' }, 'trabalho', '  Festa  ', '']), [
    { id: 'trabalho', name: 'Trabalho' }, { id: 'igreja', name: 'Igreja' }, { id: 'festa', name: 'Festa' },
  ])
  assert.deepEqual(readOccasions([{ id: 'dia-a-dia', name: 'Dia a dia' }]), [{ id: 'dia-a-dia', name: 'Dia a dia' }])
  assert.equal(readTheme({ primary: 'red' }).primary, '#3D2314')
})

test('telefone do Brasil', () => {
  assert.equal(phoneBR('+55 (11) 98765-4321'), '11987654321')
  assert.equal(phoneBR('1187654321'), '11987654321') // celular antigo sem o 9
  assert.equal(phoneBR('123'), null)
})

test('pedido da vitrine: valida e recusa robô', () => {
  const v = '5f1c2a3b-1111-4222-8333-944455556666'
  const ok = parseStorefrontOrder({ customer: { name: ' Ana  Lima ', phone: '(31) 99999-0000', optin: true }, items: [{ variant_id: v, qty: 2 }] })
  assert.ok(ok.ok); assert.equal(ok.order.customer.name, 'Ana Lima'); assert.equal(ok.order.customer.phone, '31999990000'); assert.equal(ok.order.customer.optin, true)
  assert.equal(parseStorefrontOrder({ website: 'http://spam', customer: { name: 'x', phone: '31999990000' }, items: [] }).spam, true)
  assert.equal(parseStorefrontOrder({ customer: { name: 'Ana', phone: '999' }, items: [{ variant_id: v, qty: 1 }] }).ok, false)
  assert.equal(parseStorefrontOrder({ customer: { name: 'Ana', phone: '31999990000' }, items: [] }).error, 'Sua sacola está vazia.')
  assert.equal(parseStorefrontOrder({ customer: { name: 'Ana', phone: '31999990000' }, items: [{ variant_id: 'x', qty: 1 }] }).ok, false)
  assert.equal(parseStorefrontOrder({ customer: { name: 'Ana', phone: '31999990000', cep: '123' }, items: [{ variant_id: v, qty: 1 }] }).error, 'CEP precisa ter 8 números.')
})

test('mensagem do WhatsApp', () => {
  const t = storefrontWhatsappText({ store: 'Loja X', number: 7, name: 'Ana Lima', items: [{ name: 'Saia', color: 'Preto', size: 'M', qty: 1 }], total: 'R$ 99,90' })
  assert.match(t, /^Oi! Sou Ana e acabei de fazer o pedido nº 7 na vitrine da Loja X:\n• 1x Saia \(Preto \/ M\)\nTotal das peças: R\$ 99,90/)
})

import { readContent, DEFAULT_FAQ, DEFAULT_POLICIES } from '../src/lib/retail/storefront.ts'
test('textos da vitrine: limpa, aceita só https e usa as perguntas padrão', () => {
  const c = readContent({ hero_title: '  Elegância  ', instagram: 'http://x.com', city: '', faq: undefined })
  assert.equal(c.hero_title, 'Elegância'); assert.equal(c.instagram, null); assert.equal(c.city, null)
  assert.deepEqual(c.faq, DEFAULT_FAQ)
  assert.deepEqual(readContent({ faq: [{ q: 'A?', a: 'B' }, { q: '', a: 'x' }] }).faq, [{ q: 'A?', a: 'B' }])
  assert.deepEqual(readContent({ faq: [] }).faq, [])
  assert.deepEqual(readContent({}).policies, DEFAULT_POLICIES)
  assert.deepEqual(readContent({ policies: [{ title: ' Trocas ', text: '' }, { title: '', text: 'x' }] }).policies, [{ title: 'Trocas', text: '' }])
  assert.equal(readOccasions([{ name: 'Igreja', text: ' Delicadeza ' }])[0].text, 'Delicadeza')
})
