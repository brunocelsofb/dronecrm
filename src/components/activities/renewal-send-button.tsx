'use client'

// Botão + janela para o consultor revisar e enviar o aviso de renovação
// preparado pelo Copiloto IA (atividade com metadata.approval = 'pending').
// Envia WhatsApp + e-mail juntos; o e-mail sai da conta do consultor dono do
// WhatsApp escolhido.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSendableInstances, sendRenewalAlert, type SendableInstance } from '@/lib/actions/renewal-alerts'
import { renderRenewalTemplate } from '@/lib/agent/renewal-templates'

export function RenewalSendButton({
  activityId,
  contractId,
  draft,
  draftSubject,
  phone,
  email,
  contactName,
  onSent,
  onFailed,
}: {
  activityId: string
  contractId: string
  draft: string
  draftSubject?: string | null
  phone: string
  email?: string | null
  contactName?: string | null
  onSent?: (r: { title?: string; content?: string; metadata?: Record<string, unknown> }) => void
  onFailed?: (error: string) => void
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState(draft)
  const [subject, setSubject] = useState(draftSubject ?? '')
  const [instances, setInstances] = useState<SendableInstance[]>([])
  const [instance, setInstance] = useState('')
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selected = instances.find(i => i.name === instance)
  // Mesmo critério do envio: consultor vinculado ao WhatsApp; sem vínculo, o rótulo
  const consultor = selected?.ownerName ?? selected?.label ?? ''
  const preview = renderRenewalTemplate(message, { consultor }).replace(/\n{3,}/g, '\n\n').trim()
  const previewSubject = renderRenewalTemplate(subject, { consultor }).trim()

  const blocker =
    !email ? 'O contato não tem e-mail cadastrado. Cadastre o e-mail do contato para enviar o aviso.'
    : !selected ? null
    : !selected.ownerUserId ? 'Esse WhatsApp não tem consultor definido (Configurações → Conexões).'
    : !selected.senderEmail ? `${selected.ownerName ?? 'O consultor'} ainda não conectou o e-mail em Minha Conta.`
    : null

  async function handleOpen() {
    setOpen(true)
    setError(null)
    setMessage(draft)
    setSubject(draftSubject ?? '')
    setLoading(true)
    const res = await getSendableInstances(contractId)
    setLoading(false)
    if (res.error) { setError(res.error); return }
    setInstances(res.instances)
    setInstance(res.suggested ?? res.instances[0]?.name ?? '')
  }

  async function handleSend() {
    if (!confirm(`Enviar o aviso para ${contactName ?? 'o cliente'} por WhatsApp (${phone}) e e-mail (${email})?`)) return
    setSending(true)
    setError(null)
    const res = await sendRenewalAlert(activityId, message, subject, instance)
    setSending(false)
    if (res.error) { setError(res.error); onFailed?.(res.error); return }
    setOpen(false)
    onSent?.({ title: res.title, content: res.content, metadata: res.metadata })
    router.refresh()
  }

  const label: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', margin: '12px 0 4px' }
  const input: React.CSSProperties = { width: '100%', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 10px', boxSizing: 'border-box' }

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
          <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 560, maxHeight: '92vh', overflowY: 'auto', padding: 20, boxShadow: '0 20px 50px rgba(0,0,0,0.2)' }}>
            <p style={{ fontSize: 15, fontWeight: 600, color: '#1a1f36', margin: 0 }}>Revisar aviso de renovação</p>
            <p style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 0' }}>
              Vai por <strong>WhatsApp</strong> ({phone}) e <strong>e-mail</strong> ({email ?? 'sem e-mail'}) para {contactName ?? 'o contato'}.
            </p>

            <label style={label}>Enviar pelo WhatsApp e e-mail de</label>
            {loading ? (
              <p style={{ fontSize: 12, color: '#6b7280' }}>Carregando…</p>
            ) : instances.length === 0 ? (
              <p style={{ fontSize: 12, color: '#b91c1c' }}>Nenhum WhatsApp disponível. Conecte uma instância em Configurações → Conexões.</p>
            ) : (
              <>
                <select value={instance} onChange={e => setInstance(e.target.value)} style={input}>
                  {instances.map(i => (
                    <option key={i.name} value={i.name}>{i.label}{i.label !== i.name ? ` (${i.name})` : ''}</option>
                  ))}
                </select>
                {selected?.senderEmail && (
                  <p style={{ fontSize: 11, color: '#6b7280', margin: '4px 0 0' }}>E-mail sai de: {selected.senderEmail}</p>
                )}
              </>
            )}

            <label style={label}>Assunto do e-mail</label>
            <input value={subject} onChange={e => setSubject(e.target.value)} style={input} />

            <label style={label}>Mensagem (mesmo texto no WhatsApp e no e-mail)</label>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              rows={9}
              style={{ ...input, lineHeight: 1.5, resize: 'vertical' }}
            />
            <p style={{ fontSize: 11, color: '#9ca3af', margin: '4px 0 0' }}>
              <code>{'{{consultor}}'}</code> vira o nome do consultor vinculado ao WhatsApp escolhido. O e-mail vai no formato padrão (faixa, detalhes do contrato e contato).
            </p>

            {!loading && instance && (
              <>
                <label style={label}>Como o cliente vai receber</label>
                <div style={{ fontSize: 12, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 10px', marginBottom: 6 }}>
                  <strong>Assunto:</strong> {previewSubject || '—'}
                </div>
                <div style={{ fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: 10, maxHeight: 180, overflowY: 'auto' }}>
                  {preview}
                </div>
              </>
            )}

            {(blocker || error) && (
              <p style={{ fontSize: 12, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 10px', marginTop: 12 }}>
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
                disabled={sending || loading || !instance || !message.trim() || !subject.trim() || !!blocker}
                style={{ fontSize: 13, padding: '8px 14px', borderRadius: 8, border: 'none', background: '#1B556B', color: '#fff', cursor: 'pointer', opacity: sending || !instance || blocker ? 0.6 : 1 }}
              >
                {sending ? 'Enviando…' : 'Enviar WhatsApp + e-mail'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
