'use client'

// Mesmo padrão de upload do FilesSection (direto pro Storage do
// navegador) — reaproveita o bucket "contract-files", só que num
// caminho separado (prefixo "dimensionamento/").

import { useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { sendDimensioningReview, reviewDimensioning } from '@/lib/actions/workflow'
import { getFileDownloadUrl } from '@/lib/actions/files'
import { sanitizeStorageFileName, tenantStoragePath } from '@/lib/utils/storage'

type Review = {
  id: string
  file_storage_path: string | null
  file_name: string | null
  sent_at: string
  status: string
  reviewed_at: string | null
  review_notes: string | null
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Aguardando ciência do time técnico',
  acknowledged_ok: 'De acordo',
  acknowledged_disagree: 'Não de acordo',
}
const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  acknowledged_ok: 'bg-positive-100 text-positive-700',
  acknowledged_disagree: 'bg-negative-100 text-negative-700',
}

export function DimensioningSection({ contractId, reviews }: { contractId: string; reviews: Review[] }) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({})
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    setError(null)

    const supabase = createClient()
    const storagePath = await tenantStoragePath(supabase, `dimensionamento/${contractId}/${Date.now()}-${sanitizeStorageFileName(file.name)}`)

    const { error: uploadError } = await supabase.storage.from('contract-files').upload(storagePath, file)

    if (uploadError) {
      setError(`Falha no upload: ${uploadError.message}`)
      setUploading(false)
      return
    }

    const result = await sendDimensioningReview(contractId, storagePath, file.name)
    if (result.error) setError(result.error)

    setUploading(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  async function handleDownload(storagePath: string | null) {
    if (!storagePath) return
    const result = await getFileDownloadUrl(storagePath)
    if ('error' in result) {
      setError(result.error ?? 'Falha ao gerar link.')
      return
    }
    window.open(result.url, '_blank')
  }

  async function handleReview(reviewId: string, decision: 'acknowledged_ok' | 'acknowledged_disagree') {
    const result = await reviewDimensioning(reviewId, contractId, decision, reviewNotes[reviewId] ?? '')
    if (result.error) setError(result.error)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-gray-900">Aprovação de Dimensionamento</h2>
        <label className="cursor-pointer rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800">
          {uploading ? 'Enviando...' : '+ Enviar dimensionamento'}
          <input ref={inputRef} type="file" onChange={handleUpload} disabled={uploading} className="hidden" />
        </label>
      </div>
      <p className="text-xs text-gray-400">
        Anexe o processo completo (dimensionamento, TR/BID quando houver). O contrato só pode ser marcado como Ganho depois que o time técnico der ciência.
      </p>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="space-y-2">
        {reviews.map((r) => (
          <div key={r.id} className="rounded-lg border border-gray-200 bg-white p-3 text-sm">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => handleDownload(r.file_storage_path)}
                className="font-medium text-brand-700 hover:underline"
              >
                {r.file_name ?? 'Arquivo'}
              </button>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[r.status]}`}>
                {STATUS_LABELS[r.status]}
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-400">Enviado em {new Date(r.sent_at).toLocaleDateString('pt-BR')}</p>

            {r.status === 'pending' ? (
              <div className="mt-2 space-y-2 border-t border-gray-100 pt-2">
                <input
                  value={reviewNotes[r.id] ?? ''}
                  onChange={(e) => setReviewNotes((prev) => ({ ...prev, [r.id]: e.target.value }))}
                  placeholder="Observação (opcional)"
                  className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => handleReview(r.id, 'acknowledged_ok')}
                    className="rounded-md bg-positive-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-positive-700"
                  >
                    De acordo
                  </button>
                  <button
                    onClick={() => handleReview(r.id, 'acknowledged_disagree')}
                    className="rounded-md bg-negative-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-negative-700"
                  >
                    Não de acordo
                  </button>
                </div>
              </div>
            ) : (
              r.review_notes && <p className="mt-2 text-xs text-gray-600 border-t border-gray-100 pt-2">&ldquo;{r.review_notes}&rdquo;</p>
            )}
          </div>
        ))}
        {reviews.length === 0 && <p className="text-sm text-gray-400">Nenhum dimensionamento enviado ainda.</p>}
      </div>
    </div>
  )
}
