'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

export function ReviewForm({ token, contractId, reviewerName, reviewerRole, canApprove }: {
  token: string
  contractId: string
  reviewerName: string
  reviewerRole: string
  canApprove: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [comment, setComment] = useState('')
  const [restrictions, setRestrictions] = useState('')
  const [hasRestrictions, setHasRestrictions] = useState(false)
  const [decision, setDecision] = useState<'approve' | 'approve_with_restrictions' | 'reject' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const inp: React.CSSProperties = {
    width: '100%', padding: '10px 12px', fontSize: 13, borderRadius: 8,
    border: '0.5px solid #d1d8e8', outline: 'none', color: '#1a1f36',
    background: '#fff', resize: 'vertical' as const, fontFamily: 'inherit',
    boxSizing: 'border-box' as const,
  }

  async function handleSubmit() {
    if (!comment.trim()) { setError('Inclua um comentário antes de enviar.'); return }
    if (!decision) { setError('Selecione uma decisão.'); return }
    if (decision === 'approve_with_restrictions' && !restrictions.trim()) {
      setError('Descreva as restrições encontradas.'); return
    }

    setError(null)
    startTransition(async () => {
      const status = decision === 'reject' ? 'reprovado_tecnico' : 'aprovado_tecnico'
      const res = await fetch('/api/proposals/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          contract_id: contractId,
          status,
          technical_comment: comment.trim(),
          technical_restrictions: restrictions.trim() || null,
          actor_name: reviewerName,
        }),
      })
      if (!res.ok) { setError('Erro ao registrar. Tente novamente.'); return }
      setDone(true)
    })
  }

  if (done) {
    return (
      <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #e8edf5', padding: 32, marginTop: 16, textAlign: 'center' }}>
        <p style={{ fontSize: 24, marginBottom: 8 }}>{decision === 'reject' ? '❌' : '✅'}</p>
        <p style={{ fontSize: 16, fontWeight: 500, color: '#1a1f36', marginBottom: 4 }}>
          {decision === 'reject' ? 'Proposta reprovada' : 'Aprovação técnica registrada'}
        </p>
        <p style={{ fontSize: 13, color: '#8892a4', marginBottom: 20 }}>
          Seu parecer foi registrado como <strong>{reviewerName}</strong>. Você pode fechar esta aba.
        </p>
        <p style={{ fontSize: 12, color: '#b0b8c8' }}>O responsável comercial foi notificado.</p>
      </div>
    )
  }

  if (!canApprove) {
    return (
      <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #e8edf5', padding: 20, marginTop: 16, textAlign: 'center' }}>
        <p style={{ fontSize: 13, color: '#8892a4' }}>Seu perfil não tem permissão para aprovar propostas técnicas.</p>
      </div>
    )
  }

  return (
    <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #e8edf5', padding: 24, marginTop: 16 }}>
      <p style={{ fontSize: 14, fontWeight: 500, color: '#1a1f36', marginBottom: 4 }}>Seu Parecer Técnico</p>
      <p style={{ fontSize: 12, color: '#8892a4', marginBottom: 20 }}>
        Revise o documento acima e registre sua avaliação técnica. Seu parecer ficará vinculado ao seu login ({reviewerName}).
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Comentário */}
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#1a1f36', marginBottom: 6 }}>
            Comentário técnico <span style={{ color: '#8e4550' }}>*</span>
          </label>
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="Descreva sua avaliação técnica da proposta. Ex: O dimensionamento está adequado para o porte do hospital. A equipe proposta atende os requisitos da RDC..."
            rows={4}
            style={inp}
          />
        </div>

        {/* Restrições */}
        <div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 500, color: '#1a1f36', marginBottom: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={hasRestrictions}
              onChange={e => { setHasRestrictions(e.target.checked); if (!e.target.checked) setRestrictions('') }}
            />
            Há restrições técnicas que o comercial deve analisar
          </label>
          {hasRestrictions && (
            <textarea
              value={restrictions}
              onChange={e => setRestrictions(e.target.value)}
              placeholder="Descreva as restrições. Ex: O número de leitos informado diverge do levantamento in loco. Recomendo revisar o inventário de equipamentos da UTI..."
              rows={3}
              style={{ ...inp, border: '0.5px solid #ffe596', background: '#fffdf5' }}
            />
          )}
        </div>

        {/* Decisão */}
        <div>
          <p style={{ fontSize: 12, fontWeight: 500, color: '#1a1f36', marginBottom: 10 }}>Decisão <span style={{ color: '#8e4550' }}>*</span></p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              onClick={() => { setDecision('approve'); setHasRestrictions(false); setRestrictions('') }}
              style={{
                flex: 1, minWidth: 140, padding: '12px 16px', fontSize: 13, fontWeight: 500, borderRadius: 10, cursor: 'pointer',
                border: decision === 'approve' ? '2px solid #1f8c7d' : '0.5px solid #d1d8e8',
                background: decision === 'approve' ? '#e3f5f1' : '#fff',
                color: decision === 'approve' ? '#1f8c7d' : '#52514e',
              }}>
              ✅ Aprovado tecnicamente
            </button>
            <button
              onClick={() => { setDecision('approve_with_restrictions'); setHasRestrictions(true) }}
              style={{
                flex: 1, minWidth: 140, padding: '12px 16px', fontSize: 13, fontWeight: 500, borderRadius: 10, cursor: 'pointer',
                border: decision === 'approve_with_restrictions' ? '2px solid #c2683d' : '0.5px solid #d1d8e8',
                background: decision === 'approve_with_restrictions' ? '#fbeee5' : '#fff',
                color: decision === 'approve_with_restrictions' ? '#c2683d' : '#52514e',
              }}>
              ⚠ Aprovado com restrições
            </button>
            <button
              onClick={() => setDecision('reject')}
              style={{
                flex: 1, minWidth: 140, padding: '12px 16px', fontSize: 13, fontWeight: 500, borderRadius: 10, cursor: 'pointer',
                border: decision === 'reject' ? '2px solid #8e4550' : '0.5px solid #d1d8e8',
                background: decision === 'reject' ? '#f6e9ea' : '#fff',
                color: decision === 'reject' ? '#8e4550' : '#52514e',
              }}>
              ❌ Reprovado
            </button>
          </div>
        </div>

        {error && <p style={{ fontSize: 12, color: '#8e4550' }}>{error}</p>}

        <button
          onClick={handleSubmit}
          disabled={isPending || !decision || !comment.trim()}
          style={{
            padding: '12px 24px', fontSize: 13, fontWeight: 500, borderRadius: 10, border: 'none',
            background: !decision || !comment.trim() ? '#d1d8e8' : '#1a1f36',
            color: '#fff', cursor: !decision || !comment.trim() ? 'not-allowed' : 'pointer',
            opacity: isPending ? 0.6 : 1,
          }}>
          {isPending ? 'Registrando...' : 'Registrar parecer técnico'}
        </button>
      </div>
    </div>
  )
}
