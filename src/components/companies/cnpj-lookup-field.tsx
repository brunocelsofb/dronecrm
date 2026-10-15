'use client'

import { useState } from 'react'
import { lookupCnpj, type CnpjData } from '@/lib/actions/cnpj-lookup'

export function CnpjLookupField({
  defaultValue,
  onFound,
}: {
  defaultValue?: string
  onFound: (data: { razaoSocial: string; nomeFantasia: string | null } & Partial<CnpjData>) => void
}) {
  const [value, setValue] = useState(defaultValue ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [found, setFound] = useState<CnpjData | null>(null)

  async function handleLookup() {
    setError(null)
    setLoading(true)
    const result = await lookupCnpj(value)
    setLoading(false)
    if (!result.success) { setError(result.error); return }
    setFound(result)
    onFound(result)
  }

  const inputStyle = { flex: 1, padding: '7px 10px', fontSize: 12, borderRadius: 8, border: '0.5px solid #d1d8e8', background: '#f8f9fb', color: '#1a1f36', outline: 'none' }

  return (
    <div>
      <label style={{ display: 'block', fontSize: 10, color: '#8892a4', textTransform: 'uppercase' as const, letterSpacing: '0.7px', marginBottom: 4 }}>CNPJ</label>
      <div style={{ display: 'flex', gap: 8 }}>
        <input name="cnpj" value={value} onChange={e => setValue(e.target.value)}
          placeholder="00.000.000/0000-00" style={inputStyle} />
        <button type="button" onClick={handleLookup}
          disabled={loading || value.replace(/\D/g, '').length !== 14}
          style={{ padding: '7px 14px', fontSize: 12, borderRadius: 8, border: '0.5px solid #1a1f36', background: '#fff', color: '#1a1f36', cursor: 'pointer', whiteSpace: 'nowrap', opacity: (loading || value.replace(/\D/g, '').length !== 14) ? 0.4 : 1 }}>
          {loading ? 'Buscando...' : '🔍 Buscar CNPJ'}
        </button>
      </div>
      {error && <p style={{ marginTop: 4, fontSize: 11, color: '#8e4550' }}>{error}</p>}
      {found && (
        <div style={{ marginTop: 8, padding: '10px 12px', borderRadius: 8, background: '#e3f5f1', border: '0.5px solid #bbddc8', fontSize: 11 }}>
          <p style={{ color: '#1f8c7d', fontWeight: 500, marginBottom: 4 }}>✅ Dados encontrados na Receita Federal</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, color: '#52514e' }}>
            {found.municipio && <span>📍 {found.municipio}/{found.uf}</span>}
            {found.capitalSocial && <span>💰 Capital: {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(found.capitalSocial)}</span>}
            {found.cnaeDescricao && <span style={{ gridColumn: '1/-1' }}>🏭 {found.cnaeDescricao}</span>}
          </div>
          <p style={{ marginTop: 4, color: '#8892a4', fontSize: 10 }}>Fonte: BrasilAPI (dados públicos) — confira antes de salvar.</p>
        </div>
      )}
    </div>
  )
}
