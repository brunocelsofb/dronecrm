'use server'

// Serviço avulso: relatório final anexado ANTES do ganho → o Hunter abre a
// tarefa para o consultor dar ganho. No ganho (closeRun) o envio para
// faturamento é automático (sem validação mensal, como nos contratos).

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { resolveTenantId } from '@/lib/tenant/context'
import { createAgentActivity } from '@/lib/agent/agent-activity'
import { brl } from '@/lib/revenue/measurement'

export async function attachAvulsoReport(contractId: string, storagePath: string, fileName: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) return { ok: false, error: 'Usuário não autenticado.' }
  const tenantId = await resolveTenantId({ contractId })
  const db = await createScopedAdmin(tenantId)

  const [{ data: contract }, { data: run }, { data: file }] = await Promise.all([
    db.from('contracts').select('id, client_name, owner_id, current_assignee_id').eq('id', contractId).maybeSingle(),
    db.from('pipeline_runs').select('id, value, pipeline_id').eq('contract_id', contractId).eq('status', 'open').maybeSingle(),
    db.from('contract_files').select('id').eq('contract_id', contractId).eq('storage_path', storagePath).maybeSingle(),
  ])
  if (!contract) return { ok: false, error: 'Oportunidade não encontrada.' }
  if (!run) return { ok: false, error: 'Não há passagem aberta no funil.' }
  const { data: pipe } = await db.from('pipelines').select('type').eq('id', run.pipeline_id).maybeSingle()
  if (pipe?.type !== 'servico_avulso') return { ok: false, error: 'O relatório final é do funil de serviço avulso.' }
  if (!file) return { ok: false, error: 'O relatório não foi encontrado nos arquivos. Envie de novo.' }

  const { error } = await db.from('pipeline_runs').update({ report_storage_path: storagePath, report_file_name: fileName }).eq('id', run.id)
  if (error) return { ok: false, error: error.message }

  const value = Number(run.value) || 0
  await createAgentActivity(createAdminClient(), {
    contractId,
    dedupeKey: `avulso-report:${run.id}`,
    agent: 'hunter',
    activityType: 'task',
    dueInDays: 1,
    assignedTo: contract.owner_id ?? contract.current_assignee_id ?? user.id,
    title: `Relatório anexado — dar ganho · ${contract.client_name ?? 'cliente'}`,
    content:
      `O relatório final do serviço foi anexado ("${fileName}").\n` +
      `Valor fechado: ${value > 0 ? brl(value) : 'não informado — preencha o valor antes do ganho'}.\n\n` +
      `Confira o valor e dê o ganho: o envio para faturamento é automático.`,
    metadata: { kind: 'avulso_report', run_id: run.id },
  })
  await db.from('activities').insert({
    contract_id: contractId, user_id: user.id, type: 'system',
    content: `📎 Relatório final do serviço anexado: ${fileName}.`,
    metadata: { kind: 'avulso_report', run_id: run.id },
  })
  revalidatePath(`/contracts/${contractId}`)
  return { ok: true }
}
