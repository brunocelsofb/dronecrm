'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateTag, deleteTag } from '@/lib/actions/tags'

type Tag = { id: string; name: string; color: string; context?: string | null }

const PRESET_COLORS = [
  '#524e9c','#1f8c7d','#8e4550','#c2683d','#6B7280',
  '#7c3aed','#0891b2','#be185d','#0f766e','#b45309',
]

const CONTEXT_OPTIONS = [
  { value: 'oportunidade', label: '🎯 Oportunidade' },
  { value: 'empresa',      label: '🏢 Empresa' },
  { value: 'ambos',        label: '🔗 Ambos' },
]

export function TagsManager({ initialTags }: { initialTags: Tag[] }) {
  const router = useRouter()
  const [tags, setTags] = useState<Tag[]>(initialTags)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('')
  const [editContext, setEditContext] = useState('oportunidade')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function startEdit(tag: Tag) {
    setEditingId(tag.id)
    setEditName(tag.name)
    setEditColor(tag.color)
    setEditContext(tag.context ?? 'oportunidade')
    setError(null)
  }

  function cancelEdit() { setEditingId(null); setError(null) }

  async function handleUpdate(id: string) {
    setBusy(true); setError(null)
    const result = await updateTag(id, editName, editColor, editContext)
    setBusy(false)
    if (result.error) { setError(result.error); return }
    setTags(prev => prev.map(t => t.id === id ? { ...t, name: editName.trim(), color: editColor, context: editContext } : t))
    setEditingId(null)
    router.refresh()
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Excluir a tag "${name}"? Ela some de todos os contratos que a usam.`)) return
    setBusy(true)
    const result = await deleteTag(id)
    setBusy(false)
    if (result?.error) { setError(result.error); return }
    setTags(prev => prev.filter(t => t.id !== id))
    router.refresh()
  }

  const inp: React.CSSProperties = { padding: '6px 10px', fontSize: 12, borderRadius: 8, border: '0.5px solid #d1d8e8', background: '#f8f9fb', color: '#1a1f36', outline: 'none' }

  if (tags.length === 0) return <p style={{ fontSize: 12, color: '#b0b8c8' }}>Nenhuma tag criada ainda.</p>

  return (
    <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #e8edf5', overflow: 'hidden' }}>
      {error && <p style={{ fontSize: 12, color: '#8e4550', padding: '8px 16px' }}>{error}</p>}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {['Tag', 'Uso', 'Cor', ''].map((h, i) => (
              <th key={i} style={{ padding: '10px 16px', fontSize: 10, color: '#8892a4', textTransform: 'uppercase', letterSpacing: '0.7px', fontWeight: 500, textAlign: 'left', borderBottom: '0.5px solid #f1f3f8' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tags.map(tag => (
            <tr key={tag.id} style={{ borderBottom: '0.5px solid #f8f9fb' }}>
              {editingId === tag.id ? (
                <>
                  <td style={{ padding: '10px 16px' }}>
                    <input value={editName} onChange={e => setEditName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleUpdate(tag.id); if (e.key === 'Escape') cancelEdit() }}
                      style={{ ...inp, width: '100%' }} autoFocus />
                  </td>
                  <td style={{ padding: '10px 16px' }}>
                    <select value={editContext} onChange={e => setEditContext(e.target.value)}
                      style={{ ...inp, cursor: 'pointer' }}>
                      {CONTEXT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: '10px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input type="color" value={editColor} onChange={e => setEditColor(e.target.value)}
                        style={{ width: 32, height: 32, borderRadius: 8, border: '0.5px solid #d1d8e8', cursor: 'pointer', padding: 2 }} />
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {PRESET_COLORS.map(c => (
                          <button key={c} onClick={() => setEditColor(c)} type="button"
                            style={{ width: 18, height: 18, borderRadius: 4, background: c, border: editColor === c ? '2px solid #1a1f36' : '2px solid transparent', cursor: 'pointer', padding: 0 }} />
                        ))}
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '10px 16px', whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => handleUpdate(tag.id)} disabled={busy}
                        style={{ fontSize: 12, padding: '4px 12px', borderRadius: 6, border: 'none', background: '#1a1f36', color: '#fff', cursor: 'pointer' }}>
                        {busy ? '...' : 'Salvar'}
                      </button>
                      <button onClick={cancelEdit} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, border: '0.5px solid #d1d8e8', background: '#fff', color: '#52514e', cursor: 'pointer' }}>
                        Cancelar
                      </button>
                    </div>
                  </td>
                </>
              ) : (
                <>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 12px', borderRadius: 20, fontSize: 12, fontWeight: 500, color: '#fff', background: tag.color }}>
                      {tag.name}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: '#f1f3f8', color: '#52514e' }}>
                      {CONTEXT_OPTIONS.find(o => o.value === (tag.context ?? 'oportunidade'))?.label ?? '🎯 Oportunidade'}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 18, height: 18, borderRadius: 4, background: tag.color, border: '0.5px solid rgba(0,0,0,0.1)' }} />
                      <span style={{ fontSize: 11, color: '#8892a4', fontFamily: 'monospace' }}>{tag.color}</span>
                    </div>
                  </td>
                  <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', gap: 12 }}>
                      <button onClick={() => startEdit(tag)}
                        style={{ fontSize: 12, color: '#524e9c', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                        Editar
                      </button>
                      <button onClick={() => handleDelete(tag.id, tag.name)} disabled={busy}
                        style={{ fontSize: 12, color: '#8e4550', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                        Excluir
                      </button>
                    </div>
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
