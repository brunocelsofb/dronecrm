'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { convertLeadWithOptions } from '@/lib/actions/leads'
import { getCompanySettings } from '@/lib/actions/company-settings'

type Pipeline = { id: string; name: string }
type Stage    = { id: string; name: string; pipeline_id: string }
type User     = { id: string; full_name: string }

export function ConvertLeadModal({
  leadId,
  leadName,
  pipelines,
  stages,
  users,
  onClose,
}: {
  leadId: string
  leadName: string
  pipelines: Pipeline[]
  stages: Stage[]
  users: User[]
  onClose: () => void
}) {
  const router = useRouter()
  const [pipelineId, setPipelineId] = useState(pipelines[0]?.id ?? '')
  const [stageId, setStageId]       = useState('')
  const [responsibleId, setResponsibleId] = useState(users[0]?.id ?? '')
  const [estimatedValue, setEstimatedValue] = useState('')
  const [confirmed, setConfirmed]   = useState(false)
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [segments, setSegments]     = useState<string[]>([])
  const [segment, setSegment]       = useState('')

  useEffect(() => {
    let alive = true
    getCompanySettings().then(s => { if (alive) setSegments(s.segments) }).catch(() => {})
    return () => { alive = false }
  }, [])

  const filteredStages = stages.filter(s => s.pipeline_id === pipelineId)

  useEffect(() => {
    setStageId(filteredStages[0]?.id ?? '')
  }, [pipelineId])

  async function handleConvert() {
    if (!pipelineId || !stageId || !responsibleId) { setError('Selecione funil, etapa e responsável.'); return }
    if (!segment) { setError('Escolha o segmento da empresa.'); return }
    if (!confirmed) { setError('Confirme a criação da oportunidade.'); return }
    setSaving(true); setError(null)
    const res = await convertLeadWithOptions(leadId, {
      pipelineId, stageId, responsibleId, companySegment: segment,
      estimatedValue: estimatedValue ? Number(estimatedValue.replace(/\D/g,'')) : null,
    })
    setSaving(false)
    if (res.error) { setError(res.error); return }
    onClose()
    router.push(`/contracts/${res.contractId}`)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <h2 className="text-base font-bold text-[#1B556B]">Converter em Oportunidade</h2>
            <p className="text-xs text-gray-400 mt-0.5">{leadName}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>

        <div className="p-6 space-y-4">
          {/* Funil */}
          <div>
            <label className="block text-sm font-semibold text-[#1B556B] mb-1">Funil de destino *</label>
            <select value={pipelineId} onChange={e => setPipelineId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#1B556B] focus:outline-none">
              {pipelines.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          {/* Etapa */}
          <div>
            <label className="block text-sm font-semibold text-[#1B556B] mb-1">Etapa inicial *</label>
            <select value={stageId} onChange={e => setStageId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#1B556B] focus:outline-none"
              disabled={!pipelineId}>
              {filteredStages.length === 0
                ? <option value="">Selecione um funil primeiro</option>
                : filteredStages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          {/* Responsável */}
          <div>
            <label className="block text-sm font-semibold text-[#1B556B] mb-1">Responsável *</label>
            <select value={responsibleId} onChange={e => setResponsibleId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#1B556B] focus:outline-none">
              {users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
          </div>

          {/* Segmento da empresa */}
          <div>
            <label className="block text-sm font-semibold text-[#1B556B] mb-1">Segmento da empresa *</label>
            <select value={segment} onChange={e => setSegment(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#1B556B] focus:outline-none">
              <option value="">Selecione…</option>
              {segments.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <p className="mt-1 text-xs text-gray-400">Vale para a empresa nova; se ela já existir sem segmento, é preenchido.</p>
          </div>

          {/* Valor estimado */}
          <div>
            <label className="block text-sm font-semibold text-[#1B556B] mb-1">Valor estimado R$ (opcional)</label>
            <input value={estimatedValue} onChange={e => setEstimatedValue(e.target.value)}
              placeholder="Ex: 15000"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#1B556B] focus:outline-none" />
          </div>

          {/* Confirmação */}
          <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-gray-200 p-3 hover:bg-gray-50">
            <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}
              className="mt-0.5 rounded border-gray-300 text-[#1B556B] focus:ring-[#1B556B]" />
            <span className="text-sm text-gray-700">
              Vincular à empresa, criar contato e adicionar ao funil selecionado.
            </span>
          </label>

          {error && <p className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button onClick={handleConvert} disabled={saving}
              className="flex-1 rounded-lg bg-[#1B556B] py-2.5 text-sm font-semibold text-white hover:bg-[#164659] disabled:opacity-50">
              {saving ? 'Convertendo...' : '✅ Confirmar conversão'}
            </button>
            <button onClick={onClose}
              className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-50">
              Cancelar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
