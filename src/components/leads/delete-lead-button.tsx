'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { deleteLead } from '@/lib/actions/leads'

export function DeleteLeadButton({ leadId, leadName, redirectAfter = false }: { leadId: string; leadName: string; redirectAfter?: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function handle() {
    if (!confirm(`Excluir o lead "${leadName}"? Esta ação não pode ser desfeita.`)) return
    setBusy(true)
    const result = await deleteLead(leadId)
    setBusy(false)
    if (result?.error) { alert(result.error); return }
    if (redirectAfter) router.push('/leads')
    else router.refresh()
  }

  return (
    <button onClick={handle} disabled={busy}
      style={{ fontSize: 11, color: '#8e4550', background: 'none', border: 'none', cursor: 'pointer', padding: 0, opacity: busy ? 0.5 : 1 }}>
      {busy ? '...' : 'Excluir'}
    </button>
  )
}
