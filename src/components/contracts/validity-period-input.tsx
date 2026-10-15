'use client'

import { useState } from 'react'
import { addMonthsToDateString } from '@/lib/utils/date'

const MONTH_SHORTCUTS = [1, 2, 3, 6, 12, 24, 36, 48, 60]

export function ValidityPeriodInput({
  defaultFrom,
  defaultUntil,
  defaultAutoRenewal,
  required = false,
}: {
  defaultFrom?: string | null
  defaultUntil?: string | null
  defaultAutoRenewal?: boolean
  required?: boolean
}) {
  const [from, setFrom] = useState(defaultFrom ?? '')
  const [until, setUntil] = useState(defaultUntil ?? '')

  function applyMonths(months: number) {
    if (!from) return
    setUntil(addMonthsToDateString(from, months))
  }

  const inputStyle = {
    width: '100%', padding: '7px 10px', fontSize: 12, borderRadius: 8,
    border: '0.5px solid #d1d8e8', background: '#f8f9fb', color: '#1a1f36', outline: 'none',
  }

  return (
    <div>
      {required && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, padding: '8px 12px', borderRadius: 8, background: '#fbeee5', border: '0.5px solid #ffe596' }}>
          <span style={{ fontSize: 12, color: '#c2683d' }}>⚠ Preencha a vigência — obrigatório para contratos ativos.</span>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={{ display: 'block', fontSize: 10, color: '#8892a4', textTransform: 'uppercase' as const, letterSpacing: '0.7px', marginBottom: 4 }}>
            Vigência — início {required && <span style={{ color: '#8e4550' }}>*</span>}
          </label>
          <input name="valid_from" type="date" value={from} required={required}
            onChange={e => setFrom(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 10, color: '#8892a4', textTransform: 'uppercase' as const, letterSpacing: '0.7px', marginBottom: 4 }}>
            Vigência — fim {required && <span style={{ color: '#8e4550' }}>*</span>}
          </label>
          <input name="valid_until" type="date" value={until} required={required}
            onChange={e => setUntil(e.target.value)} style={inputStyle} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
            {MONTH_SHORTCUTS.map(m => (
              <button key={m} type="button" disabled={!from} onClick={() => applyMonths(m)}
                title={!from ? 'Preencha o início primeiro' : `+${m} meses a partir do início`}
                style={{
                  padding: '3px 8px', fontSize: 10, borderRadius: 20, cursor: from ? 'pointer' : 'not-allowed',
                  border: '0.5px solid #d1d8e8', background: '#fff', color: from ? '#1a1f36' : '#b0b8c8',
                  opacity: from ? 1 : 0.5,
                }}>
                +{m}m
              </button>
            ))}
          </div>
          <p style={{ marginTop: 4, fontSize: 10, color: '#b0b8c8' }}>
            Clique em +Xm para calcular o fim a partir do início — ou digite a data direto.
          </p>
        </div>
      </div>

      <label style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#52514e', cursor: 'pointer' }}>
        <input type="checkbox" name="auto_renewal" defaultChecked={defaultAutoRenewal} />
        Renovação automática (por cláusula contratual)
      </label>
    </div>
  )
}
