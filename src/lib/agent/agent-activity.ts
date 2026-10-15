// ─── Atividades abertas pelo Copiloto IA ─────────────────────────────────────
// Cria uma atividade PLANEJADA no mesmo formato da tela do CRM (título,
// responsável, data, status 'planned'), para aparecer em "Planejadas".
//
// - tenant_id vem do contrato (o agente roda com service role, sem JWT)
// - dedupe_key evita duplicar: se já existe atividade do Copiloto ainda
//   planejada com a mesma chave, não cria outra

import type { SupabaseClient } from '@supabase/supabase-js'

export type AgentActivityInput = {
  contractId: string
  dedupeKey: string                 // ex.: "renewal:2026-10-27:15"
  title: string
  content: string
  activityType?: 'task' | 'whatsapp' | 'call' | 'email'
  dueInDays?: number                // activity_date = hoje + N
  assignedTo?: string | null        // profile id do responsável
  metadata?: Record<string, unknown>
  agent?: AgentName                 // quem abriu; sem isso, deduz pelo funil atual
}

// Farmer = carteira (contratos, renovação, medição, implantação, satisfação)
// Hunter = novos negócios (leads, oportunidades, propostas, avulso)
export type AgentName = 'farmer' | 'hunter'
export const AGENT_LABEL: Record<AgentName, string> = { farmer: 'Farmer', hunter: 'Hunter' }

export function agentForPipelineType(type: string | null | undefined): AgentName {
  return type === 'vendas' || type === 'servico_avulso' ? 'hunter' : 'farmer'
}

export type AgentActivityResult =
  | { status: 'created'; id: string }
  | { status: 'skipped'; reason: string }
  | { status: 'error'; error: string }

function dateInDays(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  // data local de Brasília (UTC-3) no formato YYYY-MM-DD
  return new Date(d.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any, any, any>

export async function createAgentActivity(
  supabase: AnySupabase,
  input: AgentActivityInput,
): Promise<AgentActivityResult> {
  // 1. tenant do contrato
  const { data: contract, error: cErr } = await supabase
    .from('contracts')
    .select('tenant_id')
    .eq('id', input.contractId)
    .maybeSingle()
  if (cErr) return { status: 'error', error: cErr.message }
  if (!contract?.tenant_id) return { status: 'skipped', reason: 'contrato não encontrado' }

  // 2. dedupe — atividade do Copiloto ainda aberta com a mesma chave
  const { data: open, error: oErr } = await supabase
    .from('activities')
    .select('id')
    .eq('contract_id', input.contractId)
    .eq('metadata->>source', 'copiloto_ia')
    .eq('metadata->>dedupe_key', input.dedupeKey)
    .neq('status', 'done')
    .limit(1)
  if (oErr) return { status: 'error', error: oErr.message }
  if (open && open.length > 0) return { status: 'skipped', reason: 'já existe atividade aberta' }

  // 3. agente responsável: informado ou pelo funil em que o contrato está agora
  let agent: AgentName | undefined = input.agent
  if (!agent) {
    const { data: openRun } = await supabase
      .from('pipeline_runs').select('pipeline_id').eq('contract_id', input.contractId).eq('status', 'open').limit(1).maybeSingle()
    let ptype: string | null = null
    if (openRun?.pipeline_id) {
      const { data: p } = await supabase.from('pipelines').select('type').eq('id', openRun.pipeline_id).maybeSingle()
      ptype = (p?.type as string | undefined) ?? null
    }
    agent = agentForPipelineType(ptype)
  }
  const prefix = `${AGENT_LABEL[agent]} · `

  // 4. cria no formato da tela
  const agentUserId = process.env.AGENT_USER_ID ?? null
  const row = {
      contract_id:   input.contractId,
      tenant_id:     contract.tenant_id,
      user_id:       agentUserId,
      assigned_to:   input.assignedTo ?? agentUserId,
      type:          'task',
      activity_type: input.activityType ?? 'task',
      title:         input.title.startsWith(prefix) ? input.title : prefix + input.title,
      content:       input.content,
      status:        'planned',
      completed:     false,
      activity_date: dateInDays(input.dueInDays ?? 2),
      metadata: {
        source:       'copiloto_ia',
        agent,
        auto_created: true,
        dedupe_key:   input.dedupeKey,
        ...(input.metadata ?? {}),
      },
  }

  let { data, error } = await supabase.from('activities').insert(row).select('id').single()

  // AGENT_USER_ID inválido (FK em profiles) → tenta sem autor
  if (error?.code === '23503' && agentUserId) {
    console.warn('[agent-activity] AGENT_USER_ID inválido, criando sem autor:', error.message)
    const retry = await supabase
      .from('activities')
      .insert({ ...row, user_id: null, assigned_to: input.assignedTo ?? null })
      .select('id')
      .single()
    data = retry.data
    error = retry.error
  }

  if (error || !data) return { status: 'error', error: error?.message ?? 'insert sem retorno' }
  return { status: 'created', id: data.id }
}
