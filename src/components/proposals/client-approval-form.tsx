'use client'

import { useState } from 'react'
import { isValidCPF, formatCPF } from '@/lib/utils/cpf'

export function ClientApprovalForm({ token, contractId, currentStatus }: {
  token: string
  contractId: string
  currentStatus: string
}) {
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [cpf, setCpf] = useState('')
  const [comment, setComment] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(currentStatus !== 'pendente')
  const [decision, setDecision] = useState<'aprovado' | 'recusado' | null>(null)
  const [error, setError] = useState('')

  const inp: React.CSSProperties = { width: '100%', padding: '10px 12px', fontSize: 13, borderRadius: 8, border: '0.5px solid #d1d8e8', outline: 'none', color: '#1a1f36', background: '#fff', boxSizing: 'border-box' as const, fontFamily: 'inherit' }

  const cpfValido = isValidCPF(cpf)
  const cpfDigitado = cpf.replace(/\D/g, '').length === 11

  async function handleSubmit(d: 'aprovado' | 'recusado') {
    if (!name.trim()) { setError('Informe seu nome completo.'); return }
    if (!cpf.trim()) { setError('CPF é obrigatório para registrar a decisão.'); return }
    if (!cpfValido) { setError('CPF inválido. Verifique o número informado.'); return }
    setLoading(true); setError('')
    const res = await fetch('/api/proposals/client-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, contract_id: contractId, status: d, name: name.trim(), role: role.trim(), cpf: cpf.replace(/\D/g, ''), comment: comment.trim() }),
    })
    const json = await res.json()
    if (!res.ok) { setError(json.error ?? 'Erro ao registrar. Tente novamente.'); setLoading(false); return }
    setDecision(d)
    setDone(true)
    setLoading(false)
  }

  if (done) {
    const wasApproved = decision === 'aprovado' || (currentStatus === 'aprovado' && !decision)
    return (
      <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #e8edf5', padding: 32, textAlign: 'center' }}>
        <p style={{ fontSize: 32, marginBottom: 8 }}>{wasApproved ? '🤝' : '❌'}</p>
        <p style={{ fontSize: 16, fontWeight: 500, color: '#1a1f36', marginBottom: 4 }}>
          {wasApproved ? 'Proposta aceita!' : 'Proposta declinada'}
        </p>
        <p style={{ fontSize: 13, color: '#8892a4' }}>
          {wasApproved ? 'Obrigado! Em breve nossa equipe entrará em contato.' : 'Registramos sua resposta. Nossa equipe entrará em contato.'}
        </p>
      </div>
    )
  }

  return (
    <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #e8edf5', padding: 24 }}>
      <p style={{ fontSize: 14, fontWeight: 500, color: '#1a1f36', marginBottom: 4 }}>Sua Avaliação</p>
      <p style={{ fontSize: 12, color: '#8892a4', marginBottom: 20 }}>
        Revise a proposta acima e registre sua decisão. Seus dados ficam vinculados ao aceite.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
        <div className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: 12 }}>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: '#8892a4', marginBottom: 4 }}>Nome completo *</label>
            <input value={name} onChange={e => setName(e.target.value)} style={inp} placeholder="João da Silva" />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: '#8892a4', marginBottom: 4 }}>Cargo</label>
            <input value={role} onChange={e => setRole(e.target.value)} style={inp} placeholder="Gerente de Engenharia" />
          </div>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 11, color: '#8892a4', marginBottom: 4 }}>
            CPF <span style={{ color: '#8e4550' }}>*</span>
          </label>
          <input
            value={cpf}
            onChange={e => setCpf(formatCPF(e.target.value))}
            style={{ ...inp, borderColor: cpfDigitado ? (cpfValido ? '#22c55e' : '#8e4550') : '#d1d8e8' }}
            placeholder="000.000.000-00"
            maxLength={14}
          />
          {cpfDigitado && !cpfValido && (
            <p style={{ fontSize: 11, color: '#8e4550', margin: '4px 0 0' }}>CPF inválido. Verifique o número.</p>
          )}
          {cpfDigitado && cpfValido && (
            <p style={{ fontSize: 11, color: '#1f8c7d', margin: '4px 0 0' }}>✓ CPF válido</p>
          )}
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 11, color: '#8892a4', marginBottom: 4 }}>Comentário (opcional)</label>
          <textarea value={comment} onChange={e => setComment(e.target.value)} rows={3} style={{ ...inp, resize: 'vertical' as const }}
            placeholder="Alguma observação ou condição para o aceite..." />
        </div>
      </div>

      {error && <p style={{ fontSize: 12, color: '#8e4550', marginBottom: 12 }}>{error}</p>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => handleSubmit('aprovado')} disabled={loading || !cpfValido || !name.trim()}
          style={{ flex: 1, padding: '14px', fontSize: 14, fontWeight: 600, borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#1b556b,#32af9d)', color: '#fff', cursor: 'pointer', opacity: loading ? 0.6 : 1 }}>
          🤝 Aceitar proposta
        </button>
        <button onClick={() => handleSubmit('recusado')} disabled={loading || !cpfValido || !name.trim()}
          style={{ flex: 1, padding: '14px', fontSize: 14, fontWeight: 600, borderRadius: 10, border: '0.5px solid #dcadb3', background: '#fff', color: '#8e4550', cursor: 'pointer', opacity: loading ? 0.6 : 1 }}>
          ❌ Declinar
        </button>
      </div>
    </div>
  )
}
