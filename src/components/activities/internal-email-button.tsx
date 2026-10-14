'use client'

// Revisar e enviar um e-mail INTERNO preparado pelo Copiloto (ganho,
// renovação, relatório mensal de implantação). Destinatários e cópia são
// editáveis; sai do e-mail de quem envia.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { getMyEmailSender, sendInternalEmail } from '@/lib/actions/internal-notices'

export function InternalEmailButton({
  activityId,
  draft,
  draftSubject,
  draftTo,
  draftCc,
  onSent,
  onFailed,
}: {
  activityId: string
  draft: string
  draftSubject?: string | null
  draftTo?: string[] | null
  draftCc?: string[] | null
  onSent?: (r: { title?: string; content?: string; metadata?: Record<string, unknown> }) => void
  onFailed?: (error: string) => void
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [to, setTo] = useState('')
  const [cc, setCc] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [sender, setSender] = useState<string | null | undefined>(undefined)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleOpen() {
    setOpen(true)
    setError(null)
    setTo((draftTo ?? []).join(', '))
    setCc((draftCc ?? []).join(', '))
    setSubject(draftSubject ?? '')
    setMessage(draft)
    setSender(undefined)
    const r = await getMyEmailSender()
    setSender(r.email)
  }

  async function handleSend() {
    setSending(true)
    setError(null)
    const res = await sendInternalEmail(activityId, to, cc, subject, message)
    setSending(false)
    if (res.error) { setError(res.error); onFailed?.(res.error); return }
    setOpen(false)
    onSent?.({ title: res.title, content: res.content, metadata: res.metadata })
    router.refresh()
  }

  const label: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', margin: '12px 0 4px' }
  const input: React.CSSProperties = { width: '100%', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 10px', boxSizing: 'border-box' }
  const blocker = sender === null ? 'Seu e-mail não está conectado. Conecte em Minha Conta para enviar.' : null

  return (
    <>
      <button
        onClick={handleOpen}
        style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, border: '0.5px solid #1B556B', background: '#1B556B', color: '#fff', cursor: 'pointer' }}
      >
        Revisar e enviar
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Revisar e-mail interno"
          onClick={e => { if (e.target === e.currentTarget && !sending) setOpen(false) }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 16 }}
        >
          <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 600, maxHeight: '92vh', overflowY: 'auto', padding: 20, boxShadow: '0 20px 50px rgba(0,0,0,0.2)' }}>
            <p style={{ fontSize: 15, fontWeight: 600, color: '#1a1f36', margin: 0 }}>Revisar e-mail interno</p>
            <p style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 0' }}>
              Comunicação para o time Orbis — sem valores. {sender === undefined ? 'Verificando seu e-mail…' : sender ? <>Sai de <strong>{sender}</strong>.</> : null}
            </p>

            <label style={label} htmlFor={`to-${activityId}`}>Para (separe por vírgula)</label>
            <input id={`to-${activityId}`} value={to} onChange={e => setTo(e.target.value)} style={input} placeholder="time@orbisengenharia.com.br" />

            <label style={label} htmlFor={`cc-${activityId}`}>Cópia</label>
            <input id={`cc-${activityId}`} value={cc} onChange={e => setCc(e.target.value)} style={input} />

            <label style={label} htmlFor={`sub-${activityId}`}>Assunto</label>
            <input id={`sub-${activityId}`} value={subject} onChange={e => setSubject(e.target.value)} style={input} />

            <label style={label} htmlFor={`msg-${activityId}`}>Mensagem</label>
            <textarea
              id={`msg-${activityId}`}
              value={message}
              onChange={e => setMessage(e.target.value)}
              rows={12}
              style={{ ...input, lineHeight: 1.5, resize: 'vertical', fontFamily: 'inherit' }}
            />
            <p style={{ fontSize: 11, color: '#9ca3af', margin: '4px 0 0' }}>Use *texto* para negrito.</p>

            {(blocker || error) && (
              <p role="alert" style={{ fontSize: 12, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 10px', marginTop: 12 }}>
                {error ?? blocker}
              </p>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button
                onClick={() => setOpen(false)}
                disabled={sending}
                style={{ fontSize: 13, padding: '8px 14px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', color: '#374151', cursor: 'pointer' }}
              >
                Cancelar
              </button>
              <button
                onClick={handleSend}
                disabled={sending || !to.trim() || !subject.trim() || !message.trim() || !!blocker || sender === undefined}
                style={{ fontSize: 13, padding: '8px 14px', borderRadius: 8, border: 'none', background: '#1B556B', color: '#fff', cursor: 'pointer', opacity: sending || blocker ? 0.6 : 1 }}
              >
                {sending ? 'Enviando…' : 'Enviar e-mail'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
