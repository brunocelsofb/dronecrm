'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Event = {
  id: string
  type: string
  content: string
  created_at: string
  profiles: { full_name: string } | null
  metadata: any | null
  is_pinned?: boolean | null
  opportunity_badge?: string | null
  status?: string | null
}

const TYPE_CONFIG: Record<string, { icon: string; color: string; bg: string; label: string }> = {
  note:                 { icon: '💬', color: '#f97316', bg: '#fff7ed',  label: 'Nota' },
  email:                { icon: '✉️', color: '#3b5bdb', bg: '#eef3ff',  label: 'E-mail' },
  stage_change:         { icon: '🔄', color: '#1a7c3e', bg: '#eaf5ee',  label: 'Mudança de etapa' },
  pipeline_change:      { icon: '↗️', color: '#1a7c3e', bg: '#eaf5ee',  label: 'Mudança de funil' },
  file:                 { icon: '📎', color: '#3b5bdb', bg: '#eef3ff',  label: 'Arquivo' },
  automation_triggered: { icon: '⚡', color: '#7c3aed', bg: '#f3e8ff',  label: 'Automação' },
  system:               { icon: '🔧', color: '#8892a4', bg: '#f1f3f8',  label: 'Sistema' },
  transfer:             { icon: '↔️', color: '#8892a4', bg: '#f1f3f8',  label: 'Transferência' },
  proposal:             { icon: '📋', color: '#3b5bdb', bg: '#eef3ff',  label: 'Proposta' },
  client_decision:      { icon: '🤝', color: '#166534', bg: '#dcfce7',  label: 'Proposta Aceita' },
  client_rejection:     { icon: '✕',  color: '#b91c1c', bg: '#fef2f2',  label: 'Proposta Encerrada' },
  whatsapp_sent:        { icon: '📲', color: '#166534', bg: '#dcfce7',  label: 'WhatsApp enviado' },
}

