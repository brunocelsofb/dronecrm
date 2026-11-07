'use client'

import { fmtPct, fmtNum1 } from '@/lib/format'
import { useState } from 'react'
import { addProposalItem, removeProposalItem } from '@/lib/actions/proposal-price-sections'

type Item = {
  id: string
  item: string
  quantity: number
  unit_value: number
  discount: number
  subtotal: number
  category?: string | null
  type?: string | null
}

type Conditions = {
  discount_type: string | null
  discount_value: number
  payment_terms: string | null
  installments: number
  is_recurring: boolean
  currency: string
}

function fmt(v: number, currency = 'BRL') {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(v)
}

type CatalogItem = { id: string; name: string; category: string | null; type: string | null; characteristics: string | null; unit_value: number | null }

export function ProposalItemsEditor({ proposalId, contractId, initialItems, initialConditions, canEdit, fromPrice = false, catalog = [] }: {
  proposalId: string
  contractId: string
  initialItems: Item[]
  initialConditions: Conditions
  canEdit: boolean
  fromPrice?: boolean   // itens e valores vêm do Price: não repete a tabela (o PDF também não)
  catalog?: CatalogItem[] // catálogo de produtos da empresa (Configurações → Propostas)
}) {
  const blank = { item: '', category: '', characteristics: '', quantity: 1, unit_value: 0, discount: 0, type: 'MRR' as 'MRR' | 'Pontual' }
  const [draft, setDraft] = useState(blank)
  const [adding, setAdding] = useState(false)
  const [itemError, setItemError] = useState<string | null>(null)
  function pickCatalog(id: string) {
    const c = catalog.find(x => x.id === id)
    if (!c) return
    setDraft(d => ({ ...d, item: c.name, category: c.category ?? '', characteristics: c.characteristics ?? '', unit_value: Number(c.unit_value) || 0, type: c.type === 'Pontual' ? 'Pontual' : 'MRR' }))
  }
  async function addItem() {
    setAdding(true); setItemError(null)
    const r = await addProposalItem(proposalId, { ...draft, category: draft.category || null, characteristics: draft.characteristics || null })
    setAdding(false)
    if (!r.ok) { setItemError(r.error); return }
    setItems(prev => [...prev, { id: r.id, item: draft.item, quantity: draft.quantity, unit_value: draft.unit_value, discount: draft.discount, subtotal: r.subtotal, category: draft.category || null, type: draft.type }])
    setDraft(blank)
  }
  const [items, setItems] = useState(initialItems)
  const [conditions, setConditions] = useState(initialConditions)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const total = items.reduce((s, it) => s + Number(it.subtotal), 0)

  async function deleteItem(id: string) {
    const before = items
    setItems(prev => prev.filter(it => it.id !== id))
    const r = await removeProposalItem(id, proposalId)
    if (!r.ok) { setItems(before); setItemError(r.error) }
  }

  async function saveConditions() {
    setSaving(true)
    await fetch(`/api/proposals/conditions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proposal_id: proposalId, ...conditions }),
    })
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const inp = 'border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:border-brand-700 w-full'

  return (
    <div className="space-y-4">
      {fromPrice ? (
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="text-sm font-medium text-gray-900">Itens e valores: vêm do Price</p>
          <p className="mt-0.5 text-xs text-gray-500">
            {items.map(it => `${it.item} — ${fmt(Number(it.subtotal), conditions.currency)}`).join(' · ') || 'Sem itens.'} · Total {fmt(total, conditions.currency)}.
            No PDF, o investimento sai nas tabelas do Price; para mudar valores, ajuste no Price e envie de novo.
          </p>
        </div>
      ) : (
      <div className="space-y-2">
        <h2 className="text-sm font-medium text-gray-900">Itens</h2>
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-xs">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Item</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Qtd</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Vlr. Unit.</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Desc.</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Subtotal</th>
                {canEdit && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((it) => (
                <tr key={it.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <p className="font-medium text-gray-900">{it.item}</p>
                    {it.category && <p className="text-gray-400">{it.category}</p>}
                  </td>
                  <td className="px-3 py-2">{it.quantity}</td>
                  <td className="px-3 py-2">{fmt(Number(it.unit_value), conditions.currency)}</td>
                  <td className="px-3 py-2 text-gray-400">{fmt(Number(it.discount), conditions.currency)}</td>
                  <td className="px-3 py-2 font-semibold text-gray-900">{fmt(Number(it.subtotal), conditions.currency)}</td>
                  {canEdit && (
                    <td className="px-3 py-2">
                      <button onClick={() => deleteItem(it.id)} title="Remover item"
                        className="text-gray-300 hover:text-red-500 transition-colors text-base">
                        🗑️
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-4 text-center text-gray-400 text-xs">Nenhum item. Adicione pelo botão abaixo.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-right text-sm font-semibold text-gray-900">Total: {fmt(total, conditions.currency)}</p>
        {canEdit && (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white p-3 space-y-2">
            <p className="text-xs font-medium text-gray-700">Adicionar item {catalog.length > 0 && <span className="font-normal text-gray-400">(do catálogo ou livre)</span>}</p>
            {catalog.length > 0 && (
              <select defaultValue="" onChange={e => { pickCatalog(e.target.value); e.target.value = '' }} className={inp}>
                <option value="">Escolher do catálogo…</option>
                {catalog.map(c => <option key={c.id} value={c.id}>{c.name}{c.category ? ` — ${c.category}` : ''}</option>)}
              </select>
            )}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
              <input value={draft.item} onChange={e => setDraft(d => ({ ...d, item: e.target.value }))} placeholder="Item" className={`${inp} sm:col-span-2`} />
              <input type="number" min={1} value={draft.quantity} onChange={e => setDraft(d => ({ ...d, quantity: Number(e.target.value) }))} placeholder="Qtd" className={inp} title="Quantidade" />
              <input type="number" min={0} step="0.01" value={draft.unit_value} onChange={e => setDraft(d => ({ ...d, unit_value: Number(e.target.value) }))} placeholder="Valor unitário" className={inp} title="Valor unitário" />
              <input type="number" min={0} step="0.01" value={draft.discount} onChange={e => setDraft(d => ({ ...d, discount: Number(e.target.value) }))} placeholder="Desconto" className={inp} title="Desconto (R$)" />
              <select value={draft.type} onChange={e => setDraft(d => ({ ...d, type: e.target.value as 'MRR' | 'Pontual' }))} className={inp} title="Tipo">
                <option value="MRR">Mensal (MRR)</option>
                <option value="Pontual">Pontual</option>
              </select>
            </div>
            <input value={draft.characteristics} onChange={e => setDraft(d => ({ ...d, characteristics: e.target.value }))} placeholder="Descrição (opcional)" className={inp} />
            <div className="flex items-center gap-3">
              <button onClick={addItem} disabled={adding || !draft.item.trim()}
                className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
                {adding ? 'Incluindo…' : '+ Incluir item'}
              </button>
              <span className="text-xs text-gray-400">O valor mensal da proposta é a soma dos itens mensais.</span>
            </div>
            {itemError && <p className="text-xs text-negative-600">{itemError}</p>}
          </div>
        )}
      </div>
      )}

      {/* Condições comerciais editáveis */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-gray-900">Condições Comerciais</h2>
          {canEdit && (
            <button onClick={saveConditions} disabled={saving}
              className={`px-3 py-1.5 text-xs font-medium rounded-md text-white ${saved ? 'bg-green-600' : 'bg-brand-700'} disabled:opacity-50`}>
              {saving ? 'Salvando...' : saved ? '✅ Salvo' : 'Salvar'}
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <label className="block text-gray-500 mb-1">Condição de pagamento</label>
            {canEdit ? (
              <input value={conditions.payment_terms ?? ''} onChange={e => setConditions(p => ({ ...p, payment_terms: e.target.value }))}
                className={inp} placeholder="Ex: 12 parcelas mensais" />
            ) : (
              <p className="font-medium text-gray-900">{conditions.payment_terms ?? '—'}</p>
            )}
          </div>
          <div>
            <label className="block text-gray-500 mb-1">Parcelas</label>
            {canEdit ? (
              <input type="number" min={1} value={conditions.installments}
                onChange={e => setConditions(p => ({ ...p, installments: Number(e.target.value) }))}
                className={inp} />
            ) : (
              <p className="font-medium text-gray-900">{conditions.installments}x</p>
            )}
          </div>
          <div>
            <label className="block text-gray-500 mb-1">Tipo de receita</label>
            {canEdit ? (
              <select value={conditions.is_recurring ? 'mrr' : 'one_time'}
                onChange={e => setConditions(p => ({ ...p, is_recurring: e.target.value === 'mrr' }))}
                className={inp}>
                <option value="mrr">Recorrente (MRR)</option>
                <option value="one_time">Receita única</option>
              </select>
            ) : (
              <p className="font-medium text-gray-900">{conditions.is_recurring ? 'Recorrente (MRR)' : 'Receita única'}</p>
            )}
          </div>
          <div>
            <label className="block text-gray-500 mb-1">Desconto global</label>
            {canEdit ? (
              <div className="flex gap-1">
                <select value={conditions.discount_type ?? 'none'}
                  onChange={e => setConditions(p => ({ ...p, discount_type: e.target.value === 'none' ? null : e.target.value }))}
                  className={`${inp} w-28`}>
                  <option value="none">Sem desconto</option>
                  <option value="percentage">%</option>
                  <option value="fixed">R$</option>
                </select>
                {conditions.discount_type && (
                  <input type="number" min={0} value={conditions.discount_value}
                    onChange={e => setConditions(p => ({ ...p, discount_value: Number(e.target.value) }))}
                    className={inp} placeholder="0" />
                )}
              </div>
            ) : (
              <p className="font-medium text-gray-900">
                {conditions.discount_type === 'percentage' ? fmtPct(Number(conditions.discount_value)) :
                 conditions.discount_type === 'fixed' ? fmt(conditions.discount_value, conditions.currency) : 'Sem desconto'}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
