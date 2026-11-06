'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateRunValue } from '@/lib/actions/pipeline'

function fmt(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
}

export function RenewalValueSection({ contractId, currentValue, canEdit, canCreateProposal, isCurrentlyInContractsPipeline, pending }: {
  contractId: string
  currentValue: number
  pending?: { value: number; code: string | null } | null
  canEdit: boolean
  canCreateProposal?: boolean
  isCurrentlyInContractsPipeline?: boolean
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [newValue, setNewValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    const parsed = Number(newValue.replace(',', '.'))
    if (!newValue || Number.isNaN(parsed)) { setError('Informe o novo valor.'); return }
    setError(null)
    setBusy(true)
    const result = await updateRunValue(contractId, parsed)
    setBusy(false)
    if (result.error) setError(result.error)
    else { setEditing(false); setNewValue('') }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
            {isCurrentlyInContractsPipeline ? 'Valor vigente do contrato' : 'Valor estimado'}
          </p>
          <p className="mt-1 text-2xl font-semibold text-gray-900 tabular-nums">
            {fmt(currentValue)}
          </p>
          {pending && (
            <p className="mt-1 text-xs text-gray-500">
              Em proposta{pending.code ? ` (${pending.code})` : ''}: <strong className="text-gray-700">{fmt(pending.value)}/mês</strong> — passa a valer após a aprovação final do cliente.
            </p>
          )}
        </div>

        {!editing && (
          <div className="flex items-center gap-3 flex-shrink-0">
            {canEdit ? (
              <button
                onClick={() => setEditing(true)}
                title="Pode ser mudança de valor, reajuste monetário e afins."
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors whitespace-nowrap"
              >
                Mudança de valor
              </button>
            ) : (
              <span className="text-xs text-gray-400">Reajuste: apenas owner/admin</span>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                router.push(`/contracts/${contractId}?tab=proposta`)
              }}
              className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 transition-colors whitespace-nowrap border-0 cursor-pointer"
            >
              + Proposta de aditivo
            </button>
          </div>
        )}
      </div>

      {editing && (
        <div className="space-y-2 border-t border-gray-100 pt-3">
          <p className="text-xs text-gray-500">
            Reajustes geralmente seguem o IPCA.{' '}
            <a href="https://www.ibge.gov.br/explica/inflacao.php" target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline">
              Consultar índice no IBGE ↗
            </a>
          </p>
          <div className="flex items-end gap-2">
            <div>
              <label className="block text-[10px] text-gray-500">Novo valor (R$)</label>
              <input
                value={newValue}
                onChange={e => setNewValue(e.target.value)}
                placeholder="0,00"
                autoFocus
                className="mt-1 w-40 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none"
              />
            </div>
            <button onClick={handleSave} disabled={busy}
              className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">
              {busy ? 'Salvando...' : 'Salvar novo valor'}
            </button>
            <button onClick={() => { setEditing(false); setError(null) }}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
              Cancelar
            </button>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      )}
    </div>
  )
}
