'use client'

import { useState, useCallback } from 'react'

export function ProposalTextsEditor({ contractId, proposalId, initialData }: {
  contractId: string
  proposalId?: string
  initialData: {
    texto_objetivos?: string | null
    texto_atividades?: string | null
    texto_estrutura_apoio?: string | null
  } | null
}) {
  const [objetivos, setObjetivos] = useState(initialData?.texto_objetivos ?? '')
  const [atividades, setAtividades] = useState(initialData?.texto_atividades ?? '')
  const [estrutura, setEstrutura] = useState(initialData?.texto_estrutura_apoio ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const handleSave = useCallback(async () => {
    setSaving(true)
    setSaved(false)
    await fetch('/api/proposals/texts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contract_id: contractId,
        proposal_id: proposalId,
        texto_objetivos: objetivos,
        texto_atividades: atividades,
        texto_estrutura_apoio: estrutura,
      }),
    })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }, [contractId, objetivos, atividades, estrutura])

  const ta: React.CSSProperties = {
    width: '100%', padding: '10px 12px', fontSize: 12, borderRadius: 8,
    border: '0.5px solid #d1d8e8', outline: 'none', color: '#1a1f36',
    background: '#fff', resize: 'vertical' as const, fontFamily: 'inherit',
    lineHeight: 1.6, boxSizing: 'border-box' as const,
  }

  const field = (label: string, value: string, onChange: (v: string) => void, hint: string, rows = 6) => (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <label style={{ fontSize: 12, fontWeight: 500, color: '#1a1f36' }}>{label}</label>
        <span style={{ fontSize: 10, color: '#b0b8c8' }}>{hint}</span>
      </div>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={rows}
        style={ta}
        placeholder={`Digite o conteúdo de ${label.toLowerCase()}...`}
      />
    </div>
  )

  return (
    <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #e8edf5', padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <p style={{ fontSize: 13, fontWeight: 500, color: '#1a1f36', margin: 0 }}>Textos da Proposta</p>
          <p style={{ fontSize: 11, color: '#8892a4', margin: '2px 0 0' }}>Conteúdo que entra no miolo do PDF gerado</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{ padding: '8px 18px', fontSize: 12, fontWeight: 500, borderRadius: 8, border: 'none',
            background: saved ? '#1f8c7d' : '#1B556B', color: '#fff', cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Salvando...' : saved ? '✅ Salvo' : 'Salvar textos'}
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {field('Objetivos', objetivos, setObjetivos, 'Aparece na seção OBJETIVOS do PDF', 5)}
        {field('Atividades a serem desenvolvidas', atividades, setAtividades, 'Aparece na seção ATIVIDADES do PDF', 8)}
        {field('Estrutura de apoio', estrutura, setEstrutura, 'Aparece na seção ESTRUTURA DE APOIO do PDF', 5)}
      </div>
    </div>
  )
}
