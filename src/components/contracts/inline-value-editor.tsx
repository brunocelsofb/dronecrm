'use client'

import { useState } from 'react'
import { updateRunValue } from '@/lib/actions/pipeline'

export function InlineValueEditor({ contractId, currentValue }: { contractId: string; currentValue: number }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    const parsed = Number(value.replace(',', '.'))
    if (!value || Number.isNaN(parsed) || parsed <= 0) { setError('Informe um valor válido.'); return }
    setError(null)
    setBusy(true)
    const result = await updateRunValue(contractId, parsed)
    setBusy(false)
    if (result.error) { setError(result.error); return }
    setEditing(false)
    setValue('')
  }

  if (!editing) {
    return (
      <button onClick={() => setEditing(true)}
        style={{ fontSize: 11, color: '#1b556b', background: 'none', border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0 }}>
        Alterar
      </button>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
      <div style={{ display: 'flex', gap: 4 }}>
        <input autoFocus value={value} onChange={e => setValue(e.target.value)}
          placeholder="Novo valor R$"
          onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setEditing(false) }}
          style={{ width: 120, padding: '4px 8px', fontSize: 12, borderRadius: 6, border: '0.5px solid #d1d8e8', background: '#fff', color: '#1a1f36', outline: 'none' }} />
        <button onClick={handleSave} disabled={busy}
          style={{ padding: '4px 10px', fontSize: 11, borderRadius: 6, border: 'none', background: '#1a1f36', color: '#fff', cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
          {busy ? '...' : 'OK'}
        </button>
        <button onClick={() => { setEditing(false); setError(null) }}
          style={{ padding: '4px 10px', fontSize: 11, borderRadius: 6, border: '0.5px solid #d1d8e8', background: '#fff', color: '#52514e', cursor: 'pointer' }}>
          ✕
        </button>
      </div>
      {error && <p style={{ fontSize: 10, color: '#8e4550' }}>{error}</p>}
    </div>
  )
}
