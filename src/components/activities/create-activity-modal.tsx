'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createActivity } from '@/lib/actions/activities'
import { ACTIVITY_TYPE_LABELS, type ActivityType } from '@/lib/utils/activity-types'

const ACTIVITY_TYPES = Object.entries(ACTIVITY_TYPE_LABELS) as [ActivityType, string][]
const REMINDER_OPTIONS = [
  { value: null, label: 'Sem lembrete' },
  { value: 15,   label: '15 min antes' },
  { value: 30,   label: '30 min antes' },
  { value: 60,   label: '1h antes' },
  { value: 1440, label: '1 dia antes' },
]

type Profile = { id: string; full_name: string }

export function CreateActivityModal({ onClose, onCreated, contractId, companyId, pipelineRunId, profiles, currentUserId }: {
  onClose: () => void
  onCreated?: (activity: any) => void
  contractId?: string | null
  companyId?: string | null
  pipelineRunId?: string | null
  profiles: Profile[]
  currentUserId: string
}) {
  const router = useRouter()
  const [type, setType] = useState<ActivityType>('call')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [status, setStatus] = useState<'planned' | 'done'>('done')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [time, setTime] = useState(new Date().toTimeString().slice(0, 5))
  const [duration, setDuration] = useState<number | null>(30)
  const [reminder, setReminder] = useState<number | null>(null)
  const [assignedTo, setAssignedTo] = useState(currentUserId)
  const [participants, setParticipants] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const inp: React.CSSProperties = { width: '100%', padding: '7px 10px', fontSize: 12, borderRadius: 8, border: '0.5px solid #d1d8e8', background: '#f8f9fb', color: '#1a1f36', outline: 'none' }
  const lbl: React.CSSProperties = { display: 'block', fontSize: 10, color: '#8892a4', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 4 }

  async function handleSave() {
    if (!title.trim() && !content.trim()) { setError('Preencha o título ou a descrição.'); return }
    setBusy(true); setError(null)
    try {
      const result = await createActivity({
        contractId, companyId, pipelineRunId, title, content,
        activityType: type, status, activityDate: date || null,
        activityTime: time || null, durationMinutes: duration,
        reminderMinutes: reminder, assignedTo, participants,
      })
      if (result.error) { setError(result.error); setBusy(false); return }
      // Chama callback com a nova atividade para atualização imediata da lista
      if (onCreated) {
        onCreated({
          id: result.id ?? crypto.randomUUID(),
          type, activity_type: type, title, content, status,
          activity_date: date || null, activity_time: time || null,
          duration_minutes: duration, created_at: new Date().toISOString(),
          user_id: currentUserId, assigned_to: assignedTo,
          completed: status === 'done',
        })
      } else {
        router.refresh()
      }
      onClose()
    } catch (e) {
      setError(`Erro inesperado: ${e instanceof Error ? e.message : 'Tente novamente.'}`)
    }
    setBusy(false)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 8px 40px rgba(0,0,0,0.18)' }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px', borderBottom: '0.5px solid #e8edf5' }}>
          <p style={{ fontSize: 15, fontWeight: 500, color: '#1a1f36', margin: 0 }}>Nova Atividade</p>
          <button onClick={onClose} style={{ fontSize: 18, background: 'none', border: 'none', cursor: 'pointer', color: '#8892a4' }}>✕</button>
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12 }}>
            <div>
              <label style={lbl}>Tipo</label>
              <select value={type} onChange={e => setType(e.target.value as ActivityType)} style={inp}>
                {ACTIVITY_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Status</label>
              <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '0.5px solid #d1d8e8', marginTop: 4 }}>
                {(['planned', 'done'] as const).map(s => (
                  <button key={s} onClick={() => setStatus(s)} style={{ padding: '7px 12px', fontSize: 11, border: 'none', cursor: 'pointer', fontWeight: status === s ? 500 : 400, background: status === s ? (s === 'done' ? '#1f8c7d' : '#524e9c') : '#fff', color: status === s ? '#fff' : '#8892a4' }}>
                    {s === 'planned' ? 'Planejada' : 'Concluída'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label style={lbl}>Título</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex: Ligação de follow-up, Visita técnica..." style={inp} />
          </div>

          <div>
            <label style={lbl}>Descrição</label>
            <textarea value={content} onChange={e => setContent(e.target.value)} rows={3} placeholder="Detalhes, observações, resultado..." style={{ ...inp, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 120px', gap: 10 }}>
            <div><label style={lbl}>Data</label><input type="date" value={date} onChange={e => setDate(e.target.value)} style={inp} /></div>
            <div><label style={lbl}>Hora</label><input type="time" value={time} onChange={e => setTime(e.target.value)} style={inp} /></div>
            <div><label style={lbl}>Duração (min)</label><input type="number" value={duration ?? ''} onChange={e => setDuration(e.target.value ? Number(e.target.value) : null)} min={0} placeholder="30" style={inp} /></div>
          </div>

          <div>
            <label style={lbl}>Lembrete</label>
            <select value={reminder ?? ''} onChange={e => setReminder(e.target.value ? Number(e.target.value) : null)} style={inp}>
              {REMINDER_OPTIONS.map(o => <option key={String(o.value)} value={o.value ?? ''}>{o.label}</option>)}
            </select>
          </div>

          <div>
            <label style={lbl}>Responsável</label>
            <select value={assignedTo} onChange={e => setAssignedTo(e.target.value)} style={inp}>
              {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          </div>

          {profiles.length > 1 && (
            <div>
              <label style={lbl}>Envolvidos</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                {profiles.filter(p => p.id !== assignedTo).map(p => {
                  const sel = participants.includes(p.id)
                  return (
                    <button key={p.id} type="button" onClick={() => setParticipants(prev => sel ? prev.filter(x => x !== p.id) : [...prev, p.id])}
                      style={{ padding: '4px 10px', fontSize: 11, borderRadius: 20, cursor: 'pointer', border: '0.5px solid', background: sel ? '#1a1f36' : '#fff', color: sel ? '#fff' : '#52514e', borderColor: sel ? '#1a1f36' : '#d1d8e8' }}>
                      {p.full_name}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {error && <p style={{ fontSize: 12, color: '#8e4550' }}>{error}</p>}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 4 }}>
            <button onClick={onClose} style={{ padding: '8px 16px', fontSize: 12, borderRadius: 8, border: '0.5px solid #d1d8e8', background: '#fff', color: '#52514e', cursor: 'pointer' }}>Cancelar</button>
            <button onClick={handleSave} disabled={busy} style={{ padding: '8px 20px', fontSize: 12, fontWeight: 500, borderRadius: 8, border: 'none', background: '#1a1f36', color: '#fff', cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1 }}>
              {busy ? 'Salvando...' : 'Salvar atividade'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
