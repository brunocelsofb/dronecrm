'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateLeadStatus, assignLead, addLeadNote, deleteLead } from '@/lib/actions/leads'
import { ConvertLeadModal } from './convert-lead-modal'

type UserOption     = { id: string; full_name: string }
type PipelineOption = { id: string; name: string }
type StageOption    = { id: string; name: string; pipeline_id: string }

const STATUS_OPTIONS = [
  { value: 'novo', label: 'Novo' },
  { value: 'em_qualificacao', label: 'Em Qualificação' },
  { value: 'qualificado', label: 'Qualificado' },
  { value: 'descartado', label: 'Descartado' },
]

export function LeadActionsPanel({
  leadId,
  leadName,
  currentStatus,
  currentAssignee,
  users,
  pipelines = [],
  stages = [],
  isConverted,
  isAdmin,
  canConvert = true,
}: {
  leadId: string
  leadName: string
  currentStatus: string
  currentAssignee: string | null
  users: UserOption[]
  pipelines?: PipelineOption[]
  stages?: StageOption[]
  isConverted: boolean
  isAdmin: boolean
  canConvert?: boolean   // inbound ainda com o marketing: só converte depois de passado ao comercial
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [showConvertModal, setShowConvertModal] = useState(false)

  function handleStatusChange(status: string) {
    startTransition(async () => {
      const result = await updateLeadStatus(leadId, status)
      if (result.error) setError(result.error)
      else router.refresh()
    })
  }

  function handleAssign(userId: string) {
    startTransition(async () => {
      const result = await assignLead(leadId, userId)
      if (result.error) setError(result.error)
      else router.refresh()
    })
  }


  function handleAddNote() {
    if (!note.trim()) return
    startTransition(async () => {
      const result = await addLeadNote(leadId, note)
      if (result.error) {
        setError(result.error)
      } else {
        setNote('')
        router.refresh()
      }
    })
  }

  function handleDelete() {
    if (!confirm('Excluir este lead permanentemente?')) return
    startTransition(async () => {
      await deleteLead(leadId)
      router.push('/leads')
    })
  }

  return (
    <div className="space-y-4">
      {!isConverted && (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4">
          <div>
            <label className="block text-[10px] text-gray-500">Status</label>
            <select
              value={currentStatus}
              onChange={(e) => handleStatusChange(e.target.value)}
              disabled={isPending}
              className="mt-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] text-gray-500">Responsável</label>
            <select
              defaultValue={currentAssignee ?? ''}
              onChange={(e) => handleAssign(e.target.value)}
              disabled={isPending}
              className="mt-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none"
            >
              <option value="">Sem responsável</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.full_name}</option>
              ))}
            </select>
          </div>
          {canConvert ? <button
            onClick={() => setShowConvertModal(true)}
            disabled={isPending}
            className="rounded-md bg-positive-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-positive-700 disabled:opacity-50"
          >
            ✅ Converter em Oportunidade
          </button> : <span className="text-xs text-gray-500">Converte em oportunidade depois que o marketing passar ao comercial.</span>}
          {showConvertModal && (
            <ConvertLeadModal leadId={leadId} leadName={leadName} pipelines={pipelines} stages={stages} users={users} onClose={() => setShowConvertModal(false)} />
          )}
          {isAdmin && (
            <button onClick={handleDelete} disabled={isPending} className="text-xs text-negative-600 hover:underline">
              Excluir lead
            </button>
          )}
        </div>
      )}

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <label className="block text-xs font-medium text-gray-600">Adicionar nota</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none"
        />
        <button
          onClick={handleAddNote}
          disabled={isPending}
          className="mt-2 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
        >
          Adicionar
        </button>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