// Tarefas do Copiloto ainda abertas ficam só na aba Atividades; no Histórico
// entra apenas o registro depois de concluídas (ex.: aviso enviado ao cliente).
function isOpenCopilotTask(e: Event): boolean {
  return e.metadata?.source === 'copiloto_ia' && e.status !== 'done'
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('pt-BR', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export function TimelineFeed({
  events,
  contractId,
  currentUserRole,
  noteEndpointField = 'contract_id',
  notePlaceholder = 'Adicione uma nota sobre esta oportunidade...',
}: {
  events: Event[]
  contractId: string
  currentUserRole?: string
  noteEndpointField?: 'contract_id' | 'company_id'
  notePlaceholder?: string
}) {
  const router = useRouter()
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [pinningId, setPinningId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [localPins, setLocalPins] = useState<Record<string, boolean>>(
    Object.fromEntries(events.filter(e => e.is_pinned).map(e => [e.id, true]))
  )

  const isAdmin = currentUserRole === 'admin'

  async function handleAddNote() {
    if (!note.trim()) return
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch('/api/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [noteEndpointField]: contractId, type: 'note', content: note.trim() }),
      })
      const json = await res.json()
      if (!res.ok) { setSaveError(json.error ?? 'Erro ao salvar'); setSaving(false); return }
      setNote('')
      router.refresh()
    } catch {
      setSaveError('Erro de rede. Tente novamente.')
    }
    setSaving(false)
  }

  async function handleTogglePin(id: string) {
    setPinningId(id)
    const res = await fetch(`/api/activities/${id}/pin`, { method: 'POST' })
    const json = await res.json()
    if (res.ok) setLocalPins(p => ({ ...p, [id]: json.is_pinned }))
    setPinningId(null)
  }

  async function handleDelete(id: string) {
    if (!isAdmin || !confirm('Excluir esta nota permanentemente?')) return
    setDeletingId(id)
    await fetch(`/api/activities/${id}`, { method: 'DELETE' })
    router.refresh()
    setDeletingId(null)
  }

  const visible = events.filter(e => !isOpenCopilotTask(e))
  const pinned = visible.filter(e => localPins[e.id])
  const rest = visible.filter(e => !localPins[e.id])
  const sorted = [...pinned, ...rest]

  return (
    <div>
      {/* Campo de nota */}
      <div style={{ marginBottom: 24 }}>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder={notePlaceholder}
          rows={3}
          style={{
            width: '100%', padding: '10px 12px', fontSize: 13, borderRadius: 8,
            border: `0.5px solid ${saveError ? '#fca5a5' : '#d1d8e8'}`,
            outline: 'none', resize: 'vertical', fontFamily: 'inherit',
            color: '#1a1f36', boxSizing: 'border-box',
          }}
        />
        {saveError && (
          <p style={{ fontSize: 11, color: '#b91c1c', margin: '4px 0 0' }}>{saveError}</p>
        )}
        <button
          onClick={handleAddNote}
          disabled={saving || !note.trim()}
          style={{
            marginTop: 8, padding: '7px 16px', fontSize: 12, fontWeight: 600,
            borderRadius: 8, border: 'none', background: '#1B556B', color: '#fff',
            cursor: 'pointer', opacity: saving || !note.trim() ? 0.6 : 1,
          }}
        >
          {saving ? 'Salvando...' : '+ Adicionar nota'}
        </button>
      </div>

      {/* Timeline */}
      {sorted.length === 0 ? (
        <p style={{ fontSize: 12, color: '#b0b8c8', textAlign: 'center', padding: '32px 0' }}>
          Nenhum evento registrado ainda.
        </p>
      ) : (
        <div style={{ position: 'relative' }}>
          {/* Linha vertical */}
          <div style={{
            position: 'absolute', left: 14, top: 0, bottom: 0, width: 2,
            background: 'linear-gradient(to bottom, #e8edf5, #f1f3f8)', zIndex: 0,
          }} />

          {sorted.map(e => {
            const cfgKey = (e.type === 'client_decision' && (e.metadata?.outcome === 'recusado' || e.metadata?.outcome === 'declinada')) ||
              (e.type === 'proposal' && e.content?.includes('RECUSADA'))
              ? 'client_rejection'
              : e.metadata?.kind === 'renewal_alert' && e.metadata?.approval === 'sent'
              ? 'whatsapp_sent'
              : e.type
            const cfg = TYPE_CONFIG[cfgKey] ?? TYPE_CONFIG['note']
            const isPinned = !!localPins[e.id]
            const isNote = e.type === 'note'

            return (
              <div key={e.id} style={{ display: 'flex', gap: 14, paddingBottom: 20, position: 'relative', zIndex: 1 }}>
                {/* Ícone */}
                <div style={{
                  width: 30, height: 30, borderRadius: '50%',
                  background: isPinned ? '#fef3c7' : cfg.bg,
                  border: `2px solid ${isPinned ? '#f59e0b' : cfg.color}33`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, flexShrink: 0, zIndex: 2, boxShadow: '0 0 0 3px #fff',
                }}>
                  {isPinned ? '📌' : cfg.icon}
                </div>

                {/* Card */}
                <div style={{
                  flex: 1, background: isPinned ? '#fffbeb' : '#fff',
                  borderRadius: 10,
                  border: isPinned ? '1px solid #fde68a' : '0.5px solid #e8edf5',
                  padding: '10px 14px',
                  boxShadow: isPinned
                    ? '0 1px 4px rgba(245,158,11,0.1)'
                    : '0 1px 3px rgba(0,0,0,0.04)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <span style={{
                        fontSize: 11, fontWeight: 700, color: cfg.color,
                        textTransform: 'uppercase', letterSpacing: '0.5px',
                      }}>
                        {cfg.label}
                        {isPinned && (
                          <span style={{ marginLeft: 6, color: '#f59e0b' }}>· Fixada</span>
                        )}
                      </span>
                      {/* Badge da oportunidade — só em events vindos de contract_id */}
                      {e.opportunity_badge && (
                        <span style={{
                          display: 'inline-block', marginTop: 4,
                          padding: '2px 8px', borderRadius: 20, fontSize: 10,
                          fontWeight: 600, background: '#f1f3f8', color: '#52514e',
                          border: '0.5px solid #e8edf5',
                        }}>
                          🔗 {e.opportunity_badge}
                        </span>
                      )}
                      {e.content && (
                        <p style={{
                          fontSize: 13, color: '#1a1f36', margin: '4px 0 0',
                          lineHeight: 1.55, whiteSpace: 'pre-wrap',
                        }}>
                          {e.content}
                        </p>
                      )}
                      <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                        {e.profiles?.full_name && (
                          <span style={{ fontSize: 10, color: '#b0b8c8' }}>{e.profiles.full_name}</span>
                        )}
                        <span style={{ fontSize: 10, color: '#b0b8c8' }}>{fmtDate(e.created_at)}</span>
                      </div>
                    </div>

                    {/* Ações — só em notas */}
                    {isNote && (
                      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                        <button
                          onClick={() => handleTogglePin(e.id)}
                          disabled={pinningId === e.id}
                          title={isPinned ? 'Desfixar nota' : 'Fixar nota no topo'}
                          style={{
                            fontSize: 14, background: 'none', border: 'none',
                            cursor: 'pointer', padding: 2,
                            opacity: pinningId === e.id ? 0.4 : isPinned ? 1 : 0.35,
                            filter: isPinned ? 'none' : 'grayscale(1)',
                          }}
                        >
                          📌
                        </button>
                        {isAdmin && (
                          <button
                            onClick={() => handleDelete(e.id)}
                            disabled={deletingId === e.id}
                            title="Excluir nota"
                            style={{
                              fontSize: 12, background: 'none', border: 'none',
                              cursor: 'pointer', color: '#fca5a5', padding: 2,
                              opacity: deletingId === e.id ? 0.4 : 0.6,
                            }}
                          >
                            🗑️
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
