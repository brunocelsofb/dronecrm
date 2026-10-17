'use client'

import { useState, useEffect } from 'react'

export default function NumeracaoPage() {
  const [prefix, setPrefix] = useState('OPP')
  const [nextNumber, setNextNumber] = useState(1)
  const [yearReset, setYearReset] = useState(true)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/settings/opportunity-sequence')
      .then(r => r.json())
      .then(d => { setPrefix(d.prefix ?? 'OPP'); setNextNumber(d.next_number ?? 1); setYearReset(d.year_reset ?? true) })
      .finally(() => setLoading(false))
  }, [])

  async function handleSave() {
    setBusy(true); setSaved(false)
    await fetch('/api/settings/opportunity-sequence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix, next_number: nextNumber, year_reset: yearReset }),
    })
    setBusy(false); setSaved(true)
  }

  const year = new Date().getFullYear()
  const preview = yearReset
    ? `${prefix}-${year}-${String(nextNumber).padStart(4, '0')}`
    : `${prefix}-${String(nextNumber).padStart(5, '0')}`

  const inp: React.CSSProperties = { padding: '7px 10px', fontSize: 12, borderRadius: 8, border: '0.5px solid #d1d8e8', background: '#f8f9fb', color: '#1a1f36', outline: 'none' }

  return (
    <div style={{ maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 500, color: '#1a1f36', margin: '4px 0 0' }}>Numeração de Oportunidades</h1>
        <p style={{ fontSize: 12, color: '#8892a4', marginTop: 3 }}>Define o número sequencial gerado ao criar uma nova oportunidade.</p>
      </div>

      {loading ? <p style={{ fontSize: 12, color: '#8892a4' }}>Carregando...</p> : (
        <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #e8edf5', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 10, color: '#8892a4', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 4 }}>Prefixo</label>
            <input value={prefix} onChange={e => setPrefix(e.target.value.toUpperCase())} placeholder="OPP" style={{ ...inp, width: 120 }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 10, color: '#8892a4', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 4 }}>Próximo número</label>
            <input type="number" min={1} value={nextNumber} onChange={e => setNextNumber(Number(e.target.value))} style={{ ...inp, width: 120 }} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#52514e', cursor: 'pointer' }}>
            <input type="checkbox" checked={yearReset} onChange={e => setYearReset(e.target.checked)} />
            Incluir ano no número (reinicia a contagem todo ano)
          </label>
          <div style={{ padding: '10px 14px', borderRadius: 8, background: '#f1f3f8', fontSize: 12, color: '#1a1f36' }}>
            Próxima oportunidade: <strong style={{ fontFamily: 'monospace' }}>{preview}</strong>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={handleSave} disabled={busy}
              style={{ padding: '8px 20px', fontSize: 12, fontWeight: 500, borderRadius: 8, border: 'none', background: '#1a1f36', color: '#fff', cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
              {busy ? 'Salvando...' : 'Salvar'}
            </button>
            {saved && <span style={{ fontSize: 12, color: '#1f8c7d' }}>✅ Salvo</span>}
          </div>
        </div>
      )}
    </div>
  )
}
