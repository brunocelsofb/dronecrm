'use client'

import { useState, useActionState } from 'react'
import Link from 'next/link'
import { SaveButton } from '@/components/ui/save-button'

const initialState: { error?: string } = {}

export function EditPipelineInfoForm({
  pipelineId,
  name,
  description,
  type,
  wonLabel,
  lostLabel,
  wonTargetPipelineId,
  wonTargetStageId,
  allPipelines,
  allStagesByPipeline,
  renewalTriggerDays,
  renewalTargetStageId,
  stagesInThisPipeline,
  prepDays,
  action,
}: {
  pipelineId: string
  name: string
  description: string | null
  type: string
  wonLabel: string
  lostLabel: string
  wonTargetPipelineId: string | null
  wonTargetStageId: string | null
  allPipelines: { id: string; name: string; type?: string }[]
  allStagesByPipeline: Record<string, { id: string; name: string }[]>
  renewalTriggerDays: number | null
  renewalTargetStageId: string | null
  stagesInThisPipeline: { id: string; name: string }[]
  prepDays?: number   // "preparar a renovação" do agente (Central de regras): o cartão vai junto
  action: (prevState: { error?: string }, formData: FormData) => Promise<{ error?: string }>
}) {
  const [state, formAction] = useActionState(action, initialState)
  const [currentType, setCurrentType] = useState(type)
  const [selectedTargetPipeline, setSelectedTargetPipeline] = useState(wonTargetPipelineId ?? '')
  const stagesForSelectedTarget = allStagesByPipeline[selectedTargetPipeline] ?? []

  // Só funis de gestao_contratos aparecem como destino pós-ganho de vendas
  const contractPipelines = allPipelines.filter(p => (p as any).type === 'gestao_contratos')

  const isVendas = currentType === 'vendas'
  const isGestao = currentType === 'gestao_contratos'
  const isAvulso = currentType === 'servico_avulso'

  const inputCls = 'rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-brand-700 focus:outline-none'

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <div>
        <label className="block text-[10px] text-gray-500">Nome do funil</label>
        <input name="name" defaultValue={name} className={`${inputCls} text-sm font-medium`} />
      </div>
      <div>
        <label className="block text-[10px] text-gray-500">Descrição</label>
        <input name="description" defaultValue={description ?? ''} className={`w-56 ${inputCls}`} />
      </div>
      <div>
        <label className="block text-[10px] text-gray-500">Tipo</label>
        <select name="type" defaultValue={type} onChange={e => setCurrentType(e.target.value)} className={inputCls}>
          <option value="gestao_contratos">Gestão de Contratos</option>
          <option value="vendas">Novos Negócios (Vendas)</option>
          <option value="servico_avulso">Serviço Avulso</option>
        </select>
      </div>

      {/* Botões de desfecho — aparecem sempre exceto serviço avulso */}
      {!isAvulso && (
        <>
          <div>
            <label className="block text-[10px] text-positive-700">Botão de sucesso</label>
            <input name="won_label" defaultValue={wonLabel} placeholder={isVendas ? 'Ganho' : 'Renovado'} className={`w-28 ${inputCls}`} />
          </div>
          <div>
            <label className="block text-[10px] text-negative-700">Botão de perda</label>
            <input name="lost_label" defaultValue={lostLabel} placeholder={isVendas ? 'Perdido' : 'Não renovado'} className={`w-28 ${inputCls}`} />
          </div>
        </>
      )}

      {/* Novos Negócios: escolhe para qual funil de contratos vai ao ganhar */}
      {isVendas && (
        <>
          <div>
            <label className="block text-[10px] text-gray-500">Ao ganhar → mover para o funil</label>
            <select name="won_target_pipeline_id" defaultValue={wonTargetPipelineId ?? ''}
              onChange={e => setSelectedTargetPipeline(e.target.value)} className={`w-44 ${inputCls}`}>
              <option value="">Nenhum (fica como ganho aqui)</option>
              {contractPipelines.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          {selectedTargetPipeline && (
            <div>
              <label className="block text-[10px] text-gray-500">Em qual etapa</label>
              <select name="won_target_stage_id" defaultValue={wonTargetStageId ?? ''} className={`w-40 ${inputCls}`}>
                <option value="">Primeira etapa (padrão)</option>
                {stagesForSelectedTarget.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          )}
          {/* Garante que campos de renovação não sejam enviados */}
          <input type="hidden" name="renewal_trigger_days" value="" />
          <input type="hidden" name="renewal_target_stage_id" value="" />
        </>
      )}

      {/* Gestão de Contratos: renovação automática */}
      {isGestao && (
        <>
          <div>
            <label className="block text-[10px] text-gray-500">Iniciar renovação (dias antes do vencimento)</label>
            {/* Segue o "preparar a renovação" do agente: edita na Central de regras → Renovação */}
            <input type="hidden" name="renewal_trigger_days" value={prepDays ?? renewalTriggerDays ?? ''} />
            <Link href="/regras?tema=renovacao" title="Junto com o “preparar a renovação”. Para mudar, use a Central de regras → Renovação."
              className={`inline-block w-36 ${inputCls} bg-gray-50 text-gray-600 hover:text-brand-700`}>{prepDays ?? renewalTriggerDays ?? '—'} dias · editar →</Link>
          </div>
          <div>
            <label className="block text-[10px] text-gray-500">Mover automaticamente pra etapa</label>
            <select name="renewal_target_stage_id" defaultValue={renewalTargetStageId ?? ''} className={`w-40 ${inputCls}`}>
              <option value="">Desativado</option>
              {stagesInThisPipeline.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          {/* Garante que campos de won_target não sejam enviados */}
          <input type="hidden" name="won_target_pipeline_id" value="" />
          <input type="hidden" name="won_target_stage_id" value="" />
        </>
      )}

      {/* Serviço Avulso: sem automações */}
      {isAvulso && (
        <>
          <p style={{ fontSize: 11, color: '#8892a4', alignSelf: 'center' }}>
            Serviço avulso não tem renovação nem destino pós-ganho — o negócio encerra ao dar sucesso.
          </p>
          <input type="hidden" name="won_label" value={wonLabel} />
          <input type="hidden" name="lost_label" value={lostLabel} />
          <input type="hidden" name="won_target_pipeline_id" value="" />
          <input type="hidden" name="won_target_stage_id" value="" />
          <input type="hidden" name="renewal_trigger_days" value="" />
          <input type="hidden" name="renewal_target_stage_id" value="" />
        </>
      )}

      <SaveButton />
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  )
}
