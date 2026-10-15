'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { savePipelineFieldConfigs, deletePipelineField, addPipelineField } from '@/lib/actions/pipeline-field-config'
import type { PipelineFieldConfig, FieldVisibility } from '@/lib/pipeline-field-config'

const VISIBILITY_OPTIONS: { value: FieldVisibility; label: string; color: string; bg: string }[] = [
  { value: 'required', label: 'Obrigatório', color: '#8e4550', bg: '#f6e9ea' },
  { value: 'optional', label: 'Opcional',    color: '#524e9c', bg: '#e8e7f4' },
  { value: 'hidden',   label: 'Oculto',      color: '#8892a4', bg: '#f1f3f8' },
]

const ALWAYS_REQUIRED = ['title']

export function PipelineFieldConfigForm({
  pipelineId,
  initialConfigs,
  customFields,
}: {
  pipelineId: string
  initialConfigs: PipelineFieldConfig[]
  customFields?: { id: string; name: string; field_key: string }[]
}) {
  const router = useRouter()
  const [configs, setConfigs] = useState<PipelineFieldConfig[]>(initialConfigs)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newLabel, setNewLabel] = useState('')
  const [newKey, setNewKey]  = useState('')
  const [adding, setAdding]  = useState(false)

  function setVisibility(fieldKey: string, visibility: FieldVisibility) {
    if (ALWAYS_REQUIRED.includes(fieldKey)) return
    setConfigs(prev => prev.map(c => c.field_key === fieldKey ? { ...c, visibility } : c))
    setSaved(false)
  }

  async function handleSave() {
    setBusy(true); setSaved(false); setError(null)
    const result = await savePipelineFieldConfigs(pipelineId, configs)
    setBusy(false)
    if (result.error) { setError(result.error); return }
    setSaved(true); router.refresh()
  }

  async function handleDelete(fieldKey: string) {
    if (ALWAYS_REQUIRED.includes(fieldKey)) return
    if (!confirm(`Remover o campo "${fieldKey}" deste funil?`)) return
    setConfigs(prev => prev.filter(c => c.field_key !== fieldKey))
    await deletePipelineField(pipelineId, fieldKey)
    router.refresh()
  }

  async function handleAdd() {
    const label = newLabel.trim()
    const key   = (newKey.trim() || label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''))
    if (!label || !key) { setError('Preencha o nome do campo.'); return }
    if (configs.some(c => c.field_key === key)) { setError(`Campo "${key}" já existe.`); return }
    setAdding(true); setError(null)
    const result = await addPipelineField(pipelineId, key, label, configs.length)
    setAdding(false)
    if (result.error) { setError(result.error); return }
    setConfigs(prev => [...prev, { field_key: key, field_label: label, visibility: 'optional', display_order: prev.length }])
    setNewLabel(''); setNewKey('')
    router.refresh()
  }

  // Campos customizados que ainda não estão na lista
  const availableCustom = (customFields ?? []).filter(cf => !configs.some(c => c.field_key === `custom_${cf.field_key}`))

  async function handleAddCustom(cf: { name: string; field_key: string }) {
    const key = `custom_${cf.field_key}`
    if (configs.some(c => c.field_key === key)) return
    await addPipelineField(pipelineId, key, cf.name, configs.length)
    setConfigs(prev => [...prev, { field_key: key, field_label: cf.name, visibility: 'optional', display_order: prev.length }])
    router.refresh()
  }

  const inp: React.CSSProperties = { padding: '6px 10px', fontSize: 12, borderRadius: 8, border: '0.5px solid #d1d8e8', background: '#f8f9fb', color: '#1a1f36', outline: 'none' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {VISIBILITY_OPTIONS.map(v => (
          <span key={v.value} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '3px 10px', borderRadius: 20, background: v.bg, color: v.color }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: v.color }} />
            {v.label}
          </span>
        ))}
        <span style={{ fontSize: 11, color: '#8892a4', alignSelf: 'center' }}>— Clique nos botões ou no badge para alternar</span>
      </div>

      <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #e8edf5', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Campo', 'Visibilidade', 'Ações'].map((h, i) => (
                <th key={i} style={{ padding: '10px 16px', fontSize: 10, color: '#8892a4', textTransform: 'uppercase', letterSpacing: '0.7px', fontWeight: 500, textAlign: 'left', borderBottom: '0.5px solid #f1f3f8' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {configs.map(c => {
              const vis = VISIBILITY_OPTIONS.find(v => v.value === c.visibility)!
              const locked = ALWAYS_REQUIRED.includes(c.field_key)
              return (
                <tr key={c.field_key} style={{ borderBottom: '0.5px solid #f8f9fb', opacity: c.visibility === 'hidden' ? 0.5 : 1 }}>
                  <td style={{ padding: '12px 16px' }}>
                    <p style={{ fontSize: 13, fontWeight: 500, color: '#1a1f36', margin: 0 }}>{c.field_label}</p>
                    <p style={{ fontSize: 10, fontFamily: 'monospace', color: '#b0b8c8', marginTop: 2 }}>{c.field_key}</p>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 500, background: vis.bg, color: vis.color, cursor: locked ? 'not-allowed' : 'pointer' }}
                      onClick={() => {
                        if (locked) return
                        const opts: FieldVisibility[] = ['required', 'optional', 'hidden']
                        setVisibility(c.field_key, opts[(opts.indexOf(c.visibility) + 1) % opts.length])
                      }}>
                      {vis.label}{locked && ' 🔒'}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      {VISIBILITY_OPTIONS.map(v => (
                        <button key={v.value} onClick={() => setVisibility(c.field_key, v.value)} disabled={locked}
                          style={{ padding: '3px 8px', fontSize: 10, borderRadius: 6, border: '0.5px solid', cursor: locked ? 'not-allowed' : 'pointer', borderColor: c.visibility === v.value ? v.color : '#e8edf5', background: c.visibility === v.value ? v.bg : '#fff', color: c.visibility === v.value ? v.color : '#b0b8c8', fontWeight: c.visibility === v.value ? 600 : 400 }}>
                          {v.label}
                        </button>
                      ))}
                      {!locked && (
                        <button onClick={() => handleDelete(c.field_key)}
                          style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '0.5px solid #dcadb3', background: '#fff', color: '#8e4550', cursor: 'pointer', marginLeft: 4 }}>
                          Remover
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Adicionar campo personalizado */}
      <div style={{ background: '#f8f9fb', borderRadius: 10, border: '0.5px solid #e8edf5', padding: 16 }}>
        <p style={{ fontSize: 11, fontWeight: 600, color: '#1a1f36', marginBottom: 10 }}>+ Adicionar campo</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <p style={{ fontSize: 10, color: '#8892a4', marginBottom: 4 }}>Nome do campo</p>
            <input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="Ex: Região de atuação"
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
              style={{ ...inp, width: 200 }} />
          </div>
          <div>
            <p style={{ fontSize: 10, color: '#8892a4', marginBottom: 4 }}>Chave (auto)</p>
            <input value={newKey} onChange={e => setNewKey(e.target.value)} placeholder="regiao_atuacao"
              style={{ ...inp, width: 140 }} />
          </div>
          <button onClick={handleAdd} disabled={adding || !newLabel.trim()}
            style={{ padding: '6px 16px', fontSize: 12, fontWeight: 500, borderRadius: 8, border: 'none', background: '#1a1f36', color: '#fff', cursor: 'pointer', opacity: !newLabel.trim() ? 0.4 : 1 }}>
            {adding ? '...' : 'Adicionar'}
          </button>
        </div>

        {availableCustom.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <p style={{ fontSize: 10, color: '#8892a4', marginBottom: 6 }}>Campos customizados disponíveis:</p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {availableCustom.map(cf => (
                <button key={cf.id} onClick={() => handleAddCustom(cf)}
                  style={{ padding: '3px 10px', fontSize: 11, borderRadius: 20, border: '0.5px solid #524e9c', background: '#e8e7f4', color: '#524e9c', cursor: 'pointer' }}>
                  + {cf.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {error && <p style={{ fontSize: 12, color: '#8e4550' }}>{error}</p>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={handleSave} disabled={busy}
          style={{ padding: '8px 20px', fontSize: 13, fontWeight: 500, borderRadius: 8, border: 'none', background: '#1a1f36', color: '#fff', cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Salvando...' : 'Salvar configuração'}
        </button>
        {saved && <span style={{ fontSize: 12, color: '#1f8c7d' }}>✅ Salvo</span>}
      </div>
    </div>
  )
}
