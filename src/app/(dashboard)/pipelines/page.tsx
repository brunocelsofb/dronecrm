import { createClient } from '@/lib/supabase/server'
import { NewPipelineForm } from '@/components/pipelines/new-pipeline-form'
import { ConfirmDeleteButton } from '@/components/pipelines/confirm-delete-button'
import { DeleteStageButton } from '@/components/pipelines/delete-stage-button'
import { EditPipelineInfoForm } from '@/components/pipelines/edit-pipeline-info-form'
import { createStage, updateStage, deleteStage, deletePipeline, updatePipelineInfo } from '@/lib/actions/pipelines'
import { MoveStageButtons } from '@/components/pipelines/move-stage-buttons'
import { SaveButton } from '@/components/ui/save-button'
import { isCurrentUserAdmin } from '@/lib/auth/role'

export default async function PipelinesPage() {
  const supabase = await createClient()
  const isAdmin = await isCurrentUserAdmin()
  // O cartão vai para a renovação junto com o "preparar a renovação" do agente (Central de regras)
  const { data: orgRow } = await supabase.from('organization_settings').select('copilot_settings').maybeSingle()
  const { resolveRenewalLevels } = await import('@/lib/agent/renewal-templates')
  const prepDays = resolveRenewalLevels((orgRow as { copilot_settings?: { renewal_levels?: unknown } } | null)?.copilot_settings?.renewal_levels).prep

  const { data: pipelines } = await supabase
    .from('pipelines')
    .select('id, name, description, is_default, type, won_label, lost_label, won_target_pipeline_id, won_target_stage_id, renewal_trigger_days, renewal_target_stage_id')
    .order('name')

  const { data: allStages } = await supabase
    .from('stages')
    .select('id, pipeline_id, name, order_index, color, sla_days, is_won, is_lost')
    .order('order_index')

  const allStagesByPipeline: Record<string, { id: string; name: string }[]> = {}
  for (const s of allStages ?? []) {
    if (!allStagesByPipeline[s.pipeline_id]) allStagesByPipeline[s.pipeline_id] = []
    allStagesByPipeline[s.pipeline_id].push({ id: s.id, name: s.name })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Funis e Etapas</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Crie funis do zero e configure as etapas de cada um. Mudanças aqui afetam o Kanban e o Dashboard imediatamente.
        </p>
      </div>

      <NewPipelineForm />

      <div className="space-y-6">
        {pipelines?.map((pipeline) => {
          const stages = (allStages ?? []).filter((s) => s.pipeline_id === pipeline.id)

          return (
            <div key={pipeline.id} className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    {pipeline.is_default && (
                      <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[10px] text-brand-700">Padrão</span>
                    )}
                  </div>
                  <EditPipelineInfoForm
                    pipelineId={pipeline.id}
                    key={`${pipeline.id}:${pipeline.name}:${pipeline.type}:${pipeline.won_label}:${pipeline.lost_label}:${pipeline.won_target_pipeline_id ?? 'none'}:${pipeline.won_target_stage_id ?? 'none'}`}
                    name={pipeline.name}
                    description={pipeline.description}
                    type={pipeline.type}
                    wonLabel={pipeline.won_label}
                    lostLabel={pipeline.lost_label}
                    wonTargetPipelineId={pipeline.won_target_pipeline_id}
                    wonTargetStageId={pipeline.won_target_stage_id}
                    allPipelines={pipelines ?? []}
                    allStagesByPipeline={allStagesByPipeline}
                    renewalTriggerDays={pipeline.renewal_trigger_days}
                    renewalTargetStageId={pipeline.renewal_target_stage_id}
                    stagesInThisPipeline={stages.map((s) => ({ id: s.id, name: s.name }))}
                    prepDays={prepDays}
                    action={updatePipelineInfo.bind(null, pipeline.id)}
                  />
                </div>
                {!pipeline.is_default && isAdmin && (
                  <form action={deletePipeline.bind(null, pipeline.id)}>
                    <ConfirmDeleteButton
                      label="Excluir funil"
                      confirmMessage={`Excluir o funil "${pipeline.name}"? Isso só é possível se não houver contratos nele.`}
                    />
                  </form>
                )}
              </div>

              <div className="space-y-2">
                {stages.map((stage, i) => (
                  <div
                    key={stage.id}
                    className="flex flex-wrap items-center gap-2 rounded-md border border-gray-100 bg-gray-50 p-2"
                  >
                    <MoveStageButtons stageId={stage.id} disableUp={i === 0} disableDown={i === stages.length - 1} />

                    <form
                      action={updateStage.bind(null, stage.id)}
                      className="flex flex-wrap items-center gap-2"
                    >
                      <input type="color" name="color" defaultValue={stage.color ?? '#6B7280'} className="h-8 w-8 shrink-0 cursor-pointer rounded border border-gray-300" />

                      <input
                        name="name"
                        defaultValue={stage.name}
                        className="min-w-[140px] flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-brand-700 focus:outline-none"
                      />

                      <label className="flex items-center gap-1 text-xs text-gray-600">
                        SLA
                        <input
                          type="number"
                          name="sla_days"
                          defaultValue={stage.sla_days ?? ''}
                          min={0}
                          title="Prazo máximo na etapa (dias): marca o cartão como atrasado e dá a cor. 0 = sem prazo (etapas que duram a vigência). Vazio = 7 dias só para a cor."
                          placeholder="dias"
                          className="w-16 rounded-md border border-gray-300 px-1.5 py-1 text-xs focus:border-brand-700 focus:outline-none"
                        />
                      </label>

                      <label className="flex items-center gap-1 text-xs text-gray-600">
                        <input type="checkbox" name="is_won" defaultChecked={stage.is_won} />
                        Ganho
                      </label>
                      <label className="flex items-center gap-1 text-xs text-gray-600">
                        <input type="checkbox" name="is_lost" defaultChecked={stage.is_lost} />
                        Perdido
                      </label>

                      <SaveButton />
                    </form>

                    {isAdmin && <DeleteStageButton stageId={stage.id} stageName={stage.name} />}
                  </div>
                ))}

                {stages.length === 0 && (
                  <p className="py-2 text-center text-xs text-gray-400">Nenhuma etapa ainda — adicione a primeira abaixo.</p>
                )}
              </div>

              <form action={createStage.bind(null, pipeline.id)} className="mt-3 flex gap-2">
                <input
                  name="name"
                  required
                  placeholder="Nome da nova etapa"
                  className="flex-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none"
                />
                <button
                  type="submit"
                  className="rounded-md border border-brand-700 px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-100"
                >
                  + Etapa
                </button>
              </form>
            </div>
          )
        })}
      </div>
    </div>
  )
}
