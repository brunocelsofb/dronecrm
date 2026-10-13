'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { CreateActivityModal } from './create-activity-modal'
import { updateActivityStatus, deleteActivity } from '@/lib/actions/activities'
import { ACTIVITY_TYPE_ICON } from '@/lib/utils/activity-types'
import { RenewalSendButton } from './renewal-send-button'

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
  is_pinned?: boolean | null
  metadata?: Record<string, unknown> | null
}

type Profile = { id: string; full_name: string }

export function ActivityFeed({
  activities,
  contractId,
  companyId,
  pipelineRunId,
  profiles,
  currentUserId,
}: {
  activities: Activity[]
  contractId?: string | null
  companyId?: string | null
  pipelineRunId?: string | null
  profiles: Profile[]
  currentUserId: string
}) {
  const router = useRouter()
  const [showModal, setShowModal] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const profileById = new Map(profiles.map(p => [p.id, p.full_name]))

  async function handleToggleDone(id: string, current: string | null) {
    const next = current === 'done' ? 'planned' : 'done'
    await updateActivityStatus(id, next)
    router.refresh()
  }

  async function handleDelete(id: string) {
    if (!confirm('Excluir esta atividade?')) return
    setDeletingId(id)
    const result = await deleteActivity(id)
    setDeletingId(null)
    if (result?.error) {
      alert(`Erro ao excluir: ${result.error}`)
      return
    }
    router.refresh()
  }

  const isSystem = (a: Activity) =>
    ['stage_change', 'pipeline_change', 'automation_triggered', 'system', 'transfer'].includes(a.type)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Botão de nova atividade */}
      <div style={{ marginBottom: 16 }}>
        <button onClick={() => setShowModal(true)}
          style={{ padding: '8px 16px', fontSize: 12, fontWeight: 500, borderRadius: 8, border: '0.5px solid #1a1f36', background: '#fff', color: '#1a1f36', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 14 }}>+</span> Nova atividade
        </button>
      </div>

      {/* Feed */}
      {activities.length === 0 && (
        <p style={{ fontSize: 12, color: '#b0b8c8', textAlign: 'center', padding: '24px 0' }}>Nenhuma atividade registrada ainda.</p>
      )}
      {activities.map(a => {
        const icon = ACTIVITY_TYPE_ICON[a.activity_type ?? a.type] ?? '📝'
        const authorId = a.assigned_to ?? a.user_id
        const author = authorId ? profileById.get(authorId) : null
        const isSystemEvent = isSystem(a)
        const isDone = a.status === 'done'
        const isPlanned = a.status === 'planned'
        const meta = (a.metadata ?? {}) as Record<string, unknown>
        const isRenewalAlert = meta.kind === 'renewal_alert'
        const renewalPending = isRenewalAlert && meta.approval === 'pending'
          && typeof meta.target_phone === 'string' && typeof meta.draft_message === 'string'
        const renewalSent = isRenewalAlert && meta.approval === 'sent'

        return (
          <div key={a.id} style={{ display: 'flex', gap: 10, paddingBottom: 14, marginBottom: 14, borderBottom: '0.5px solid #f1f3f8' }}>
            {/* Ícone */}
            <div style={{ width: 30, height: 30, borderRadius: '50%', background: isSystemEvent ? '#f1f3f8' : isPlanned ? '#eef3ff' : '#eaf5ee', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>
              {icon}
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              {/* Título e badge */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  {a.title && <span style={{ fontSize: 13, fontWeight: 500, color: '#1a1f36' }}>{a.title}</span>}
                  {isPlanned && (
                    <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20, background: '#eef3ff', color: '#3b5bdb', fontWeight: 500 }}>Planejada</span>
                  )}
                  {renewalPending && (
                    <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20, background: '#fff7ed', color: '#c2410c', fontWeight: 500 }}>Aguardando envio</span>
                  )}
                  {renewalSent && (
                    <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 20, background: '#eaf5ee', color: '#1a7c3e', fontWeight: 500 }}>Enviado ao cliente</span>
                  )}
                </div>
                {!isSystemEvent && (
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    {renewalPending && isPlanned && contractId && (
                      <RenewalSendButton
                        activityId={a.id}
                        contractId={contractId}
                        draft={meta.draft_message as string}
                        phone={meta.target_phone as string}
                        email={typeof meta.target_email === 'string' ? meta.target_email : null}
                        draftSubject={typeof meta.draft_subject === 'string' ? meta.draft_subject : null}
                        contactName={typeof meta.contact_name === 'string' ? meta.contact_name : null}
                      />
                    )}
                    {isPlanned && (
                      <button onClick={() => handleToggleDone(a.id, a.status ?? null)}
                        style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, border: '0.5px solid #1a7c3e', background: '#eaf5ee', color: '#1a7c3e', cursor: 'pointer' }}>
                        Marcar concluída
                      </button>
                    )}
                    <button onClick={() => handleDelete(a.id)} disabled={deletingId === a.id}
                      style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, border: '0.5px solid #fca5a5', background: '#fff', color: '#b91c1c', cursor: 'pointer' }}>
                      {deletingId === a.id ? '...' : 'Excluir'}
                    </button>
                  </div>
                )}
              </div>

              {/* Conteúdo */}
              {a.content && (
                <p style={{ fontSize: 12, color: '#52514e', marginTop: 3, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{a.content}</p>
              )}

              {/* Meta */}
              <div style={{ display: 'flex', gap: 12, marginTop: 5, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10, color: '#b0b8c8' }}>
                  {a.activity_date
                    ? new Date(a.activity_date + 'T12:00:00').toLocaleDateString('pt-BR')
                    : new Date(a.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  {a.activity_time && ` · ${a.activity_time.slice(0, 5)}`}
                  {a.duration_minutes && ` · ${a.duration_minutes}min`}
                </span>
                {author && <span style={{ fontSize: 10, color: '#b0b8c8' }}>{author}</span>}
              </div>
            </div>
          </div>
        )
      })}

      {showModal && (
        <CreateActivityModal
          onClose={() => setShowModal(false)}
          contractId={contractId}
          companyId={companyId}
          pipelineRunId={pipelineRunId}
          profiles={profiles}
          currentUserId={currentUserId}
        />
      )}
    </div>
  )
}
