'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createRetailOrder } from '@/lib/actions/retail-orders'
import { fmtBRL } from '@/lib/format'
import { ORDER_STATUSES, PAYMENT_METHODS, formatPhone } from '@/lib/retail/customers'
import { parseMoney } from '@/lib/retail/products'

export type CatalogItem = { variant_id: string; label: string; code: string; sku: string; price: number; stock: number }
export type CustomerOption = { id: string; name: string; phone: string | null; email?: string | null; birth_date?: string | null }

const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-700 focus:outline-none'
const lbl = 'mb-1 block text-sm font-medium text-gray-800'

const STATUS_HELP: Record<string, string> = {
  enviado_atendimento: 'Chegou agora; ainda vou falar com ela.',
  aguardando_pagamento: 'Já mandei o valor; falta ela pagar.',
  pago: 'Já recebi. O estoque baixa agora.',
  enviado: 'Paga e já saiu para entrega.',
  entregue: 'Paga e ela já recebeu.',
}
const H = ({ n, children }: { n: number; children: React.ReactNode }) => (
  <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800">{n}</span>{children}</h2>
)

export function OrderBuilder({ catalog, customers, initialCustomerId }: { catalog: CatalogItem[]; customers: CustomerOption[]; initialCustomerId: string | null }) {
  const router = useRouter()
  const initial = customers.find(c => c.id === initialCustomerId) ?? null
  const [customer, setCustomer] = useState<CustomerOption | null>(initial)
  const [customerQuery, setCustomerQuery] = useState('')
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newBirth, setNewBirth] = useState('')
  const [itemQuery, setItemQuery] = useState('')
  const [items, setItems] = useState<{ variant_id: string; qty: number }[]>([])
  const [discount, setDiscount] = useState('')
  const [shipping, setShipping] = useState('')
  const [method, setMethod] = useState('pix')
  const [condition, setCondition] = useState('')
  const [link, setLink] = useState('')
  const [status, setStatus] = useState('aguardando_pagamento')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const byId = useMemo(() => new Map(catalog.map(c => [c.variant_id, c])), [catalog])
  const cq = customerQuery.trim().toLowerCase(), cd = customerQuery.replace(/\D/g, '')
  const customerMatches = cq ? customers.filter(c => c.name.toLowerCase().includes(cq) || (cd.length >= 3 && (c.phone ?? '').includes(cd))).slice(0, 8) : []
  const iq = itemQuery.trim().toLowerCase()
  const itemMatches = iq ? catalog.filter(c => c.label.toLowerCase().includes(iq) || c.code.toLowerCase().includes(iq) || c.sku.toLowerCase().includes(iq)).slice(0, 10) : []

  // Prévia: o valor final é recalculado no servidor com os preços do banco
  const subtotal = items.reduce((s, it) => s + (byId.get(it.variant_id)?.price ?? 0) * it.qty, 0)
  const total = Math.max(0, subtotal - (parseMoney(discount) ?? 0) + (parseMoney(shipping) ?? 0))

  function addItem(id: string) {
    setItems(prev => prev.some(p => p.variant_id === id) ? prev.map(p => (p.variant_id === id ? { ...p, qty: p.qty + 1 } : p)) : [...prev, { variant_id: id, qty: 1 }])
    setItemQuery('')
  }

  async function submit() {
    setBusy(true); setError(null)
    const r = await createRetailOrder({
      customer_id: customer?.id ?? null,
      new_customer: !customer && newName.trim() ? { name: newName, phone: newPhone, email: newEmail, birth_date: newBirth || null } : null,
      customer_patch: customer ? { phone: newPhone || null, email: newEmail || null, birth_date: newBirth || null } : null,
      items, discount, shipping, payment_method: method, payment_condition: condition, payment_link: link, status, notes,
    })
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    router.replace(`/varejo/pedidos/${r.id}`)
  }

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
        <H n={1}>Quem está comprando?</H>
        {customer ? (
          <>
            <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm">
              <span>{customer.name} · {formatPhone(customer.phone)}{customer.email ? ` · ${customer.email}` : ''}</span>
              <button type="button" onClick={() => { setCustomer(null); setNewPhone(''); setNewEmail(''); setNewBirth('') }} className="text-brand-700 hover:underline">Trocar</button>
            </div>
            {(!customer.phone || !customer.email || !customer.birth_date) && (
              <div className="space-y-2 rounded-lg border border-warn-600/30 bg-warn-100/40 p-3">
                <p className="text-xs text-gray-700">Complete o cadastro: WhatsApp e e-mail são obrigatórios (os avisos do pedido vão por eles). O aniversário é opcional.</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {!customer.phone && <input className={inp} inputMode="tel" value={newPhone} onChange={e => setNewPhone(e.target.value)} placeholder="WhatsApp com DDD" aria-label="WhatsApp" />}
                  {!customer.email && <input className={inp} type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="E-mail" aria-label="E-mail" />}
                  {!customer.birth_date && <label className="text-xs text-gray-600">Aniversário<input className={inp} type="date" value={newBirth} onChange={e => setNewBirth(e.target.value)} /></label>}
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <input className={inp} value={customerQuery} onChange={e => setCustomerQuery(e.target.value)} placeholder="Buscar cliente por nome ou telefone" />
            {customerMatches.length > 0 && (
              <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                {customerMatches.map(c => (
                  <li key={c.id}><button type="button" onClick={() => { setCustomer(c); setCustomerQuery(''); setNewPhone(''); setNewEmail(''); setNewBirth('') }} className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50">{c.name} · {formatPhone(c.phone)}</button></li>
                ))}
              </ul>
            )}
            <p className="text-xs text-gray-500">Ou cadastre agora (se o telefone já existir, o pedido vai para a cliente existente):</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input className={inp} value={newName} onChange={e => setNewName(e.target.value)} placeholder="Nome" aria-label="Nome" />
              <input className={inp} inputMode="tel" value={newPhone} onChange={e => setNewPhone(e.target.value)} placeholder="WhatsApp com DDD" aria-label="WhatsApp" />
              <input className={inp} type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="E-mail" aria-label="E-mail" />
              <label className="text-xs text-gray-600">Aniversário (opcional)<input className={inp} type="date" value={newBirth} onChange={e => setNewBirth(e.target.value)} /></label>
            </div>
          </>
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
        <H n={2}>O que ela vai levar?</H>
        {catalog.length === 0 && <p className="rounded-lg bg-warn-100 px-3 py-2 text-sm text-warn-700">Nenhuma peça cadastrada ainda. Cadastre em Varejo → Produtos e volte aqui.</p>}
        <input className={inp} value={itemQuery} onChange={e => setItemQuery(e.target.value)} placeholder="Digite o nome, o código ou a cor da peça" />
        {iq && itemMatches.length === 0 && <p className="text-xs text-gray-500">Nenhuma peça encontrada com &quot;{itemQuery}&quot;.</p>}
        {itemMatches.length > 0 && (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
            {itemMatches.map(c => (
              <li key={c.variant_id}>
                <button type="button" onClick={() => addItem(c.variant_id)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50">
                  <span>{c.label} <span className="text-xs text-gray-500">({c.code})</span></span>
                  <span className={`whitespace-nowrap text-xs ${c.stock > 0 ? 'text-gray-600' : 'text-negative-700'}`}>{fmtBRL(c.price)} · {c.stock > 0 ? `${c.stock} em estoque` : 'esgotada'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {items.length === 0 ? <p className="text-sm text-gray-500">Busque acima e toque na peça para incluir. Tocar de novo soma mais uma unidade.</p> : (
          <ul className="space-y-2">
            {items.map(it => {
              const c = byId.get(it.variant_id)
              return (
                <li key={it.variant_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-100 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1">{c?.label ?? 'Peça'}{c && it.qty > c.stock && <span className="block text-xs text-warn-700">Estoque atual: {c.stock}. O pagamento só é confirmado com estoque.</span>}</span>
                  <span className="flex items-center gap-2">
                    <input type="number" min={1} max={99} value={it.qty} onChange={e => setItems(prev => prev.map(p => (p.variant_id === it.variant_id ? { ...p, qty: Math.max(1, Math.min(99, Number(e.target.value) || 1)) } : p)))} className="w-16 rounded-lg border border-gray-300 px-2 py-1 text-sm" aria-label="Quantidade" />
                    <span className="w-24 text-right">{fmtBRL((c?.price ?? 0) * it.qty)}</span>
                    <button type="button" onClick={() => setItems(prev => prev.filter(p => p.variant_id !== it.variant_id))} className="text-xs text-negative-700">Remover</button>
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
        <H n={3}>Pagamento e entrega</H>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label className={lbl}>Forma de pagamento</label>
            <select className={inp} value={method} onChange={e => setMethod(e.target.value)}>{PAYMENT_METHODS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></div>
          <div><label className={lbl}>Condição</label><input className={inp} value={condition} onChange={e => setCondition(e.target.value)} placeholder="ex.: 5% no Pix, 3x sem juros" /></div>
          <div><label className={lbl}>Desconto (R$)</label><input className={inp} inputMode="decimal" value={discount} onChange={e => setDiscount(e.target.value)} placeholder="0,00" /></div>
          <div><label className={lbl}>Frete (R$)</label><input className={inp} inputMode="decimal" value={shipping} onChange={e => setShipping(e.target.value)} placeholder="0,00" /></div>
          <div className="sm:col-span-2"><label className={lbl}>Link de pagamento (opcional)</label><input className={inp} value={link} onChange={e => setLink(e.target.value)} placeholder="cole aqui o link do Mercado Pago, PagSeguro…" /><p className="mt-1 text-xs text-gray-500">Vai junto na mensagem do pedido para a cliente.</p></div>
        </div>
        <div><label className={lbl}>Observações</label><textarea className={inp} rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="ex.: entregar depois das 18h, embrulhar para presente" /></div>
      </section>

      <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
        <H n={4}>Em que pé está o pedido?</H>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {ORDER_STATUSES.filter(st => st.id !== 'cancelado').map(st => (
            <label key={st.id} className={`cursor-pointer rounded-lg border p-3 ${status === st.id ? 'border-brand-700 bg-brand-100/50' : 'border-gray-200 hover:border-gray-300'}`}>
              <span className="flex items-center gap-2 text-sm font-medium text-gray-900">
                <input type="radio" name="order-status" checked={status === st.id} onChange={() => setStatus(st.id)} />{st.label}
              </span>
              <span className="mt-1 block text-xs text-gray-500">{STATUS_HELP[st.id]}</span>
            </label>
          ))}
        </div>
        <p className="text-xs text-gray-500">Dá para mudar depois, na tela do pedido.</p>
      </section>

      <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
        <div className="flex justify-between"><span className="text-gray-600">Subtotal</span><span>{fmtBRL(subtotal)}</span></div>
        <div className="mt-1 flex justify-between font-semibold text-gray-900"><span>Total</span><span>{fmtBRL(total)}</span></div>
        <p className="mt-1 text-xs text-gray-500">Prévia. O total é recalculado pelo CRM com os preços cadastrados ao salvar.</p>
      </div>

      {error && <p role="alert" className="rounded-lg bg-negative-100 px-3 py-2 text-sm text-negative-700">{error}</p>}
      <div className="flex justify-end">
        <button type="button" onClick={submit} disabled={busy || items.length === 0} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">{busy ? 'Salvando…' : 'Criar pedido'}</button>
      </div>
    </div>
  )
}
