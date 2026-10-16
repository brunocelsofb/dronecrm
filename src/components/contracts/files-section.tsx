'use client'

// NOTA DE INCERTEZA: o upload vai direto do navegador pro Supabase
// Storage (supabase.storage.from(...).upload(...)), em vez de passar
// pelo nosso servidor — isso evita limite de tamanho de Server Action,
// mas é a parte que eu tenho menos confiança de ter acertado de primeira
// (não tive como testar com um arquivo real). Se o upload falhar, me
// mande a mensagem de erro exata que aparecer.

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Check, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { registerContractFile, deleteContractFile, getFileDownloadUrl, renameContractFile, setContractFileKind, type DocumentKind } from '@/lib/actions/files'
import { sanitizeStorageFileName } from '@/lib/utils/storage'

type ContractFile = {
  id: string
  file_name: string
  storage_path: string
  file_size: number | null
  mime_type: string | null
  created_at: string
  document_kind?: DocumentKind | null
}

function fmtSize(bytes: number | null) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const KIND_LABEL: Record<DocumentKind, string> = { arquivo: 'Arquivo', contrato: 'Contrato', aditivo: 'Aditivo' }

// mode 'arquivos': aba Arquivos (qualquer arquivo). mode 'contrato': aba
// Contrato e aditivos (só contrato e aditivos). O mesmo arquivo pode ser
// movido de uma aba para a outra.
export function FilesSection({ contractId, initialFiles, mode = 'arquivos' }: { contractId: string; initialFiles: ContractFile[]; mode?: 'arquivos' | 'contrato' }) {
  const router = useRouter()
  const [files, setFiles] = useState(initialFiles)
  const [uploadKind, setUploadKind] = useState<DocumentKind>(mode === 'arquivos' ? 'arquivo' : (initialFiles.some(f => f.document_kind === 'contrato') ? 'aditivo' : 'contrato'))
  const [uploading, setUploading] = useState(false)
  const [alreadySigned, setAlreadySigned] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  function startEditing(f: ContractFile) {
    setEditingId(f.id)
    setEditValue(f.file_name)
  }

  async function saveRename(fileId: string) {
    const newName = editValue.trim()
    if (!newName) {
      setError('O nome não pode ficar vazio.')
      return
    }
    setFiles((prev) => prev.map((f) => (f.id === fileId ? { ...f, file_name: newName } : f)))
    setEditingId(null)
    const result = await renameContractFile(fileId, contractId, newName)
    if (result && 'error' in result) setError(result.error ?? 'Falha ao renomear.')
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    setError(null)

    const supabase = createClient()
    // Caminho único por contrato + timestamp, pra evitar colisão de nomes
    const storagePath = `${contractId}/${Date.now()}-${sanitizeStorageFileName(file.name)}`

    const { error: uploadError } = await supabase.storage
      .from('contract-files')
      .upload(storagePath, file)

    if (uploadError) {
      setError(`Falha no upload: ${uploadError.message}`)
      setUploading(false)
      return
    }

    const result = await registerContractFile(contractId, file.name, storagePath, file.size, file.type, uploadKind, mode === 'contrato' && alreadySigned)

    if ('error' in result) {
      setError(result.error ?? 'Falha ao registrar o arquivo.')
      setUploading(false)
      return
    }

    setFiles((prev) => [
      { id: crypto.randomUUID(), file_name: file.name, storage_path: storagePath, file_size: file.size, mime_type: file.type, created_at: new Date().toISOString(), document_kind: uploadKind },
      ...prev,
    ])
    setUploading(false)
    if (inputRef.current) inputRef.current.value = ''
    if (mode === 'contrato' && alreadySigned) { setNotice('Anexado como assinado: o consultor recebeu a tarefa para validar e dar ganho, e o gestor foi avisado no WhatsApp.'); setAlreadySigned(false) }
    router.refresh()
  }

  async function changeKind(fileId: string, kind: DocumentKind) {
    setError(null)
    const r = await setContractFileKind(fileId, contractId, kind)
    if ('error' in r) { setError(r.error ?? 'Falha ao mover o arquivo.'); return }
    setFiles(prev => (mode === 'arquivos' ? (kind === 'arquivo' ? prev : prev.filter(f => f.id !== fileId)) : (kind === 'arquivo' ? prev.filter(f => f.id !== fileId) : prev.map(f => (f.id === fileId ? { ...f, document_kind: kind } : f)))))
    router.refresh()
  }

  async function handleDownload(storagePath: string) {
    const result = await getFileDownloadUrl(storagePath)
    if ('error' in result) {
      setError(result.error ?? 'Falha ao gerar link de download.')
      return
    }
    window.open(result.url, '_blank')
  }

  async function handleDelete(fileId: string, storagePath: string) {
    if (!confirm('Remover este arquivo?')) return
    setFiles((prev) => prev.filter((f) => f.id !== fileId))
    await deleteContractFile(fileId, contractId, storagePath)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium text-gray-900">{mode === 'arquivos' ? 'Arquivos' : 'Contrato e aditivos'}</h2>
          <p className="text-xs text-gray-500">
            {mode === 'arquivos'
              ? 'Qualquer arquivo do cliente. Contrato e aditivos ficam na aba “Contrato e aditivos”.'
              : 'Somente o contrato e os aditivos (de preferência em PDF — é o que o Farmer lê).'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {mode === 'contrato' && (
            <select value={uploadKind} onChange={e => setUploadKind(e.target.value as DocumentKind)} aria-label="Tipo do documento" className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs">
              <option value="contrato">Contrato</option>
              <option value="aditivo">Aditivo</option>
            </select>
          )}
          <label className="cursor-pointer rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800">
            {uploading ? 'Enviando...' : mode === 'arquivos' ? '+ Anexar arquivo' : `+ Anexar ${KIND_LABEL[uploadKind].toLowerCase()}`}
            <input ref={inputRef} type="file" accept={mode === 'contrato' ? '.pdf,application/pdf,.doc,.docx' : undefined} onChange={handleUpload} disabled={uploading} className="hidden" />
          </label>
        </div>
      </div>

      {mode === 'contrato' && (
        <label className="flex items-start gap-2 text-xs text-gray-600">
          <input type="checkbox" checked={alreadySigned} onChange={e => setAlreadySigned(e.target.checked)} className="mt-0.5" />
          <span>O próximo arquivo já está <strong>assinado</strong> (contrato do cliente, assinado fora da ZapSign) — cria a tarefa para o consultor validar e dar ganho e avisa o gestor no WhatsApp.</span>
        </label>
      )}
      {notice && <p className="text-xs text-positive-700">✓ {notice}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {files.length === 0 ? (
        <p className="text-sm text-gray-400">{mode === 'arquivos' ? 'Nenhum arquivo anexado ainda.' : 'Nenhum contrato anexado ainda.'}</p>
      ) : (
        <div className="space-y-2">
          {files.map((f) => (
            <div key={f.id} className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm">
              <div className="flex-1">
                {editingId === f.id ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveRename(f.id)
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                      className="flex-1 rounded-md border border-brand-700 px-2 py-1 text-sm focus:outline-none"
                    />
                    <button onClick={() => saveRename(f.id)} className="text-positive-600 hover:text-positive-700" title="Salvar">
                      <Check size={16} />
                    </button>
                    <button onClick={() => setEditingId(null)} className="text-gray-400 hover:text-gray-600" title="Cancelar">
                      <X size={16} />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    {mode === 'contrato' && (
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${f.document_kind === 'contrato' ? 'bg-brand-700 text-white' : 'bg-brand-100 text-brand-800'}`}>
                        {KIND_LABEL[(f.document_kind ?? 'contrato') as DocumentKind]}
                      </span>
                    )}
                    <button onClick={() => handleDownload(f.storage_path)} className="font-medium text-brand-700 hover:underline">
                      {f.file_name}
                    </button>
                    <button onClick={() => startEditing(f)} className="text-gray-300 hover:text-gray-600" title="Renomear">
                      <Pencil size={13} />
                    </button>
                  </div>
                )}
                <p className="text-xs text-gray-400">
                  {fmtSize(f.file_size)} · {new Date(f.created_at).toLocaleDateString('pt-BR')}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <select
                  value=""
                  onChange={e => { if (e.target.value) changeKind(f.id, e.target.value as DocumentKind) }}
                  aria-label="Mover arquivo"
                  className="rounded-md border border-gray-200 bg-white px-1.5 py-1 text-xs text-gray-600"
                >
                  <option value="">{mode === 'arquivos' ? 'Mover para Contrato…' : 'Alterar…'}</option>
                  {mode === 'arquivos' ? (
                    <>
                      <option value="contrato">É o contrato</option>
                      <option value="aditivo">É um aditivo</option>
                    </>
                  ) : (
                    <>
                      {f.document_kind !== 'contrato' && <option value="contrato">Marcar como contrato</option>}
                      {f.document_kind !== 'aditivo' && <option value="aditivo">Marcar como aditivo</option>}
                      <option value="arquivo">Voltar para Arquivos</option>
                    </>
                  )}
                </select>
                <button onClick={() => handleDelete(f.id, f.storage_path)} className="text-xs text-gray-400 hover:text-negative-600">
                  Remover
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
