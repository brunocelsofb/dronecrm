'use client'

// Selo clicável (estilo tag) para trocar o tipo de receita do contrato:
//   $ Recorrente — entra automática todo mês pelo valor do contrato
//   📏 Medição  — conta só a medição validada de cada mês

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { setBillingType } from '@/lib/actions/billing'

const OPTIONS = [
  { value: 'fixed', label: '$ Recorrente', hint: 'Entra automática todo mês pelo valor do contrato', bg: '#e4eef1', color: '#1b556b' },
  { value: 'metered', label: '📏 Medição', hint: 'Conta só a medição validada de cada mês (com relatório ou aprovação do admin)', bg: '#fbeee5', color: '#c2683d' },
] as const

export function RevenueTypeToggle({ contractId, billingType, canEdit }: { contractId: string; billingType: string | null; canEdit: boolean }) {
  const router = useRouter()
  const [value, setValue] = useState(billingType === 'metered' ? 'metered' : 'fixed')
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const current = OPTIONS.find(o => o.value === value) ?? OPTIONS[0]

  async function choose(next: 'fixed' | 'metered') {
    setOpen(false)
    if (next === value) return
    const msg = next === 'metered'
      ? 'Mudar para MEDIÇÃO? A receita deste contrato só vai contar quando a medição de cada mês for lançada e validada.'
      : 'Mudar para RECORRENTE? A receita passa a entrar automática todo mês pelo valor do contrato.'
    if (!window.confirm(msg)) return
    setSaving(true)
    setValue(next)
    await setBillingType(contractId, next)
    setSaving(false)
    router.refresh()
  }

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        onClick={() => canEdit && setOpen(o => !o)}
        disabled={!canEdit || saving}
        title={canEdit ? `${current.hint} — clique para mudar` : current.hint}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
          background: current.bg, color: current.color, border: 'none',
          cursor: canEdit ? 'pointer' : 'default', opacity: saving ? 0.7 : 1,
          display: 'inline-flex', alignItems: 'center', gap: 4,
        }}
      >
        {current.label}
        {canEdit && <span aria-hidden="true" style={{ fontSize: 9 }}>▾</span>}
      </button>
      {open && (
        <div role="listbox" style={{
          position: 'absolute', top: '110%', left: 0, zIndex: 999,
          background: '#fff', borderRadius: 10, border: '0.5px solid #e8edf5',
          boxShadow: '0 8px 24px rgba(0,0,0,0.1)', minWidth: 260, overflow: 'hidden',
        }}>
          <p style={{ fontSize: 10, color: '#8892a4', padding: '8px 14px 4px', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Tipo de receita</p>
          {OPTIONS.map(o => (
            <button
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              type="button"
              onClick={() => choose(o.value)}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 8, width: '100%',
                padding: '8px 14px', background: o.value === value ? '#f8f9fb' : '#fff',
                border: 'none', cursor: 'pointer', textAlign: 'left',
              }}
            >
              <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: o.bg, color: o.color, flexShrink: 0 }}>{o.label}</span>
              <span style={{ flex: 1, fontSize: 11, color: '#52514e', lineHeight: 1.35 }}>{o.hint}</span>
              {o.value === value && <span style={{ color: '#1B556B', fontSize: 14 }}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
