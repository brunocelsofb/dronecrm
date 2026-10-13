'use client'

// Botão + janela para o consultor revisar e enviar o aviso de renovação
// preparado pelo Copiloto IA (atividade com metadata.approval = 'pending').

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSendableInstances, sendRenewalAlert, type SendableInstance } from '@/lib/actions/renewal-alerts'
import { renderRenewalTemplate } from '@/lib/agent/renewal-templates'

export function RenewalSendButton({
  activityId,
  contractId,
  draft,
  phone,
  contactName,
}: {
  activityId: string
  contractId: string
  draft: string
  phone: string
  contactName?: string | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState(draft)
  const [instances, setInstances] = useState<SendableInstance[]>([])
  const [instance, setInstance] = useState('')
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const consultor = instances.find(i => i.name === instance)?.label ?? ''
  const preview = renderRenewalTemplate(message, { consultor }).replace(/\n{3,}/g, '\n\n').trim()

  async function handleOpen() {
    setOpen(true)
    setError(null)
    setMessage(draft)
    setLoading(true)
    const res = await getSendableInstances(contractId)
    setLoading(false)
    if (res.error) { setError(res.error); return }
    setInstances(res.instances)
    setInstance(res.suggested ?? res.instances[0]?.name ?? '')
  }

  async function handleSend() {
    if (!confirm(`Enviar esta mensagem para ${contactName ?? 'o cliente'} (${phone})?`)) return
    setSending(true)
    setError(null)
    const res = await sendRenewalAlert(activityId, message, instance)
    setSending(false)
    if (res.error) { setError(res.error); return }
    setOpen(false)
    router.refresh()
  }

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
          aria-label="Revisar aviso de renovação"
          onClick={e => { if (e.target === e.currentTarget && !sending) setOpen(false) }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 16 }}
        >
          <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 520, padding: 20, boxShadow: '0 20px 50px rgba(0,0,0,0.2)' }}>
            <p style={{ fontSize: 15, fontWeight: 600, color: '#1a1f36', margin: 0 }}>Revisar aviso de renovação</p>
            <p style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 14px' }}>
              Para {contactName ?? 'o contato'} · {phone}. <code>{'{{consultor}}'}</code> vira o nome do WhatsApp escolhido.
            </p>

            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Mensagem</label>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              rows={10}
              style={{ width: '100%', fontSize: 13, lineHeight: 1.5, border: '1px solid #d1d5db', borderRadius: 8, padding: 10, resize: 'vertical', boxSizing: 'border-box' }}
            />

            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', margin: '12px 0 4px' }}>Enviar pelo WhatsApp de</label>
            {loading ? (
              <p style={{ fontSize: 12, color: '#6b7280' }}>Carregando…</p>
            ) : instances.length === 0 ? (
              <p style={{ fontSize: 12, color: '#b91c1c' }}>Nenhum WhatsApp disponível. Conecte uma instância em Configurações → Conexões.</p>
            ) : (
              <select
                value={instance}
                onChange={e => setInstance(e.target.value)}
                style={{ width: '100%', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 10px' }}
              >
                {instances.map(i => (
                  <option key={i.name} value={i.name}>{i.label}{i.label !== i.name ? ` (${i.name})` : ''}</option>
                ))}
              </select>
            )}

            {!loading && instance && (
              <>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', margin: '12px 0 4px' }}>Como o cliente vai receber</label>
                <div style={{ fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: 10, maxHeight: 180, overflowY: 'auto' }}>
                  {preview}
                </div>
              </>
            )}

            {error && (
              <p style={{ fontSize: 12, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 10px', marginTop: 12 }}>{error}</p>
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
                disabled={sending || loading || !instance || !message.trim()}
                style={{ fontSize: 13, padding: '8px 14px', borderRadius: 8, border: 'none', background: '#1B556B', color: '#fff', cursor: 'pointer', opacity: sending || !instance ? 0.6 : 1 }}
              >
                {sending ? 'Enviando…' : 'Enviar no WhatsApp'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
