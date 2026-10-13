'use client'

import { useActionState } from 'react'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { createContract, type ActionState } from '@/lib/actions/contracts'
import { createClient } from '@/lib/supabase/client'
import { CompanyContactSection } from '@/components/contracts/company-contact-section'
import { ValidityPeriodInput } from '@/components/contracts/validity-period-input'
import type { PipelineFieldConfig } from '@/lib/pipeline-field-config'

type Stage = { id: string; name: string }
type Pipeline = { id: string; name: string; is_default: boolean; type: string }

const initialState: ActionState = {}

const SOURCE_OPTIONS = [
  { value: 'indicacao', label: 'Indicação' },
  { value: 'licitacao', label: 'Licitação' },
  { value: 'prospeccao', label: 'Prospecção ativa' },
  { value: 'inbound', label: 'Inbound / Site' },
  { value: 'renovacao', label: 'Renovação' },
  { value: 'outro', label: 'Outro' },
]

export default function NewContractPage() {
  const [state, formAction, pending] = useActionState(createContract, initialState)
  const searchParams = useSearchParams()
  const pipelineParam = searchParams.get('pipeline')
  const companyIdParam = searchParams.get('company') ?? searchParams.get('company_id')

  const [pipelineId, setPipelineId] = useState<string | null>(pipelineParam)
  const [pipelineName, setPipelineName] = useState<string>('')
  const [pipelineType, setPipelineType] = useState<string>('gestao_contratos')
  const [stages, setStages] = useState<Stage[]>([])
  const [fieldConfigs, setFieldConfigs] = useState<PipelineFieldConfig[]>([])
  const [tags, setTags] = useState<{ id: string; name: string; color: string }[]>([])
  const [orgCnpj, setOrgCnpj] = useState<string>('')
  const [accountOwners, setAccountOwners] = useState<{ id: string; full_name: string }[]>([])

  useEffect(() => {
    const supabase = createClient()

    async function load() {
      let resolvedPipelineId = pipelineParam

      if (!resolvedPipelineId) {
        const { data: pipelines } = await supabase
          .from('pipelines')
          .select('id, name, is_default, type')
          .order('name')
        const defaultPipeline = (pipelines as Pipeline[] | null)?.find((p) => p.is_default) ?? pipelines?.[0]
        resolvedPipelineId = defaultPipeline?.id ?? null
        if (defaultPipeline) {
          setPipelineName(defaultPipeline.name)
          setPipelineType(defaultPipeline.type)
        }
      } else {
        const { data: pipeline } = await supabase
          .from('pipelines')
          .select('name, type')
          .eq('id', resolvedPipelineId)
          .single()
        if (pipeline) {
          setPipelineName(pipeline.name)
          setPipelineType(pipeline.type)
        }
      }

      setPipelineId(resolvedPipelineId)

      if (resolvedPipelineId) {
        const [{ data: stagesData }, { data: configsData }, { data: tagsData }, { data: orgData }] = await Promise.all([
          supabase.from('stages').select('id, name').eq('pipeline_id', resolvedPipelineId).order('order_index'),
          supabase.from('pipeline_field_configs').select('*').eq('pipeline_id', resolvedPipelineId).order('display_order'),
          supabase.from('tags').select('id, name, color').order('name'),
          supabase.from('organization_settings').select('company_cnpj').eq('id', 'default').maybeSingle(),
        ])
        setStages(stagesData ?? [])
        setFieldConfigs((configsData ?? []) as PipelineFieldConfig[])
        setTags(tagsData ?? [])
        setOrgCnpj(orgData?.company_cnpj ?? '')
      }

      // Consultores para "responsável pela conta" (obrigatório no funil Contratos)
      const { data: profilesData } = await supabase.from('profiles').select('id, full_name').order('full_name')
      setAccountOwners((profilesData ?? []).map(p => ({ id: p.id, full_name: p.full_name ?? '' })))
    }

    load()
  }, [pipelineParam])

  // Helper: verifica visibilidade do campo
  function fieldVis(key: string): 'required' | 'optional' | 'hidden' {
    if (fieldConfigs.length === 0) return key === 'title' ? 'required' : 'optional'
    return (fieldConfigs.find(c => c.field_key === key)?.visibility ?? 'optional') as 'required' | 'optional' | 'hidden'
  }
  function show(key: string) { return fieldVis(key) !== 'hidden' }
  function req(key: string) { return fieldVis(key) === 'required' }

  const inputCls = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 focus:border-brand-700 focus:ring-2 focus:ring-brand-700/20 focus:outline-none transition-colors'

  return (
    <div className="max-w-xl mx-auto flex flex-col gap-2 pb-12">
      <Link href={companyIdParam ? `/companies/${companyIdParam}` : '/pipeline'}
        className="text-xs text-gray-400 hover:text-gray-600 no-underline transition-colors">
        ← Voltar
      </Link>
      <div className="mb-2">
        <h1 className="text-xl font-semibold text-gray-900">
          {pipelineType === 'vendas' ? 'Nova Oportunidade' : 'Novo Contrato'}
        </h1>
        {pipelineName && <p className="text-sm text-gray-500 mt-0.5">Funil: {pipelineName}</p>}
        {fieldConfigs.length > 0 && (
          <p className="text-xs text-gray-400 mt-1">
            Campos com <span className="text-red-600">*</span> são obrigatórios para este funil.
          </p>
        )}
      </div>

      <form action={formAction} className="flex flex-col space-y-5 bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        {show('title') && (
          <div>
            <label className="block text-sm font-medium text-gray-700">Título {req('title') && <span style={{ color: '#b91c1c' }}>*</span>}</label>
            <input name="title" required={req('title')} className={inputCls} />
          </div>
        )}

        <CompanyContactSection preselectedCompanyId={companyIdParam ?? undefined} />

        {/* CNPJ da ORBIS removido — preenchido silenciosamente no submit */}

        {/* Tag */}
        {show('tag') && tags.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700">Tag / Etiqueta {req('tag') && <span style={{ color: '#b91c1c' }}>*</span>}</label>
            <select name="tag_id" required={req('tag')} className={inputCls}>
              <option value="">Sem tag</option>
              {tags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        )}

        {/* Classificação removida do formulário de entrada */}

        {show('segment') && (
          <div>
            <label className="block text-sm font-medium text-gray-700">Segmento {req('segment') && <span style={{ color: '#b91c1c' }}>*</span>}</label>
            <select name="segment" required={req('segment')} className={inputCls}>
              <option value="">Selecione...</option>
              <option value="hospitalar_geral">Grupo Hospitalar (Geral e especializado)</option>
              <option value="diagnostico">Grupo Diagnóstico (imagem e laboratório)</option>
              <option value="clinicas_outros">Grupo Clínicas e Outros</option>
            </select>
          </div>
        )}

        {/* Valor */}
        {show('value') && (
          <div>
            <label className="block text-sm font-medium text-gray-700">Valor estimado (R$) {req('value') && <span style={{ color: '#b91c1c' }}>*</span>}</label>
            <input name="value" type="number" step="0.01" min="0" defaultValue={0} required={req('value')} className={inputCls} />
          </div>
        )}

        {/* Tipo de receita MRR vs Spot */}
        {show('revenue_type') && (
          <div>
            <label className="block text-sm font-medium text-gray-700">Tipo de Receita {req('revenue_type') && <span style={{ color: '#b91c1c' }}>*</span>}</label>
            <select name="revenue_type" required={req('revenue_type')} className={inputCls}>
              <option value="">Selecione...</option>
              <option value="mrr">MRR — Recorrente mensal</option>
              <option value="spot">Spot — Avulso / único</option>
            </select>
          </div>
        )}

        {/* Cadastro direto no funil Contratos: exige o responsável pela conta
            (no fluxo normal ele é definido ao dar ganho em Mercado Privado/Público) */}
        {pipelineType === 'gestao_contratos' && (
          <div>
            <label className="block text-sm font-medium text-gray-700">Consultor responsável pela conta <span style={{ color: '#b91c1c' }}>*</span></label>
            <select name="account_owner_id" required className={inputCls} defaultValue="">
              <option value="">Selecione quem cuida da conta (retenção)...</option>
              {accountOwners.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
            <p className="mt-1 text-xs text-gray-400">Recebe as atividades de renovação e os alertas deste contrato.</p>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700">Etapa inicial <span style={{ color: '#b91c1c' }}>*</span></label>
          <select name="stage_id" required className={inputCls}>
            <option value="">Selecione...</option>
            {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {pipelineId && stages.length === 0 && <p style={{ marginTop: 4, fontSize: 11, color: '#92400e' }}>Nenhuma etapa cadastrada neste funil.</p>}
        </div>

        {show('source') && (
          <div>
            <label className="block text-sm font-medium text-gray-700">Origem da negociação {req('source') && <span style={{ color: '#b91c1c' }}>*</span>}</label>
            <select name="source" required={req('source')} className={inputCls}>
              <option value="">Selecione...</option>
              {SOURCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        )}

        {show('expected_close_date') && (
          <div>
            <label className="block text-sm font-medium text-gray-700">Previsão de fechamento {req('expected_close_date') && <span style={{ color: '#b91c1c' }}>*</span>}</label>
            <input name="expected_close_date" type="date" required={req('expected_close_date')} className={inputCls} />
          </div>
        )}

        {show('description') && (
          <div>
            <label className="block text-sm font-medium text-gray-700">Descrição {req('description') && <span style={{ color: '#b91c1c' }}>*</span>}</label>
            <textarea name="description" rows={3} required={req('description')} className={inputCls} />
          </div>
        )}

        <input type="hidden" name="pipeline_id" value={pipelineId ?? ''} />

        {state.error && <p className="text-xs text-red-600">{state.error}</p>}

        <button type="submit" disabled={pending}
          className="w-full rounded-lg bg-gray-900 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">
          {pending ? 'Salvando...' : pipelineType === 'vendas' ? 'Criar Oportunidade' : 'Criar Contrato'}
        </button>
      </form>
    </div>
  )
}