'use client'

import { useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { transferContract, returnContract } from '@/lib/actions/workflow'
import { DEPARTMENTS, departmentLabel } from '@/lib/constants/departments'
import { sanitizeStorageFileName, tenantStoragePath } from '@/lib/utils/storage'

type UserOption = { id: string; full_name: string; department: string | null }
type TransferLog = { id: string; content: string; created_at: string; user_name: string | null }

async function uploadAttachment(contractId: string, file: File): Promise<{ path: string; name: string } | null> {
  const supabase = createClient()
  const storagePath = await tenantStoragePath(supabase, `transfers/${contractId}/${Date.now()}-${sanitizeStorageFileName(file.name)}`)
  const { error } = await supabase.storage.from('contract-files').upload(storagePath, file)
  if (error) throw new Error(`Falha no upload: ${error.message}`)
  return { path: storagePath, name: file.name }
}

export function DepartmentSection({
  contractId,
  currentDepartment,
  currentAssigneeName,
  hasPrevious,
  users,
  transfers,
}: {
  contractId: string
  currentDepartment: string | null
  currentAssigneeName: string | null
  hasPrevious: boolean
  users: UserOption[]
  transfers: TransferLog[]
}) {
  // Só UM fluxo fica ativo por vez — evita a confusão de ter "Transferir"
  // e "Devolver" abertos juntos, o que fazia ficar ambíguo qual usar
  // quando havia algo pendente de devolução.
  const [mode, setMode] = useState<'idle' | 'return' | 'transfer'>('idle')
  const [showHistory, setShowHistory] = useState(false)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [selectedDept, setSelectedDept] = useState('')
  const [selectedAssignee, setSelectedAssignee] = useState('')
  const [note, setNote] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const peopleInDept = users.filter((u) => u.department === selectedDept)

  function resetForm() {
    setMode('idle')
    setSelectedDept('')
    setSelectedAssignee('')
    setNote('')
    setFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleTransfer() {
    if (!selectedDept) {
      setError('Selecione o departamento de destino.')
      return
    }
    setError(null)
    setBusy(true)
    try {
      let attachment: { path: string; name: string } | null = null
      if (file) attachment = await uploadAttachment(contractId, file)

      const result = await transferContract(
        contractId,
        selectedDept,
        selectedAssignee || null,
        note,
        attachment?.path ?? null,
        attachment?.name ?? null
      )
      if (result.error) {
        setError(result.error)
      } else {
        resetForm()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao transferir.')
    } finally {
      setBusy(false)
    }
  }

  async function handleReturn() {
    setError(null)
    setBusy(true)
    try {
      let attachment: { path: string; name: string } | null = null
      if (file) attachment = await uploadAttachment(contractId, file)

      const result = await returnContract(contractId, note, attachment?.path ?? null, attachment?.name ?? null)
      if (result.error) {
        setError(result.error)
      } else {
        resetForm()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao devolver.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-gray-500">Responsável pela tratativa atual (pontual)</p>
          <p className="text-base font-semibold text-gray-900">
            {departmentLabel(currentDepartment)}
            {currentAssigneeName && <span className="font-normal text-gray-500"> — {currentAssigneeName}</span>}
          </p>
        </div>

        {mode === 'idle' && (
          <div className="flex gap-2">
            {hasPrevious && (
              <button
                onClick={() => setMode('return')}
                className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800"
              >
                ↩ Devolver
              </button>
            )}
            <button
              onClick={() => setMode('transfer')}
              className={
                hasPrevious
                  ? 'text-xs text-gray-400 hover:text-gray-600 hover:underline'
                  : 'rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800'
              }
            >
              {hasPrevious ? 'Transferir para outro time em vez de devolver' : 'Transferir'}
            </button>
          </div>
        )}
      </div>

      {mode === 'return' && (
        <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">
          <p className="text-xs font-medium text-gray-700">Devolvendo para quem transferiu antes</p>
          <label className="block text-[10px] text-gray-500">O que foi tratado?</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Ex: Dimensionamento validado, sem restrições técnicas."
            className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none"
          />
          <div>
            <label className="block text-[10px] text-gray-500">Anexo (opcional)</label>
            <input
              ref={fileInputRef}
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="mt-1 text-xs"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleReturn}
              disabled={busy}
              className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
            >
              {busy ? 'Devolvendo...' : 'Confirmar devolução'}
            </button>
            <button onClick={resetForm} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {mode === 'transfer' && (
        <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-[10px] text-gray-500">Transferir para (departamento)</label>
              <select
                value={selectedDept}
                onChange={(e) => {
                  setSelectedDept(e.target.value)
                  setSelectedAssignee('')
                }}
                className="mt-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none"
              >
                <option value="">Selecione...</option>
                {DEPARTMENTS.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-gray-500">Pessoa (opcional)</label>
              <select
                value={selectedAssignee}
                onChange={(e) => setSelectedAssignee(e.target.value)}
                disabled={!selectedDept}
                className="mt-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none disabled:bg-gray-100"
              >
                <option value="">Qualquer pessoa do time</option>
                {peopleInDept.map((u) => (
                  <option key={u.id} value={u.id}>{u.full_name}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-[10px] text-gray-500">Nota (opcional)</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ex: Cliente reclamou de atraso na entrega"
              className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] text-gray-500">Anexo (opcional) — pra quem recebe entender do que se trata</label>
            <input
              ref={fileInputRef}
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="mt-1 text-xs"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleTransfer}
              disabled={busy}
              className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
            >
              {busy ? 'Transferindo...' : 'Transferir'}
            </button>
            <button onClick={resetForm} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {transfers.length > 0 && (
        <div className="mt-3 border-t border-gray-100 pt-2">
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="text-[11px] font-medium text-gray-400 hover:text-gray-600"
          >
            {showHistory ? '▾ Esconder histórico' : `▸ Ver histórico (${transfers.length})`}
          </button>
          {showHistory && (
            <div className="mt-2 space-y-1.5">
              {transfers.map((t) => (
                <p key={t.id} className="text-xs text-gray-500">
                  <span className="text-gray-400">{new Date(t.created_at).toLocaleDateString('pt-BR')} — </span>
                  {t.content}
                  {t.user_name && <span className="text-gray-400"> (por {t.user_name})</span>}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
