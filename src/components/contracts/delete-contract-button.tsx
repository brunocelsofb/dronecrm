'use client'

import { useState, useTransition } from 'react'
import { deleteContract } from '@/lib/actions/contracts'

export function DeleteContractButton({ contractId, label = 'Excluir oportunidade' }: { contractId: string; label?: string }) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleClick() {
    if (!confirm(`${label} PARA SEMPRE? Isso apaga também todo o histórico e atividades ligados a ela. Não tem como desfazer.`)) return
    setError(null)
    startTransition(async () => {
      const result = await deleteContract(contractId, '/pipeline')
      if (result?.error) setError(result.error)
    })
  }

  return (
    <div>
      <button onClick={handleClick} disabled={isPending}
        style={{ padding: '7px 14px', fontSize: 12, borderRadius: 8, border: '0.5px solid #dcadb3', background: '#fff', color: '#8e4550', cursor: 'pointer', opacity: isPending ? 0.5 : 1 }}>
        {isPending ? 'Excluindo...' : label}
      </button>
      {error && <p style={{ marginTop: 4, fontSize: 11, color: '#8e4550' }}>{error}</p>}
    </div>
  )
}
