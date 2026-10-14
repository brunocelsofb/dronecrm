// Licença nova: nasce com um funil básico (vendas → contratos) e motivos de
// perda padrão. Configurações em branco; WhatsApp e Copiloto desligados até
// a empresa cadastrar. Tudo pode ser ajustado em Funis e Etapas.

import { createAdminClient } from '@/lib/supabase/admin'

const SALES_STAGES = ['Prospecção', 'Qualificação', 'Proposta', 'Negociação', 'Fechamento']
const CONTRACT_STAGES = ['Implantação', 'Acompanhamento', 'Renovação', 'Rescisão']
const LOST_REASONS = ['Preço', 'Concorrente', 'Sem orçamento', 'Timing', 'Sem retorno', 'Sem fit']

export async function seedTenantDefaults(tenantId: string): Promise<{ ok: boolean; error?: string }> {
  const admin = createAdminClient()
  const { count } = await admin.from('pipelines').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId)
  if ((count ?? 0) > 0) return { ok: true } // já tem funil

  const { data: contractsPipe, error: e1 } = await admin.from('pipelines')
    .insert({ tenant_id: tenantId, name: 'Contratos', type: 'gestao_contratos', won_label: 'Renovado', lost_label: 'Rescindido' })
    .select('id').single()
  if (e1 || !contractsPipe) return { ok: false, error: e1?.message ?? 'pipeline Contratos' }

  const { error: e2 } = await admin.from('stages').insert(CONTRACT_STAGES.map((name, i) => ({
    tenant_id: tenantId, pipeline_id: contractsPipe.id, name, order_index: i + 1,
    is_won: name === 'Renovação', is_lost: name === 'Rescisão',
  })))
  if (e2) return { ok: false, error: e2.message }

  const { data: salesPipe, error: e3 } = await admin.from('pipelines')
    .insert({ tenant_id: tenantId, name: 'Vendas', type: 'vendas', won_label: 'Ganho', lost_label: 'Perdido', won_target_pipeline_id: contractsPipe.id })
    .select('id').single()
  if (e3 || !salesPipe) return { ok: false, error: e3?.message ?? 'pipeline Vendas' }

  const { error: e4 } = await admin.from('stages').insert(SALES_STAGES.map((name, i) => ({
    tenant_id: tenantId, pipeline_id: salesPipe.id, name, order_index: i + 1,
    is_won: name === 'Fechamento', is_lost: true,
  })))
  if (e4) return { ok: false, error: e4.message }

  const { error: e5 } = await admin.from('lost_reasons').insert(LOST_REASONS.map(name => ({ tenant_id: tenantId, name })))
  if (e5) return { ok: false, error: e5.message }

  return { ok: true }
}
