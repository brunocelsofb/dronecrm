import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/auth/role'
import { getPipelineFieldConfigs } from '@/lib/pipeline-field-config'
import { PipelineFieldConfigForm } from '@/components/settings/pipeline-field-config-form'
import Link from 'next/link'

export default async function CamposOportunidadePage({
  searchParams,
}: {
  searchParams: Promise<{ pipeline?: string }>
}) {
  const profile = await getCurrentProfile()
  if (profile?.role !== 'admin') redirect('/')

  const { pipeline: selectedPipelineId } = await searchParams
  const supabase = await createClient()

  const { data: pipelinesRaw } = await supabase.from('pipelines').select('id, name, type').order('name')
  const TYPE_ORDER: Record<string, number> = { vendas: 0, gestao_contratos: 1, servico_avulso: 2 }
  const pipelines = (pipelinesRaw ?? []).sort((a, b) => {
    const ao = TYPE_ORDER[a.type] ?? 9
    const bo = TYPE_ORDER[b.type] ?? 9
    if (ao !== bo) return ao - bo
    return a.name.localeCompare(b.name, 'pt-BR')
  })

  const activePipelineId = selectedPipelineId ?? pipelines?.[0]?.id
  const configs = activePipelineId ? await getPipelineFieldConfigs(activePipelineId) : []
  const { data: customFields } = await supabase.from('custom_fields').select('id, name, field_key').order('name')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 800 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 500, color: '#1a1f36', margin: '4px 0 0' }}>Campos por Funil</h1>
          <p style={{ fontSize: 12, color: '#8892a4', marginTop: 3 }}>
            Defina quais campos aparecem no formulário de nova oportunidade de cada funil, e se são obrigatórios.
          </p>
        </div>
      </div>

      {/* Seletor de funil */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {(pipelines ?? []).map(p => (
          <Link key={p.id} href={`/settings/campos-oportunidade?pipeline=${p.id}`}
            style={{
              padding: '6px 14px', fontSize: 12, borderRadius: 20, textDecoration: 'none',
              border: '0.5px solid',
              borderColor: p.id === activePipelineId ? '#1a1f36' : '#d1d8e8',
              background: p.id === activePipelineId ? '#1a1f36' : '#fff',
              color: p.id === activePipelineId ? '#fff' : '#8892a4',
            }}>
            {p.name}
          </Link>
        ))}
      </div>

      {activePipelineId && (
        <PipelineFieldConfigForm
          key={activePipelineId}
          pipelineId={activePipelineId}
          initialConfigs={configs}
          customFields={customFields ?? []}
        />
      )}
    </div>
  )
}
