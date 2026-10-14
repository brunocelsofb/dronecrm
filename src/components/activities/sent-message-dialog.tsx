'use client'

// Rastreabilidade: mostra a mensagem completa enviada ao cliente por um aviso
// de renovação do Copiloto (metadata.final_message), com data, destino e remetente.

type Props = {
  title: string
  metadata: Record<string, unknown>
  senderName?: string | null
  onClose: () => void
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null
}

export function SentMessageDialog({ title, metadata, senderName, onClose }: Props) {
  const message  = str(metadata.final_message) ?? str(metadata.draft_message) ?? '(mensagem não registrada)'
  const sentAt   = str(metadata.sent_at)
  const phone    = str(metadata.target_phone)
  const contact  = str(metadata.contact_name)
  const instance = str(metadata.sent_instance)
  const toEmail  = str(metadata.target_email) ?? (Array.isArray(metadata.email_to) ? (metadata.email_to as string[]).join(', ') : null)
  const fromEmail = str(metadata.email_from)
  const ccEmail  = str(metadata.email_cc)
  const subject  = str(metadata.final_subject)

  const when = sentAt
    ? new Date(sentAt).toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : null

  const row = (label: string, value: string | null) => value && (
    <div style={{ display: 'flex', gap: 8, fontSize: 12 }}>
      <span style={{ color: '#8892a4', minWidth: 92 }}>{label}</span>
      <span style={{ color: '#1a1f36' }}>{value}</span>
    </div>
  )

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 16 }}
    >
      <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 520, padding: 20, boxShadow: '0 20px 50px rgba(0,0,0,0.2)' }}>
        <p style={{ fontSize: 15, fontWeight: 600, color: '#1a1f36', margin: '0 0 12px' }}>{title}</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
          {row('Enviado em', when)}
          {row('Para', contact ?? null)}
          {row('WhatsApp', phone && instance ? `${phone} · pelo WhatsApp ${instance}` : phone)}
          {row('E-mail', toEmail && fromEmail ? `${toEmail} · de ${fromEmail}` : toEmail)}
          {row('Cópia', ccEmail)}
          {row('Assunto', subject)}
          {row('Enviado por', senderName ?? null)}
        </div>

        <p style={{ fontSize: 12, fontWeight: 600, color: '#374151', margin: '0 0 4px' }}>Mensagem enviada</p>
        <div style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: 12, maxHeight: 320, overflowY: 'auto' }}>
          {message}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button
            onClick={onClose}
            style={{ fontSize: 13, padding: '8px 14px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', color: '#374151', cursor: 'pointer' }}
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}
