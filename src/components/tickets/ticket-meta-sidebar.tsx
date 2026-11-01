'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateTicketStatus, updateTicketPriority, assignTicket, deleteTicket } from '@/lib/actions/tickets'
import { PRIORITY_LABELS, PRIORITY_SLA_DAYS } from '@/lib/utils/gut-matrix'

type UserOption = { id: string; full_name: string }

const STATUS_OPTIONS = [
  { value: 'aberto', label: 'Aberto' },
  { value: 'em_andamento', label: 'Em andamento' },
  { value: 'aguardando_cliente', label: 'Aguardando cliente' },
  { value: 'resolvido', label: 'Resolvido' },
  { value: 'fechado', label: 'Fechado' },
]
// Prazo de cada prioridade: o da empresa (Central de regras → Atendimento), senão o padrão
const priorityOptions = (sla: Record<string, number> = PRIORITY_SLA_DAYS) => (['nao_critica', 'pouco_critica', 'critica', 'muito_critica'] as const)
  .map(k => ({ value: k, label: `${PRIORITY_LABELS[k]} (${sla[k] ?? PRIORITY_SLA_DAYS[k]}d)` }))

// NOTA: cada ação tem seu próprio estado de "carregando" — não
// compartilha com o formulário de resposta (bug antigo já corrigido).
export function TicketMetaSidebar({
  ticketId,
  currentStatus,
  currentPriority,
  currentAssignee,
  users,
  isAdmin,
  slaDays,
}: {
  ticketId: string
  currentStatus: string
  currentPriority: string
  currentAssignee: string | null
  users: UserOption[]
  isAdmin: boolean
  slaDays?: Record<string, number>
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [statusBusy, setStatusBusy] = useState(false)
  const [priorityBusy, setPriorityBusy] = useState(false)
  const [assignBusy, setAssignBusy] = useState(false)
  const [finalizeBusy, setFinalizeBusy] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)

  async function handleStatusChange(status: string) {
    setStatusBusy(true)
    setError(null)
    const result = await updateTicketStatus(ticketId, status)
    setStatusBusy(false)
    if (result.error) setError(result.error)
    else router.refresh()
  }

  async function handlePriorityChange(priority: string) {
    setPriorityBusy(true)
    setError(null)
    const result = await updateTicketPriority(ticketId, priority)
    setPriorityBusy(false)
    if (result.error) setError(result.error)
    else router.refresh()
  }

  async function handleAssign(userId: string) {
    setAssignBusy(true)
    setError(null)
    const result = await assignTicket(ticketId, userId)
    setAssignBusy(false)
    if (result.error) setError(result.error)
    else router.refresh()
  }

  async function handleFinalize() {
    if (!confirm('Finalizar este atendimento de vez (fechado)? A pesquisa de satisfação passa a aparecer pro cliente no link de acompanhamento.')) return
    setFinalizeBusy(true)
    setError(null)
    const result = await updateTicketStatus(ticketId, 'fechado')
    setFinalizeBusy(false)
    if (result.error) setError(result.error)
    else router.refresh()
  }

  async function handleDelete() {
    if (!confirm('Excluir este ticket permanentemente?')) return
    setDeleteBusy(true)
    await deleteTicket(ticketId)
    router.push('/tickets')
  }

  const isFinalized = currentStatus === 'fechado'

  return (
    <div className="space-y-3">
      {!isFinalized && (
        <button
          onClick={handleFinalize}
          disabled={finalizeBusy}
          className="w-full rounded-lg bg-positive-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-positive-700 disabled:opacity-50"
        >
          {finalizeBusy ? 'Finalizando...' : '✅ Finalizar atendimento'}
        </button>
      )}

      <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        <p className="text-xs font-semibold uppercase text-gray-400">Detalhes</p>
        <div>
          <label className="block text-[10px] text-gray-500">Status</label>
          <select value={currentStatus} onChange={(e) => handleStatusChange(e.target.value)} disabled={statusBusy} className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none">
            {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] text-gray-500">Prioridade</label>
          <select value={currentPriority} onChange={(e) => handlePriorityChange(e.target.value)} disabled={priorityBusy} className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none">
            {priorityOptions(slaDays).map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] text-gray-500">Responsável</label>
          <select defaultValue={currentAssignee ?? ''} onChange={(e) => handleAssign(e.target.value)} disabled={assignBusy} className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none">
            <option value="">Sem responsável</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
        </div>
        {isAdmin && (
          <button onClick={handleDelete} disabled={deleteBusy} className="text-xs text-negative-600 hover:underline">
            {deleteBusy ? 'Excluindo...' : 'Excluir ticket'}
          </button>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </div>
  )
}
