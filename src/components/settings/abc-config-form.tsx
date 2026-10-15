'use client'

import { useState } from 'react'

type AbcConfigData = {
  billing_tier1_max: number
  billing_tier2_max: number
  curve_a_min: number
  curve_b_min: number
}

async function saveAbcConfig(nature: string, data: AbcConfigData) {
  const res = await fetch('/api/settings/abc-config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nature, ...data }),
  })
  return res.json()
}

function Section({ title, emoji, data, onSave }: {
  title: string; emoji: string; data: AbcConfigData
  onSave: (d: AbcConfigData) => Promise<void>
}) {
  const [d, setD] = useState(data)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  const inp: React.CSSProperties = { padding: '7px 10px', fontSize: 12, borderRadius: 8, border: '0.5px solid #d1d8e8', background: '#f8f9fb', color: '#1a1f36', outline: 'none', width: '100%' }
  const lbl: React.CSSProperties = { fontSize: 10, color: '#8892a4', textTransform: 'uppercase', letterSpacing: '0.6px', display: 'block', marginBottom: 4 }

  const fmt = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v)

  return (
    <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #e8edf5', padding: 20 }}>
      <p style={{ fontSize: 14, fontWeight: 500, color: '#1a1f36', marginBottom: 16 }}>{emoji} {title}</p>

      <div style={{ marginBottom: 16 }}>
        <p style={{ fontSize: 11, fontWeight: 500, color: '#1a1f36', marginBottom: 10 }}>Faixas de Faturamento (Peso 50%)</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={lbl}>Nota 1 — até (R$)</label>
            <input type="number" value={d.billing_tier1_max} onChange={e => setD(prev => ({ ...prev, billing_tier1_max: Number(e.target.value) }))} style={inp} />
            <p style={{ fontSize: 10, color: '#b0b8c8', marginTop: 3 }}>De R$ 0 até {fmt(d.billing_tier1_max)} = nota 1</p>
          </div>
          <div>
            <label style={lbl}>Nota 2 — até (R$)</label>
            <input type="number" value={d.billing_tier2_max} onChange={e => setD(prev => ({ ...prev, billing_tier2_max: Number(e.target.value) }))} style={inp} />
            <p style={{ fontSize: 10, color: '#b0b8c8', marginTop: 3 }}>De {fmt(d.billing_tier1_max + 1)} até {fmt(d.billing_tier2_max)} = nota 2 · acima = nota 3</p>
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <p style={{ fontSize: 11, fontWeight: 500, color: '#1a1f36', marginBottom: 10 }}>Thresholds da Curva</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <div>
            <label style={lbl}>Curva A — mínimo</label>
            <input type="number" step="0.01" value={d.curve_a_min} onChange={e => setD(prev => ({ ...prev, curve_a_min: Number(e.target.value) }))} style={inp} />
            <p style={{ fontSize: 10, color: '#8e4550', marginTop: 3 }}>≥ {d.curve_a_min} = A</p>
          </div>
          <div>
            <label style={lbl}>Curva B — mínimo</label>
            <input type="number" step="0.01" value={d.curve_b_min} onChange={e => setD(prev => ({ ...prev, curve_b_min: Number(e.target.value) }))} style={inp} />
            <p style={{ fontSize: 10, color: '#c2683d', marginTop: 3 }}>≥ {d.curve_b_min} e &lt; {d.curve_a_min} = B</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 4 }}>
            <p style={{ fontSize: 10, color: '#8892a4' }}>&lt; {d.curve_b_min} = C</p>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button disabled={busy} onClick={async () => { setBusy(true); setSaved(false); await onSave(d); setBusy(false); setSaved(true) }}
          style={{ padding: '8px 20px', fontSize: 12, fontWeight: 500, borderRadius: 8, border: 'none', background: '#1a1f36', color: '#fff', cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Salvando...' : 'Salvar'}
        </button>
        {saved && <span style={{ fontSize: 12, color: '#1f8c7d' }}>✅ Salvo</span>}
      </div>
    </div>
  )
}

export function AbcConfigForm({ clinica, hospitalar }: { clinica: AbcConfigData; hospitalar: AbcConfigData }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Section title="Engenharia Clínica" emoji="🔬" data={clinica}
        onSave={d => saveAbcConfig('eng_clinica', d).then(() => {})} />
      <Section title="Engenharia Hospitalar" emoji="🏥" data={hospitalar}
        onSave={d => saveAbcConfig('eng_hospitalar', d).then(() => {})} />
    </div>
  )
}
