'use client'

import { fmtPct, fmtNum1 } from '@/lib/format'
import { useState, useEffect } from 'react'
import { completeImplementationTask, assignImplementationTask, addTaskComment, updateImplementationOwner } from '@/lib/actions/implementation'
import { StartImplementationModal } from './start-implementation-modal'

type Profile = { id: string; full_name: string; job_title?: string | null }
type Comment = { id: string; text: string; is_completion_note: boolean; created_at: string; profiles: Profile; delegated: Profile | null }
type Task = {
  id: string; title: string; reference_doc: string | null
  start_week: number; end_week: number; sort_order: number
  is_completed: boolean; completed_at: string | null; completion_note: string | null
  assigned_to: string | null
  profiles: Profile | null
  completed_by_profile: Profile | null
  task_comments: Comment[]
}
type Schedule = {
  id: string; start_date: string; status: string; owner_id: string | null
  owner: Profile | null
  implementation_templates: { name: string } | null
  implementation_tasks: Task[]
}
type Template = { id: string; name: string; trigger_tags: string[]; description: string | null }

function weekLabel(startDate: string, week: number) {
  const d = new Date(startDate)
  d.setDate(d.getDate() + (week - 1) * 7)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

function OwnerEditor({ scheduleId, owner, users }: { scheduleId: string; owner: Profile | null; users: Profile[] }) {
  const [editing, setEditing] = useState(false)
  const [current, setCurrent] = useState(owner)
  const [saving, setSaving] = useState(false)

  async function handleChange(userId: string) {
    setSaving(true)
    await updateImplementationOwner(scheduleId, userId)
    const found = users.find(u => u.id === userId) ?? null
    setCurrent(found)
    setSaving(false)
    setEditing(false)
  }

  if (editing) return (
    <div className="flex items-center gap-2">
      <select autoFocus defaultValue={current?.id ?? ''}
        onChange={e => handleChange(e.target.value)}
        disabled={saving}
        className="rounded-md border border-[#1B556B] px-2 py-1 text-xs focus:outline-none">
        {users.map(u => <option key={u.id} value={u.id}>{u.full_name}{u.job_title ? ` · ${u.job_title}` : ''}</option>)}
      </select>
      <button onClick={() => setEditing(false)} className="text-xs text-gray-400">✕</button>
    </div>
  )

  return (
    <button onClick={() => setEditing(true)}
      className="flex items-center gap-1 text-xs text-gray-500 hover:text-[#1B556B] group">
      👤 <span className="font-medium">{current?.full_name ?? 'Sem dono'}</span>
      <span className="opacity-0 group-hover:opacity-100 text-[10px]">✏️</span>
    </button>
  )
}

function CompleteModal({ task, onClose, onDone }: { task: Task; onClose: () => void; onDone: (note: string) => void }) {
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  async function handle() {
    if (!note.trim()) return
    setSaving(true)
    await completeImplementationTask(task.id, note)
    setSaving(false)
    onDone(note)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl p-6 space-y-4">
        <h3 className="text-base font-bold text-[#1B556B]">✅ Concluir Fase</h3>
        <p className="text-sm text-gray-600 font-medium">{task.title}</p>
        <textarea value={note} onChange={e => setNote(e.target.value)} rows={4}
          placeholder="Descreva como foi a execução desta fase..."
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#1B556B] focus:outline-none resize-none" />
        <div className="flex gap-3">
          <button onClick={handle} disabled={!note.trim() || saving}
            className="flex-1 rounded-lg bg-green-600 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50">
            {saving ? 'Salvando...' : '✅ Confirmar Conclusão'}
          </button>
          <button onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600">Cancelar</button>
        </div>
      </div>
    </div>
  )
}

function CommentsPanel({ task, users, onClose, onCommentAdded }: {
  task: Task; users: Profile[]; onClose: () => void; onCommentAdded?: (c: Comment) => void
}) {
  const [text, setText] = useState('')
  const [delegatedTo, setDelegatedTo] = useState('')
  const [saving, setSaving] = useState(false)
  const [localComments, setLocalComments] = useState(task.task_comments)

  // Sincroniza com dados frescos
  useEffect(() => { setLocalComments(task.task_comments) }, [task.task_comments])

  async function handleAdd() {
    if (!text.trim()) return
    setSaving(true)
    await addTaskComment(task.id, text, delegatedTo || null)
    const newComment: any = {
      id: `opt-${Date.now()}`,
      text,
      is_completion_note: false,
      created_at: new Date().toISOString(),
      profiles: null,
      delegated: null,
      delegated_to: delegatedTo || null,
    }
    setLocalComments(prev => [...prev, newComment])
    onCommentAdded?.(newComment)
    setSaving(false)
    setText(''); setDelegatedTo('')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/30 p-4">
      <div className="w-full max-w-sm h-full max-h-[90vh] flex flex-col rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <p className="text-sm font-bold text-[#1B556B]">💬 Comentários</p>
            <p className="text-xs text-gray-400 truncate max-w-[220px]">{task.title}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {localComments.length === 0 && <p className="text-xs text-gray-400 text-center py-4">Sem comentários ainda.</p>}
          {localComments.map(c => (
            <div key={c.id} className={`rounded-lg p-3 text-sm ${c.is_completion_note ? 'bg-green-50 border border-green-200' : 'bg-gray-50'}`}>
              {c.is_completion_note && <p className="text-[10px] font-bold text-green-700 mb-1">📌 Nota de Conclusão</p>}
              {c.delegated && (
                <p className="text-[10px] font-bold text-orange-600 mb-1">🔔 Ação solicitada para @{c.delegated.full_name}{c.delegated.job_title ? `, ${c.delegated.job_title}` : ''}</p>
              )}
              <p className="text-gray-800">{c.text}</p>
              <p className="text-[10px] text-gray-400 mt-1">{c.profiles?.full_name} · {new Date(c.created_at).toLocaleString('pt-BR')}</p>
            </div>
          ))}
        </div>
        <div className="border-t p-3 space-y-2">
          <select value={delegatedTo} onChange={e => setDelegatedTo(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-gray-600 focus:outline-none">
            <option value="">Delegar ação para... (opcional)</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.full_name}{u.job_title ? ` · ${u.job_title}` : ''}</option>)}
          </select>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={2}
            placeholder="Adicionar comentário..."
            className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm resize-none focus:border-[#1B556B] focus:outline-none" />
          <button onClick={handleAdd} disabled={!text.trim() || saving}
            className="w-full rounded-lg bg-[#1B556B] py-1.5 text-sm font-semibold text-white hover:bg-[#164659] disabled:opacity-50">
            {saving ? 'Enviando...' : 'Enviar'}
          </button>
        </div>
      </div>
    </div>
  )
}

function TaskCard({ task, users, startDate, isOwnerOrAdmin, hasPendingBefore }: {
  task: Task; users: Profile[]; startDate: string; isOwnerOrAdmin: boolean; hasPendingBefore: boolean
}) {
  const [completeOpen, setCompleteOpen] = useState(false)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [localTask, setLocalTask] = useState(task)
  const [localComments, setLocalComments] = useState(task.task_comments)

  // Sincroniza com dados frescos do servidor (após router.refresh)
  useEffect(() => { setLocalTask(task) }, [task])
  useEffect(() => { setLocalComments(task.task_comments) }, [task.task_comments])

  const weekStart = weekLabel(startDate, task.start_week)
  const weekEnd = task.end_week > task.start_week ? weekLabel(startDate, task.end_week) : null

  async function handleAssign(e: React.ChangeEvent<HTMLSelectElement>) {
    const uid = e.target.value || null
    await assignImplementationTask(task.id, uid)
    setLocalTask(prev => ({ ...prev, assigned_to: uid }))
  }

  return (
    <>
      <div className={`rounded-xl border p-4 transition-all ${
        localTask.is_completed
          ? 'bg-green-50 border-green-200'
          : 'bg-white border-gray-200 hover:border-[#1B556B]/30'
      }`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-[10px] font-mono text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                Sem {task.start_week}{weekEnd ? `→${task.end_week}` : ''}
                {' '}({weekStart}{weekEnd ? ` – ${weekEnd}` : ''})
              </span>
              {localTask.is_completed && (
                <span className="text-[10px] font-semibold text-green-700 bg-green-100 px-1.5 py-0.5 rounded-full">✅ Concluída</span>
              )}
            </div>
            <p className={`text-sm font-medium ${localTask.is_completed ? 'text-green-800 line-through' : 'text-gray-900'}`}>
              {task.title}
            </p>
            {task.reference_doc && (
              <p className="text-[11px] text-gray-400 mt-0.5">📄 {task.reference_doc}</p>
            )}
            {localTask.is_completed && localTask.completion_note && (
              <div className="mt-2 rounded-lg bg-green-100 px-3 py-2 text-xs text-green-800">
                <p className="font-semibold mb-0.5">Nota de conclusão:</p>
                <p>{localTask.completion_note}</p>
                {task.completed_by_profile && (
                  <p className="text-green-600 mt-0.5">
                    {task.completed_by_profile.full_name} · {new Date(localTask.completed_at!).toLocaleDateString('pt-BR')}
                  </p>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button onClick={() => setCommentsOpen(true)}
              className="relative rounded-md border border-gray-200 p-1.5 text-gray-400 hover:bg-gray-50 hover:text-[#1B556B]">
              💬
              {localComments.length > 0 && (
                <span className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-[#1B556B] text-[8px] text-white flex items-center justify-center">
                  {localComments.length}
                </span>
              )}
            </button>
            {!localTask.is_completed && (() => {
              const disabled = !isOwnerOrAdmin || hasPendingBefore
              const title = !isOwnerOrAdmin
                ? 'Apenas o dono da implantação pode concluir'
                : hasPendingBefore
                ? 'Conclua as fases anteriores primeiro'
                : undefined
              return (
                <button onClick={() => !disabled && setCompleteOpen(true)} disabled={disabled} title={title}
                  className={`rounded-md border px-2 py-1.5 text-xs font-semibold ${disabled ? 'border-gray-200 text-gray-300 cursor-not-allowed' : 'border-green-300 text-green-700 hover:bg-green-50'}`}>
                  ✓ Concluir
                </button>
              )
            })()}
          </div>
        </div>
        <div className="mt-3">
          <select value={localTask.assigned_to ?? ''} onChange={handleAssign}
            className="w-full rounded-md border border-gray-200 px-2 py-1.5 text-xs text-gray-600 focus:border-[#1B556B] focus:outline-none bg-white">
            <option value="">👤 Sem responsável</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.full_name}{u.job_title ? ` · ${u.job_title}` : ''}</option>)}
          </select>
        </div>
      </div>

      {completeOpen && (
        <CompleteModal task={localTask} onClose={() => setCompleteOpen(false)}
          onDone={(note) => {
            setLocalTask(prev => ({
              ...prev,
              is_completed: true,
              completed_at: new Date().toISOString(),
              completion_note: note,
            }))
          }} />
      )}
      {commentsOpen && (
        <CommentsPanel
          task={{ ...localTask, task_comments: localComments }}
          users={users}
          onClose={() => setCommentsOpen(false)}
          onCommentAdded={(c) => setLocalComments(prev => [...prev, c])}
        />
      )}
    </>
  )
}

export function ImplementationTab({
  contractId, contractTags, schedule, templates, users, currentUserId, currentUserRole,
}: {
  contractId: string; contractTags: string[]; schedule: Schedule | null; templates: Template[]
  users: Profile[]; currentUserId: string; currentUserRole?: string
}) {
  const [showStart, setShowStart] = useState(false)

  if (!schedule) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-4xl mb-3">🚀</p>
        <h3 className="text-lg font-semibold text-gray-900 mb-1">Implantação não iniciada</h3>
        <p className="text-sm text-gray-500 mb-6 max-w-sm">Gere o cronograma de implantação a partir de um template configurado.</p>
        <button onClick={() => setShowStart(true)}
          className="rounded-lg bg-[#1B556B] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#164659]">
          🚀 Iniciar Implantação
        </button>
        {showStart && (
          <StartImplementationModal contractId={contractId} contractTags={contractTags}
            templates={templates} onClose={() => setShowStart(false)} />
        )}
      </div>
    )
  }

  const isOwnerOrAdmin = currentUserRole === 'admin' || schedule?.owner_id === currentUserId

  const sortedTasks = [...schedule.implementation_tasks].sort((a, b) => a.sort_order - b.sort_order)

  // Agrupa tarefas por semana de início
  const weeks = new Map<number, Task[]>()
  for (const t of sortedTasks) {
    if (!weeks.has(t.start_week)) weeks.set(t.start_week, [])
    weeks.get(t.start_week)!.push(t)
  }

  const totalTasks = schedule.implementation_tasks.length
  const doneTasks = schedule.implementation_tasks.filter(t => t.is_completed).length
  const progress = totalTasks ? (doneTasks / totalTasks) * 100 : 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-sm font-bold text-[#1B556B]">
              {schedule.implementation_templates?.name ?? 'Cronograma de Implantação'}
            </h3>
            <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-2">
              Início: {new Date(schedule.start_date + 'T12:00:00').toLocaleDateString('pt-BR')} · {doneTasks}/{totalTasks} fases
              <OwnerEditor scheduleId={schedule.id} owner={schedule.owner} users={users} />
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-32">
              <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
                <div className="h-full rounded-full bg-green-500 transition-all" style={{ width: `${progress}%` }} />
              </div>
              <p className="text-[10px] text-gray-400 text-center mt-0.5">{fmtPct(progress)} concluído</p>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              schedule.status === 'concluido' ? 'bg-green-100 text-green-700' :
              schedule.status === 'suspenso' ? 'bg-red-100 text-red-700' :
              'bg-blue-100 text-blue-700'
            }`}>
              {schedule.status === 'em_andamento' ? '🔄 Em andamento' : schedule.status === 'concluido' ? '✅ Concluído' : '⏸ Suspenso'}
            </span>
          </div>
        </div>
      </div>

      {/* Timeline por semana */}
      <div className="space-y-4">
        {Array.from(weeks.entries())
          .sort(([a], [b]) => a - b)
          .filter(([, tasks]) => tasks.length > 0)
          .map(([week, tasks]) => (
            <div key={week}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-bold text-[#1B556B] bg-[#1B556B]/10 px-2 py-0.5 rounded-full">
                  {week}ª semana — {weekLabel(schedule.start_date, week)}
                </span>
                <div className="flex-1 h-px bg-gray-200" />
              </div>
              <div className="space-y-2 pl-2">
                {tasks.map(t => {
                  const taskIndex = sortedTasks.findIndex(st => st.id === t.id)
                  const hasPendingBefore = sortedTasks.slice(0, taskIndex).some(st => !st.is_completed)
                  return (
                    <TaskCard key={t.id} task={t} users={users} startDate={schedule.start_date}
                      isOwnerOrAdmin={isOwnerOrAdmin} hasPendingBefore={hasPendingBefore} />
                  )
                })}
              </div>
            </div>
          ))}
      </div>
    </div>
  )
}
