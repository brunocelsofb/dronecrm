import { createAdminClient } from '@/lib/supabase/admin'
import { TabOrderEditorByPipeline } from '@/components/settings/tab-order-editor'
import { resolveTenantId } from '@/lib/tenant/context'

export const ALL_CONTRACT_TABS = [
  { id: 'visao-geral', label: 'Visão Geral' },
  { id: 'atividades', label: 'Atividades' },
  { id: 'emails', label: 'E-mails' },
  { id: 'arquivos', label: 'Arquivos' },
  { id: 'implantacao', label: '🚀 Implantação' },
  { id: 'pesquisas', label: 'Pesquisas' },
  { id: 'carteira', label: 'Carteira' },
]

function getDefaultHidden(name: string): string[] {
  const n = name.toLowerCase()
  if (n.includes('contrato') || n.includes('gestão')) return []
  if (n.includes('avulso')) return ['implantacao', 'pesquisas', 'carteira', 'emails']
  return ['implantacao', 'carteira', 'pesquisas']
}

export default async function LayoutAbasPage() {
  let config: Record<string, any> = {}
  let pipelinesWithDefaults: { id: string; name: string; defaultHidden: string[] }[] = []

  try {
    const admin = createAdminClient()
    const [{ data: settings }, { data: pipelines }] = await Promise.all([
      admin.from('organization_settings').select('pipeline_tab_config').eq('tenant_id', await resolveTenantId()).maybeSingle(),
      admin.from('pipelines').select('id, name').order('name'),
    ])
    config = (settings as any)?.pipeline_tab_config ?? {}
    pipelinesWithDefaults = (pipelines ?? []).map((p: any) => ({
      id: p.id,
      name: p.name,
      defaultHidden: getDefaultHidden(p.name),
    }))
  } catch (e) {
    console.error('[layout-abas] erro:', e)
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Layout das Abas por Funil</h1>
        <p className="mt-0.5 text-sm text-gray-500">Configure a ordem e visibilidade das abas para cada funil.</p>
      </div>
      <TabOrderEditorByPipeline
        allTabs={ALL_CONTRACT_TABS}
        pipelines={pipelinesWithDefaults}
        savedConfig={config}
      />
    </div>
  )
}
