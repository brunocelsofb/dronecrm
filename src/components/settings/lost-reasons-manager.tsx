'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { saveLostReason, toggleLostReason, deleteLostReason } from '@/lib/actions/lost-reasons'

type Reason = { id: string; name: string; active: boolean; display_order: number }

export function LostReasonsManager({ initialReasons }: { initialReasons: Reason[] }) {
  const router = useRouter()
  const [reasons, setReasons] = useState<Reason[]>(initialReasons)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const inputStyle: React.CSSProperties = { padding: '7px 10px', fontSize: 12, borderRadius: 8, border: '0.5px solid #d1d8e8', background: '#f8f9fb', color: '#1a1f36', outline: 'none', flex: 1 }

  async function handleAdd() {
    if (!newName.trim()) return
    setBusy(true)
    const fd = new FormData(); fd.set('name', newName.trim())
    const result = await saveLostReason(fd)
    setBusy(false)
    if (result.error) { setError(result.error); return }
    setNewName(''); router.refresh()
  }

  async function handleToggle(id: string, active: boolean) {
    // Atualiza o estado local imediatamente para feedback visual instantâneo
    setReasons(prev => prev.map(r => r.id === id ? { ...r, active: !active } : r))
    const result = await toggleLostReason(id, !active)
    if (result?.error) {
      // Reverte se deu erro
      setReasons(prev => prev.map(r => r.id === id ? { ...r, active } : r))
      setError(result.error)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Excluir este motivo?')) return
    setReasons(prev => prev.filter(r => r.id !== id))
    const result = await deleteLostReason(id)
    if (result?.error) {
      setError(result.error)
      router.refresh() // Recarrega para restaurar o estado correto
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Adicionar */}
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Ex: Preço, Concorrente, Sem fit..."
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
          style={inputStyle} />
        <button onClick={handleAdd} disabled={busy || !newName.trim()}
          style={{ padding: '7px 16px', fontSize: 12, fontWeight: 500, borderRadius: 8, border: 'none', background: '#1a1f36', color: '#fff', cursor: 'pointer', opacity: !newName.trim() ? 0.4 : 1 }}>
          {busy ? '...' : '+ Adicionar'}
        </button>
      </div>
      {error && <p style={{ fontSize: 11, color: '#8e4550' }}>{error}</p>}

      {/* Lista */}
      <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #e8edf5', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Motivo', 'Status', ''].map((h, i) => (
                <th key={i} style={{ padding: '10px 16px', fontSize: 10, color: '#8892a4', textTransform: 'uppercase', letterSpacing: '0.7px', fontWeight: 500, textAlign: 'left', borderBottom: '0.5px solid #f1f3f8' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(reasons ?? []).map(r => (
              <tr key={r.id} style={{ borderBottom: '0.5px solid #f8f9fb', opacity: r.active ? 1 : 0.5 }}>
                <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 500, color: '#1a1f36' }}>{r.name}</td>
                <td style={{ padding: '12px 16px' }}>
                  <button onClick={() => handleToggle(r.id, r.active)}
                    style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 500, border: '0.5px solid', cursor: 'pointer',
                      background: r.active ? '#e3f5f1' : '#f1f3f8', color: r.active ? '#1f8c7d' : '#8892a4', borderColor: r.active ? '#bbddc8' : '#d1d8e8' }}>
                    {r.active ? 'Ativo' : 'Inativo'}
                  </button>
                </td>
                <td style={{ padding: '12px 16px' }}>
                  <button onClick={() => handleDelete(r.id)} style={{ fontSize: 11, color: '#8e4550', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Excluir</button>
                </td>
              </tr>
            ))}
            {reasons.length === 0 && (
              <tr><td colSpan={3} style={{ padding: '32px 16px', textAlign: 'center', fontSize: 13, color: '#8892a4' }}>Nenhum motivo cadastrado ainda.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
