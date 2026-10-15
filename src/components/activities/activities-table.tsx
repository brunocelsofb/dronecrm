'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateActivityStatus, deleteActivity } from '@/lib/actions/activities'
import { CreateActivityModal } from './create-activity-modal'
import { RenewalSendButton } from './renewal-send-button'
import { SentMessageDialog } from './sent-message-dialog'
import { InternalEmailButton } from './internal-email-button'

type Activity = {
  id: string
  type: string
  activity_type?: string | null
  title?: string | null
  content: string
  status?: string | null
  activity_date?: string | null
  activity_time?: string | null
  duration_minutes?: number | null
  created_at: string
  user_id?: string | null
  assigned_to?: string | null
  completed?: boolean | null
  metadata?: Record<string, unknown> | null
}

type Profile = { id: string; full_name: string }

const TYPE_META: Record<string, { icon: string; label: string }> = {
  call:     { icon: '📞', label: 'Ligação' },
  meeting:  { icon: '📅', label: 'Reunião' },
  task:     { icon: '✅', label: 'Tarefa' },
  whatsapp: { icon: '💬', label: 'WhatsApp' },
  reminder: { icon: '🔔', label: 'Lembrete' },
  activity: { icon: '📝', label: 'Atividade' },
}

function fmtDate(date?: string | null, time?: string | null) {
  if (!date) return '—'
  const d = new Date(date + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  return time ? `${d} ${time.slice(0, 5)}` : d
}

function isOverdue(a: Activity) {
  if (a.status === 'done' || a.completed) return false
  if (!a.activity_date) return false
  return new Date(a.activity_date + 'T23:59:59') < new Date()
}

export function ActivitiesTable({
  activities,
  contractId,
  profiles,
  currentUserId,
}: {
  activities: Activity[]
  contractId: string
  profiles: Profile[]
  currentUserId: string
}) {
  const router = useRouter()
  const [tab, setTab] = useState<'planned' | 'done'>('planned')
  const [showModal, setShowModal] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [viewingSent, setViewingSent] = useState<Activity | null>(null)

  const profileById = new Map(profiles.map(p => [p.id, p.full_name]))

  const [localActivities, setLocalActivities] = useState(activities)

  function handleCreated(newActivity: any) {
    setLocalActivities(prev => [newActivity, ...prev])
  }

  const planned = localActivities.filter(a => a.status !== 'done' && !a.completed)
  const done    = localActivities.filter(a => a.status === 'done' || a.completed)
  const rows    = tab === 'planned' ? planned : done

  async function handleToggle(a: Activity) {
    setTogglingId(a.id)
    const next = (a.status === 'done' || a.completed) ? 'planned' : 'done'
    await updateActivityStatus(a.id, next)
    setLocalActivities(prev => prev.map(x =>
      x.id === a.id ? { ...x, status: next, completed: next === 'done' } : x
    ))
    setTogglingId(null)
  }

  async function handleDelete(id: string) {
    if (!confirm('Excluir esta atividade?')) return
    setDeletingId(id)
    await deleteActivity(id)
    setLocalActivities(prev => prev.filter(x => x.id !== id))
    setDeletingId(null)
  }

  const th: React.CSSProperties = {
    padding: '10px 12px', fontSize: 10, fontWeight: 700, color: '#8892a4',
    textTransform: 'uppercase', letterSpacing: '0.8px', textAlign: 'left',
    borderBottom: '0.5px solid #e8edf5', background: '#f8f9fb',
  }

  const td: React.CSSProperties = {
    padding: '12px 12px', fontSize: 12, color: '#1a1f36',
    borderBottom: '0.5px solid #f1f3f8', verticalAlign: 'top',
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, background: '#f1f3f8', borderRadius: 8, padding: 3 }}>
          {(['planned', 'done'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '5px 14px', fontSize: 12, fontWeight: 600, borderRadius: 6,
              border: 'none', cursor: 'pointer', transition: 'all 0.15s',
              background: tab === t ? '#fff' : 'transparent',
              color: tab === t ? '#1a1f36' : '#8892a4',
              boxShadow: tab === t ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
            }}>
              {t === 'planned' ? `Planejadas (${planned.length})` : `Concluídas (${done.length})`}
            </button>
          ))}
        </div>
        <button onClick={() => setShowModal(true)} style={{
          padding: '7px 14px', fontSize: 12, fontWeight: 600, borderRadius: 8,
          border: 'none', background: '#1B556B', color: '#fff', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          + Nova atividade
        </button>
      </div>

      {/* Tabela */}
      {rows.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 0', color: '#b0b8c8', fontSize: 13 }}>
          {tab === 'planned' ? 'Nenhuma atividade planejada.' : 'Nenhuma atividade concluída.'}
        </div>
      ) : (
        <div style={{ borderRadius: 10, border: '0.5px solid #e8edf5', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...th, width: 40 }}></th>
                <th style={th}>Data</th>
                <th style={th}>Dur.</th>
                <th style={th}>Tipo</th>
                <th style={th}>Título</th>
                <th style={th}>Resp.</th>
                <th style={{ ...th, width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(a => {
                const meta = TYPE_META[a.activity_type ?? a.type] ?? TYPE_META['activity']
                const overdue = isOverdue(a)
                const done = a.status === 'done' || !!a.completed
                const respId = a.assigned_to ?? a.user_id
                const resp = respId ? profileById.get(respId) : null
                const rowBg = done ? '#fafafa' : overdue ? '#fef2f2' : '#fff'
                const md = (a.metadata ?? {}) as Record<string, unknown>
                const isRenewalKind = md.kind === 'renewal_alert' || md.kind === 'renewal_confirmation'
                const renewalPending = isRenewalKind && md.approval === 'pending'
                  && typeof md.target_phone === 'string' && typeof md.draft_message === 'string'
                const renewalSent = isRenewalKind && md.approval === 'sent'
                const isInternalKind = md.kind === 'internal_notice' || md.kind === 'internal_impl_report'
                const internalPending = isInternalKind && md.approval === 'pending' && typeof md.draft_message === 'string'
                const internalSent = isInternalKind && md.approval === 'sent'
                const anySent = renewalSent || internalSent

                return (
                  <tr key={a.id} style={{ background: rowBg }}>
                    {/* Checkbox */}
                    <td style={{ ...td, textAlign: 'center' }}>
                      <button
                        onClick={() => handleToggle(a)}
                        disabled={togglingId === a.id}
                        style={{
                          width: 20, height: 20, borderRadius: 4, border: `2px solid ${done ? '#1f8c7d' : '#d1d8e8'}`,
                          background: done ? '#1f8c7d' : '#fff', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          opacity: togglingId === a.id ? 0.5 : 1,
                        }}>
                        {done && <span style={{ color: '#fff', fontSize: 11, lineHeight: 1 }}>✓</span>}
                      </button>
                    </td>

                    {/* Data */}
                    <td style={td}>
                      <span style={{ color: overdue ? '#8e4550' : '#52514e', fontWeight: overdue ? 600 : 400 }}>
                        {fmtDate(a.activity_date, a.activity_time)}
                      </span>
                      {overdue && <div style={{ fontSize: 9, color: '#8e4550', fontWeight: 600 }}>ATRASADA</div>}
                    </td>

                    {/* Duração */}
                    <td style={{ ...td, color: '#8892a4' }}>
                      {a.duration_minutes ? `${a.duration_minutes}min` : '—'}
                    </td>

                    {/* Tipo */}
                    <td style={td}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                        <span>{meta.icon}</span>
                        <span style={{ color: '#52514e' }}>{meta.label}</span>
                      </span>
                    </td>

                    {/* Título + descrição */}
                    <td style={td}>
                      {anySent ? (
                        <button
                          type="button"
                          onClick={() => setViewingSent(a)}
                          title="Ver a mensagem enviada"
                          style={{ margin: 0, padding: 0, border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', fontWeight: 500, fontSize: 'inherit', color: '#1B556B', textDecoration: 'underline' }}
                        >
                          {a.title || meta.label}
                        </button>
                      ) : (
                        <p style={{ margin: 0, fontWeight: 500, textDecoration: done ? 'line-through' : 'none', color: done ? '#b0b8c8' : '#1a1f36' }}>
                          {a.title || meta.label}
                        </p>
                      )}
                      {renewalPending && (
                        <span style={{ display: 'inline-block', marginTop: 3, fontSize: 10, padding: '1px 7px', borderRadius: 20, background: '#fff7ed', color: '#c2410c', fontWeight: 500 }}>Aguardando envio ao cliente</span>
                      )}
                      {renewalPending && typeof md.last_error === 'string' && md.last_error && (
                        <p role="alert" style={{ margin: '4px 0 0', fontSize: 11, color: '#8e4550', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '4px 8px', lineHeight: 1.4 }}>
                          ⚠ Última tentativa falhou
                          {typeof md.last_error_at === 'string'
                            ? ` (${new Date(md.last_error_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })})`
                            : ''}
                          : {md.last_error}
                        </p>
                      )}
                      {renewalSent && (
                        <span style={{ display: 'inline-block', marginTop: 3, fontSize: 10, padding: '1px 7px', borderRadius: 20, background: '#e3f5f1', color: '#1f8c7d', fontWeight: 500 }}>Enviado ao cliente</span>
                      )}
                      {internalPending && (
                        <span style={{ display: 'inline-block', marginTop: 3, fontSize: 10, padding: '1px 7px', borderRadius: 20, background: '#eef6fb', color: '#1B556B', fontWeight: 500 }}>E-mail interno aguardando envio</span>
                      )}
                      {internalPending && typeof md.last_error === 'string' && md.last_error && (
                        <p role="alert" style={{ margin: '4px 0 0', fontSize: 11, color: '#8e4550', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '4px 8px', lineHeight: 1.4 }}>
                          ⚠ Última tentativa falhou: {md.last_error}
                        </p>
                      )}
                      {internalSent && (
                        <span style={{ display: 'inline-block', marginTop: 3, fontSize: 10, padding: '1px 7px', borderRadius: 20, background: '#e3f5f1', color: '#1f8c7d', fontWeight: 500 }}>Enviado ao time interno</span>
                      )}
                      {a.content && (
                        <p style={{ margin: '2px 0 0', fontSize: 11, color: '#8892a4', lineHeight: 1.4 }}>
                          {a.content.slice(0, 120)}{a.content.length > 120 ? '…' : ''}
                        </p>
                      )}
                    </td>

                    {/* Responsável */}
                    <td style={{ ...td, fontSize: 11, color: '#8892a4' }}>
                      {resp ?? '—'}
                    </td>

                    {/* Ações */}
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {renewalPending && !done && contractId && (
                        <span style={{ marginRight: 6 }}>
                          <RenewalSendButton
                            activityId={a.id}
                            contractId={contractId}
                            draft={md.draft_message as string}
                            phone={md.target_phone as string}
                            email={typeof md.target_email === 'string' ? md.target_email : null}
                            draftSubject={typeof md.draft_subject === 'string' ? md.draft_subject : null}
                            contactName={typeof md.contact_name === 'string' ? md.contact_name : null}
                            onSent={r => setLocalActivities(prev => prev.map(x => x.id === a.id
                              ? { ...x, status: 'done', completed: true, title: r.title ?? x.title, content: r.content ?? x.content,
                                  metadata: r.metadata ?? { ...(x.metadata ?? {}), approval: 'sent' } }
                              : x))}
                            onFailed={err => setLocalActivities(prev => prev.map(x => x.id === a.id
                              ? { ...x, metadata: { ...(x.metadata ?? {}), last_error: err.replace(/^Nada foi enviado — /, ''), last_error_at: new Date().toISOString() } }
                              : x))}
                          />
                        </span>
                      )}
                      {internalPending && !done && (
                        <span style={{ marginRight: 6 }}>
                          <InternalEmailButton
                            activityId={a.id}
                            draft={md.draft_message as string}
                            draftSubject={typeof md.draft_subject === 'string' ? md.draft_subject : null}
                            draftTo={Array.isArray(md.draft_to) ? (md.draft_to as string[]) : []}
                            draftCc={Array.isArray(md.draft_cc) ? (md.draft_cc as string[]) : []}
                            onSent={r => setLocalActivities(prev => prev.map(x => x.id === a.id
                              ? { ...x, status: 'done', completed: true, title: r.title ?? x.title, content: r.content ?? x.content,
                                  metadata: r.metadata ?? { ...(x.metadata ?? {}), approval: 'sent' } }
                              : x))}
                            onFailed={err => setLocalActivities(prev => prev.map(x => x.id === a.id
                              ? { ...x, metadata: { ...(x.metadata ?? {}), last_error: err, last_error_at: new Date().toISOString() } }
                              : x))}
                          />
                        </span>
                      )}
                      <button
                        onClick={() => handleDelete(a.id)}
                        disabled={deletingId === a.id}
                        style={{ fontSize: 14, background: 'none', border: 'none', cursor: 'pointer', color: '#dcadb3', opacity: deletingId === a.id ? 0.5 : 0.7 }}
                        title="Excluir">
                        🗑️
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <CreateActivityModal
          contractId={contractId}
          onClose={() => setShowModal(false)}
          onCreated={handleCreated}
          profiles={profiles}
          currentUserId={currentUserId}
        />
      )}
      {viewingSent && (
        <SentMessageDialog
          title={viewingSent.title ?? 'Aviso de renovação enviado'}
          metadata={(viewingSent.metadata ?? {}) as Record<string, unknown>}
          senderName={(() => {
            const id = (viewingSent.metadata as Record<string, unknown> | null)?.sent_by
            return typeof id === 'string' ? profileById.get(id) ?? null : null
          })()}
          onClose={() => setViewingSent(null)}
        />
      )}
    </div>
  )
}
