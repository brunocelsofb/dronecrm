'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createProposal, type ProposalItemInput } from '@/lib/actions/proposals'

type CatalogItem = { id: string; name: string; category: string | null; type: string | null; characteristics: string | null; unit_value: number }

function emptyItem(): ProposalItemInput {
  return { quantity: 1, category: '', item: '', characteristics: '', type: '', delivery_forecast: '', unit_value: 0, discount: 0 }
}

export function NewProposalForm({
  contractId,
  catalogItems,
  onCancel,
}: {
  contractId: string
  catalogItems: CatalogItem[]
  onCancel: () => void
}) {
  const router = useRouter()
  const [currency, setCurrency] = useState('BRL')
  const [poNumber, setPoNumber] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [discountType, setDiscountType] = useState<'' | 'percentage' | 'fixed'>('')
  const [discountValue, setDiscountValue] = useState('0')
  const [paymentTerms, setPaymentTerms] = useState('')
  const [installments, setInstallments] = useState('1')
  const [isRecurring, setIsRecurring] = useState(false)
  const [items, setItems] = useState<ProposalItemInput[]>([emptyItem()])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function updateItem(i: number, patch: Partial<ProposalItemInput>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)))
  }

  function applyCatalogItem(i: number, catalogId: string) {
    const found = catalogItems.find((c) => c.id === catalogId)
    if (!found) return
    updateItem(i, {
      item: found.name,
      category: found.category ?? '',
      type: found.type ?? '',
      characteristics: found.characteristics ?? '',
      unit_value: found.unit_value,
    })
  }

  async function handleSubmit() {
    setError(null)
    if (items.some((it) => !it.item.trim())) {
      setError('Preencha o nome de todos os itens.')
      return
    }
    setBusy(true)
    const result = await createProposal(
      contractId,
      currency,
      poNumber || null,
      validUntil || null,
      items,
      discountType || null,
      Number(discountValue) || 0,
      paymentTerms || null,
      Number(installments) || 1,
      isRecurring
    )
    setBusy(false)
    if (result.error) {
      setError(result.error)
    } else if (result.proposalId) {
      router.push(`/contracts/${contractId}/proposals/${result.proposalId}`)
    }
  }

  const total = items.reduce((sum, it) => sum + it.quantity * it.unit_value - it.discount, 0)

  return (
    <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="block text-xs font-medium text-gray-600">Moeda</label>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none">
            <option value="BRL">BRL — Real</option>
            <option value="USD">USD — Dólar</option>
            <option value="EUR">EUR — Euro</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600">Nº OC do cliente (opcional)</label>
          <input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600">Válida até</label>
          <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <label className="block text-xs font-medium text-gray-600">Desconto</label>
          <select value={discountType} onChange={(e) => setDiscountType(e.target.value as '' | 'percentage' | 'fixed')} className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none">
            <option value="">Sem desconto</option>
            <option value="percentage">Percentual (%)</option>
            <option value="fixed">Valor fixo (R$)</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600">Valor do desconto</label>
          <input type="number" value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} disabled={!discountType} className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none disabled:bg-gray-100" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600">Parcelas</label>
          <input type="number" min="1" value={installments} onChange={(e) => setInstallments(e.target.value)} className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600">Tipo de receita</label>
          <select value={isRecurring ? 'recurring' : 'unica'} onChange={(e) => setIsRecurring(e.target.value === 'recurring')} className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none">
            <option value="unica">Receita única</option>
            <option value="recurring">Recorrente (MRR)</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600">Condição de pagamento</label>
        <input value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="Ex: 30/60/90 dias, boleto bancário" className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none" />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-gray-700">Itens da proposta</p>
          {catalogItems.length === 0 && (
            <a href="/proposals/catalog" target="_blank" className="text-xs text-brand-700 hover:underline">
              Cadastrar itens no catálogo ↗
            </a>
          )}
        </div>

        {items.map((it, i) => (
          <div key={i} className="space-y-2 rounded-md border border-gray-200 bg-gray-50 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-500">Item {i + 1}</span>
              {items.length > 1 && (
                <button onClick={() => setItems((prev) => prev.filter((_, idx) => idx !== i))} className="text-xs text-negative-600 hover:underline">
                  Remover item
                </button>
              )}
            </div>

            {catalogItems.length > 0 && (
              <div>
                <label className="block text-[10px] text-gray-500">Escolher do catálogo (preenche os campos abaixo — você ainda pode editar)</label>
                <select
                  defaultValue=""
                  onChange={(e) => e.target.value && applyCatalogItem(i, e.target.value)}
                  className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none"
                >
                  <option value="">Selecione um item do catálogo (opcional)...</option>
                  {catalogItems.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div>
                <label className="block text-[10px] text-gray-500">Quantidade</label>
                <input type="number" value={it.quantity} onChange={(e) => updateItem(i, { quantity: Number(e.target.value) })} className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-brand-700 focus:outline-none" />
              </div>
              <div>
                <label className="block text-[10px] text-gray-500">Categoria</label>
                <input value={it.category} onChange={(e) => updateItem(i, { category: e.target.value })} className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-brand-700 focus:outline-none" />
              </div>
              <div>
                <label className="block text-[10px] text-gray-500">Tipo</label>
                <input value={it.type} onChange={(e) => updateItem(i, { type: e.target.value })} className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-brand-700 focus:outline-none" />
              </div>
              <div>
                <label className="block text-[10px] text-gray-500">Previsão de entrega</label>
                <input value={it.delivery_forecast} onChange={(e) => updateItem(i, { delivery_forecast: e.target.value })} placeholder="Ex: 15 dias" className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-brand-700 focus:outline-none" />
              </div>
            </div>

            <div>
              <label className="block text-[10px] text-gray-500">Nome do item</label>
              <input value={it.item} onChange={(e) => updateItem(i, { item: e.target.value })} className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none" />
            </div>

            <div>
              <label className="block text-[10px] text-gray-500">Características / escopo</label>
              <input value={it.characteristics} onChange={(e) => updateItem(i, { characteristics: e.target.value })} placeholder="Ex: escopo de manutenção e metrologia" className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none" />
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div>
                <label className="block text-[10px] text-gray-500">Valor unitário (R$)</label>
                <input type="number" value={it.unit_value} onChange={(e) => updateItem(i, { unit_value: Number(e.target.value) })} className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-brand-700 focus:outline-none" />
              </div>
              <div>
                <label className="block text-[10px] text-gray-500">Desconto (R$)</label>
                <input type="number" value={it.discount} onChange={(e) => updateItem(i, { discount: Number(e.target.value) })} className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-brand-700 focus:outline-none" />
              </div>
              <div>
                <label className="block text-[10px] text-gray-500">Subtotal</label>
                <p className="mt-1 rounded-md bg-white px-2 py-1.5 text-sm font-medium text-gray-700">
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(it.quantity * it.unit_value - it.discount)}
                </p>
              </div>
            </div>
          </div>
        ))}
        <button onClick={() => setItems((prev) => [...prev, emptyItem()])} className="text-xs text-brand-700 hover:underline">
          + Adicionar outro item
        </button>
      </div>

      <p className="text-sm font-semibold text-gray-900">Total: {new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(total)}</p>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button onClick={handleSubmit} disabled={busy} className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">
          {busy ? 'Criando...' : 'Criar proposta (rascunho)'}
        </button>
        <button onClick={onCancel} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
          Cancelar
        </button>
      </div>
    </div>
  )
}
