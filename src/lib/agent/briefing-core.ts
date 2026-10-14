/**
 * Copiloto Estratégico — Lógica de negócio partilhada
 *
 * Schema: contract_crm (customizado, não "public")
 * O agente actua como consultor comercial: identifica situações por NOME,
 * gera acções concretas e cria tarefas directamente no CRM.
 */

import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { createAgentActivity } from './agent-activity'
import { differenceInDays, format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

// ─── Schema ───────────────────────────────────────────────────────────────────
const SCHEMA = 'contract_crm'

// ─── Tipos públicos ────────────────────────────────────────────────────────────

/** Contrato/oportunidade sem actividade no funil de vendas */
export type DormantRun = {
  contract_id:      string
  process_number:   string
  client_name:      string
  value:            number | null
  stage_name:       string | null
  pipeline_name:    string | null
  days_idle:        number
  last_activity_at: string | null
  owner_name:       string | null
}

/** Contrato a vencer ou já vencido */
export type RenewalCandidate = {
  id:                string
  process_number:    string
  client_name:       string
  valid_until:       string | null
  days_until_expiry: number | null
  stage_name:        string | null
  run_status:        string | null
}

/** Lead parado sem qualificação */
export type StaleLead = {
  id:                 string
  name:               string
  company_name:       string | null
  status:             string
  score:              number
  source:             string | null
  days_since_update:  number
  days_since_created: number
}

/** Proposta parada aguardando acção */
export type StuckProposal = {
  id:             string
  control_code:   string
  client_name:    string
  status:         string
  status_label:   string
  days_waiting:   number
  total_value:    number | null
  pending_approver: string | null
}

/** Plano de acção com itens pendentes */
export type PendingActionPlan = {
  contract_id:  string
  process_number: string
  client_name:  string
  pending_count: number
  oldest_days:  number
  departments:  string[]
}

/** Resumo de stats para os KPIs do dashboard */
export type BriefingStats = {
  dormantOpportunities: number
  renewalCandidates:    number
  staleLeads:           number
  stuckProposals:       number
  pendingActionPlans:   number
  tokensInput:          number
  tokensOutput:         number
}

export type WhatsAppResult =
  | { sent: true;  statusCode: number }
  | { sent: false; error: string }

export type BriefingResult = {
  ok:             true
  generatedAt:    string
  stats:          BriefingStats
  briefing:       string
  tasksCreated:   number
  whatsapp:       WhatsAppResult
}

export type BriefingError = {
  ok:    false
  error: string
}

// ─── Cliente Supabase admin ────────────────────────────────────────────────────
function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      db:   { schema: SCHEMA },
    }
  )
}

// ─── Query 1: Oportunidades dormentes no funil de vendas ──────────────────────
export async function fetchDormantOpportunities(
  supabase: ReturnType<typeof getAdminClient>
): Promise<DormantRun[]> {
  // Busca runs abertas em pipelines de vendas
  const { data: runs, error: runsErr } = await supabase
    .from('pipeline_runs')
    .select(`
      id, contract_id, stage_id, stage_entered_at, value, pipeline_id,
      contracts!inner(id, process_number, client_name, owner_id),
      stages(name),
      pipelines!inner(name, type)
    `)
    .eq('status', 'open')
    .eq('pipelines.type', 'vendas')

  if (runsErr) {
    console.error('[agent] erro pipeline_runs:', runsErr.message)
    // Tenta sem o join de pipelines para ver quantos runs existem
    const { data: fallback } = await supabase
      .from('pipeline_runs')
      .select('id, contract_id, stage_id, stage_entered_at, value')
      .eq('status', 'open')
    console.warn(`[agent] fallback: ${fallback?.length ?? 0} runs abertas no total (qualquer pipeline)`)
    return []
  }

  if (!runs || runs.length === 0) {
    console.warn('[agent] nenhuma run aberta em pipeline de vendas — verifica se o campo type está preenchido')
    return []
  }

  const contractIds = runs.map((r: { contract_id: string }) => r.contract_id)

  // Última actividade por contrato
  const { data: lastActivities } = await supabase
    .from('activities')
    .select('contract_id, created_at')
    .in('contract_id', contractIds)
    .order('created_at', { ascending: false })

  const lastActivityByContract = new Map<string, string>()
  for (const a of lastActivities ?? []) {
    if (!lastActivityByContract.has(a.contract_id))
      lastActivityByContract.set(a.contract_id, a.created_at)
  }

  // Nomes dos owners
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ownerIds = [...new Set(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (runs as any[]).map((r: any) => {
      const c = Array.isArray(r.contracts) ? r.contracts[0] : r.contracts
      return c?.owner_id as string | undefined
    }).filter(Boolean) as string[]
  )]
  const { data: profiles } = ownerIds.length
    ? await supabase.from('profiles').select('id, full_name').in('id', ownerIds)
    : { data: [] as { id: string; full_name: string }[] }

  const ownerNameById = new Map(
    (profiles ?? []).map((p: { id: string; full_name: string }) => [p.id, p.full_name])
  )

  const dormant: DormantRun[] = []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const run of runs as any[]) {
    const rawContract    = Array.isArray(run.contracts) ? run.contracts[0] : run.contracts
    const contract       = rawContract as { id: string; process_number: string; client_name: string; owner_id: string } | null
    const lastActivityAt = lastActivityByContract.get(run.contract_id as string) ?? null
    const referenceDate  = lastActivityAt ?? (run.stage_entered_at as string | null) ?? new Date(0).toISOString()
    const daysIdle       = differenceInDays(new Date(), new Date(referenceDate))

    if (daysIdle >= 14) {
      const rawStage    = Array.isArray(run.stages)    ? run.stages[0]    : run.stages
      const rawPipeline = Array.isArray(run.pipelines) ? run.pipelines[0] : run.pipelines
      dormant.push({
        contract_id:      run.contract_id as string,
        process_number:   contract?.process_number ?? '',
        client_name:      contract?.client_name ?? '(sem nome)',
        value:            (run.value as number | null) ?? null,
        stage_name:       (rawStage as { name: string } | null)?.name ?? null,
        pipeline_name:    (rawPipeline as { name: string } | null)?.name ?? null,
        days_idle:        daysIdle,
        last_activity_at: lastActivityAt,
        owner_name:       (ownerNameById.get(String(contract?.owner_id ?? '')) ?? null) as string | null,
      })
    }
  }

  return dormant.sort((a, b) => b.days_idle - a.days_idle).slice(0, 10)
}

// ─── Query 2: Contratos a vencer ─────────────────────────────────────────────
export async function fetchRenewalCandidates(
  supabase: ReturnType<typeof getAdminClient>
): Promise<RenewalCandidate[]> {
  const today    = new Date()
  const in90Days = new Date(today)
  in90Days.setDate(in90Days.getDate() + 90)

  // Inclui já vencidos (valid_until no passado) e a vencer em 90 dias
  const { data, error } = await supabase
    .from('contracts')
    .select(`
      id, process_number, client_name, valid_until,
      pipeline_runs!left(stage_id, status, stages(name))
    `)
    .lte('valid_until', in90Days.toISOString().slice(0, 10))
    .not('valid_until', 'is', null)
    .order('valid_until', { ascending: true })
    .limit(20)

  if (error) { console.error('[agent] erro renovações:', error.message); return [] }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((c: any) => {
    const runs    = (c.pipeline_runs ?? []) as { stage_id: string; status: string; stages: { name: string }[] | null }[]
    const openRun = runs.find(r => r.status === 'open')
    const rawStages = openRun?.stages
    const stageName = Array.isArray(rawStages) ? (rawStages[0] as { name: string } | undefined)?.name ?? null
                    : (rawStages as { name: string } | null | undefined)?.name ?? null
    return {
      id:                c.id as string,
      process_number:    c.process_number as string,
      client_name:       c.client_name as string,
      valid_until:       (c.valid_until as string | null) ?? null,
      days_until_expiry: c.valid_until ? differenceInDays(new Date(c.valid_until as string), today) : null,
      stage_name:        stageName,
      run_status:        openRun?.status ?? null,
    }
  })
}

// ─── Query 3: Leads estagnados ─────────────────────────────────────────────────
export async function fetchStaleLeds(
  supabase: ReturnType<typeof getAdminClient>
): Promise<StaleLead[]> {
  // Leads sem actualização há 30 dias
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 30)

  const { data, error } = await supabase
    .from('leads')
    .select('id, name, company_name, status, score, source, created_at, updated_at')
    .in('status', ['novo', 'em_qualificacao'])
    .lt('updated_at', cutoff.toISOString())
    .order('score', { ascending: false })
    .limit(10)

  if (error) { console.error('[agent] erro leads:', error.message); return [] }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((l: any) => ({
    id:                 l.id as string,
    name:               l.name as string,
    company_name:       (l.company_name as string | null) ?? null,
    status:             l.status as string,
    score:              l.score as number,
    source:             (l.source as string | null) ?? null,
    days_since_update:  differenceInDays(new Date(), new Date(l.updated_at as string)),
    days_since_created: differenceInDays(new Date(), new Date(l.created_at as string)),
  }))
}

// ─── Query 4: Propostas paradas (aguardando aprovação interna ou cliente) ─────
export async function fetchStuckProposals(
  supabase: ReturnType<typeof getAdminClient>
): Promise<StuckProposal[]> {
  const STATUS_LABELS: Record<string, string> = {
    draft:               'Rascunho',
    pending_technical:   'Aguardando Aprovação Técnica',
    pending_commercial:  'Aguardando Aprovação Comercial',
    declined_internal:   'Recusada Internamente',
    pending_client:      'Aguardando Cliente',
    approved:            'Aprovada',
    declined_client:     'Recusada pelo Cliente',
  }

  // Propostas abertas há mais de 5 dias sem avanço
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 5)

  const { data, error } = await supabase
    .from('proposals')
    .select(`
      id, control_code, status, created_at, updated_at,
      assigned_technical_approver_id, assigned_commercial_approver_id,
      contracts!inner(client_name),
      proposal_items(subtotal)
    `)
    .in('status', ['pending_technical', 'pending_commercial', 'pending_client', 'draft'])
    .lt('updated_at', cutoff.toISOString())
    .order('updated_at', { ascending: true })
    .limit(10)

  if (error) { console.error('[agent] erro propostas:', error.message); return [] }

  // Busca nomes dos aprovadores
  const approverIds = new Set<string>()
  for (const p of data ?? []) {
    if (p.assigned_technical_approver_id)  approverIds.add(p.assigned_technical_approver_id)
    if (p.assigned_commercial_approver_id) approverIds.add(p.assigned_commercial_approver_id)
  }

  const { data: approverProfiles } = approverIds.size
    ? await supabase.from('profiles').select('id, full_name').in('id', [...approverIds])
    : { data: [] as { id: string; full_name: string }[] }

  const approverNameById = new Map(
    (approverProfiles ?? []).map((p: { id: string; full_name: string }) => [p.id, p.full_name])
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((p: any) => {
    const rawContract  = Array.isArray(p.contracts) ? p.contracts[0] : p.contracts
    const clientName   = (rawContract as { client_name: string } | null)?.client_name ?? '(sem cliente)'
    const items        = (p.proposal_items ?? []) as { subtotal: number }[]
    const totalValue   = items.reduce((s, i) => s + (i.subtotal ?? 0), 0)
    const pendingApprover =
      p.status === 'pending_technical'  ? approverNameById.get(p.assigned_technical_approver_id ?? '') ?? 'Técnico não designado'
      : p.status === 'pending_commercial' ? approverNameById.get(p.assigned_commercial_approver_id ?? '') ?? 'Comercial não designado'
      : null

    return {
      id:               p.id as string,
      control_code:     p.control_code as string,
      client_name:      clientName,
      status:           p.status as string,
      status_label:     STATUS_LABELS[p.status as string] ?? (p.status as string),
      days_waiting:     differenceInDays(new Date(), new Date(p.updated_at as string)),
      total_value:      totalValue || null,
      pending_approver: pendingApprover,
    }
  })
}

// ─── Query 5: Planos de acção com itens pendentes há muito tempo ──────────────
export async function fetchPendingActionPlans(
  supabase: ReturnType<typeof getAdminClient>
): Promise<PendingActionPlan[]> {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 7)

  const { data, error } = await supabase
    .from('action_plan_items')
    .select(`
      id, contract_id, responsible_department, status, created_at,
      contracts!inner(process_number, client_name)
    `)
    .in('status', ['pending', 'in_progress'])
    .lt('created_at', cutoff.toISOString())

  if (error) { console.error('[agent] erro action_plan:', error.message); return [] }

  // Agrupa por contrato
  const byContract = new Map<string, {
    process_number: string; client_name: string
    items: { created_at: string; dept: string | null }[]
  }>()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const item of (data ?? []) as any[]) {
    const key        = item.contract_id as string
    const rawContract = Array.isArray(item.contracts) ? item.contracts[0] : item.contracts
    if (!byContract.has(key)) {
      byContract.set(key, {
        process_number: (rawContract as { process_number: string } | null)?.process_number ?? '',
        client_name:    (rawContract as { client_name: string } | null)?.client_name ?? '',
        items:          [],
      })
    }
    byContract.get(key)!.items.push({
      created_at: item.created_at as string,
      dept:       (item.responsible_department as string | null) ?? null,
    })
  }

  const result: PendingActionPlan[] = []
  for (const [contract_id, { process_number, client_name, items }] of byContract) {
    const oldestDays = Math.max(...items.map(i => differenceInDays(new Date(), new Date(i.created_at))))
    const departments = [...new Set(items.map(i => i.dept).filter(Boolean))] as string[]
    result.push({ contract_id, process_number, client_name, pending_count: items.length, oldest_days: oldestDays, departments })
  }

  return result.sort((a, b) => b.oldest_days - a.oldest_days).slice(0, 8)
}

// ─── Criar tarefa no CRM em nome do agente ────────────────────────────────────
// Usa createAgentActivity: formato de atividade planejada da tela do CRM,
// tenant_id do contrato e sem duplicar (uma aberta por contrato e tipo).
type AgentTaskKind = 'dormant' | 'proposal'

async function createAgentTask(
  supabase: ReturnType<typeof getAdminClient>,
  contractId: string,
  kind: AgentTaskKind,
  content: string,
  dueInDays = 2
): Promise<boolean> {
  const title = kind === 'dormant'
    ? 'Retomar oportunidade parada'
    : 'Cobrar aprovação de proposta parada'
  const r = await createAgentActivity(supabase, {
    contractId,
    dedupeKey: `briefing:${kind}`,
    title,
    content,
    dueInDays,
    activityType: 'task',
    metadata: { kind },
  })
  if (r.status === 'error') console.error(`[agent] erro ao criar tarefa ${kind} (${contractId}):`, r.error)
  if (r.status === 'skipped') console.log(`[agent] tarefa ${kind} para ${contractId} não criada: ${r.reason}`)
  return r.status === 'created'
}

// ─── Avisos de renovação: enviados e aguardando envio ─────────────────────────
// Seção fixa do briefing (montada direto dos dados, sem passar pelo modelo).
export async function buildRenewalSendsSection(
  supabase: ReturnType<typeof getAdminClient>,
  sinceIso: string,
): Promise<string> {
  const { data: rows } = await supabase
    .from('activities')
    .select('id, contract_id, assigned_to, metadata, created_at')
    .in('metadata->>kind', ['renewal_alert', 'renewal_confirmation'])
    .in('metadata->>approval', ['sent', 'pending'])
    .limit(300)

  type Meta = { kind?: string; approval?: string; sent_at?: string; sent_by?: string; alert_level?: number; contact_name?: string }
  const all = (rows ?? []) as { id: string; contract_id: string | null; assigned_to: string | null; metadata: Meta; created_at: string }[]
  const sent = all.filter(a => a.metadata.approval === 'sent' && (a.metadata.sent_at ?? '') >= sinceIso)
  const pending = all.filter(a => a.metadata.approval === 'pending')
  if (sent.length === 0 && pending.length === 0) return ''

  const contractIds = [...new Set([...sent, ...pending].map(a => a.contract_id).filter(Boolean))] as string[]
  const userIds = [...new Set([...sent.map(a => a.metadata.sent_by), ...pending.map(a => a.assigned_to)].filter(Boolean))] as string[]
  const [{ data: contracts }, { data: users }] = await Promise.all([
    contractIds.length ? supabase.from('contracts').select('id, process_number, client_name').in('id', contractIds) : Promise.resolve({ data: [] }),
    userIds.length ? supabase.from('profiles').select('id, full_name').in('id', userIds) : Promise.resolve({ data: [] }),
  ])
  const cById = new Map(((contracts ?? []) as { id: string; process_number: string | null; client_name: string }[]).map(c => [c.id, c]))
  const uById = new Map(((users ?? []) as { id: string; full_name: string | null }[]).map(u => [u.id, u.full_name ?? '']))

  const what = (m: Meta) => m.kind === 'renewal_confirmation' ? 'renovação concluída' : m.alert_level === 0 ? 'vencido' : `${m.alert_level} dias`
  const who = (id: string | null | undefined) => (id && uById.get(id)) || '(sem responsável)'
  const contractLabel = (id: string | null) => {
    const c = id ? cById.get(id) : null
    return c ? `${c.client_name}${c.process_number ? ` (${c.process_number})` : ''}` : '(contrato)'
  }
  const nowMs = Date.now()

  const lines: string[] = ['📨 AVISOS DE RENOVAÇÃO AO CLIENTE']
  if (sent.length) {
    lines.push(`Enviados desde o último briefing (${sent.length}):`)
    for (const a of sent.sort((x, y) => (x.metadata.sent_at ?? '').localeCompare(y.metadata.sent_at ?? ''))) {
      const when = new Date(a.metadata.sent_at!).toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
      })
      lines.push(`• ${contractLabel(a.contract_id)} — ${what(a.metadata)} — por ${who(a.metadata.sent_by)} em ${when}`)
    }
  } else {
    lines.push('Nenhum aviso enviado desde o último briefing.')
  }
  if (pending.length) {
    lines.push('', `Aguardando envio do consultor (${pending.length}):`)
    for (const a of pending.sort((x, y) => x.created_at.localeCompare(y.created_at))) {
      const days = Math.floor((nowMs - new Date(a.created_at).getTime()) / 86_400_000)
      lines.push(`• ${contractLabel(a.contract_id)} — ${what(a.metadata)} — ${who(a.assigned_to)} — ${days === 0 ? 'desde hoje' : `há ${days} dia(s)`}`)
    }
  }
  return lines.join('\n')
}

// ─── Prompt builder — consultor comercial, dados por nome ─────────────────────
export function buildPrompt(data: {
  dormant:        DormantRun[]
  renewal:        RenewalCandidate[]
  stale:          StaleLead[]
  proposals:      StuckProposal[]
  actionPlans:    PendingActionPlan[]
  today:          string
}): string {
  const fmt = (rows: unknown[]) =>
    rows.length > 0 ? JSON.stringify(rows, null, 2) : '(nenhum registo nesta categoria hoje)'

  const fmtBRL = (v: number | null) =>
    v != null ? `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '(valor não informado)'

  return `
Você é o Copiloto Estratégico da empresa, actuando como um CONSULTOR COMERCIAL SÉNIOR.
Data de hoje: ${data.today}

Você tem acesso completo ao CRM e deve:
1. Identificar situações críticas PELO NOME do cliente/lead
2. Dar recomendações CONCRETAS com próximo passo específico
3. Priorizar por impacto financeiro e urgência

---

### A. OPORTUNIDADES NO FUNIL SEM TOQUE (${data.dormant.length} identificadas)
${fmt(data.dormant.map(d => ({
  cliente:     d.client_name,
  processo:    d.process_number,
  etapa:       d.stage_name ?? '(sem etapa)',
  funil:       d.pipeline_name ?? '',
  dias_parado: d.days_idle,
  valor:       fmtBRL(d.value),
  responsavel: d.owner_name ?? '(sem responsável)',
  ultima_ativ: d.last_activity_at
    ? `há ${d.days_idle} dias`
    : `desde entrada na etapa`,
})))}

### B. CONTRATOS A VENCER / VENCIDOS (${data.renewal.length} identificados)
${fmt(data.renewal.map(r => ({
  cliente:        r.client_name,
  processo:       r.process_number,
  vencimento:     r.valid_until,
  dias_p_vencer:  r.days_until_expiry !== null
    ? (r.days_until_expiry < 0 ? `VENCIDO há ${Math.abs(r.days_until_expiry)} dias` : `vence em ${r.days_until_expiry} dias`)
    : '(sem data)',
  etapa_atual:    r.stage_name ?? '(sem etapa activa)',
})))}

### C. LEADS SEM QUALIFICAÇÃO (${data.stale.length} identificados)
${fmt(data.stale.map(l => ({
  nome:      l.name,
  empresa:   l.company_name ?? '(sem empresa)',
  status:    l.status,
  score:     l.score,
  origem:    l.source ?? '(sem origem)',
  parado_ha: `${l.days_since_update} dias sem movimentação`,
})))}

### D. PROPOSTAS PARADAS (${data.proposals.length} identificadas)
${fmt(data.proposals.map(p => ({
  cliente:         p.client_name,
  codigo:          p.control_code,
  situacao:        p.status_label,
  aguardando:      p.pending_approver ?? '(cliente ou etapa sem aprovador)',
  dias_aguardando: p.days_waiting,
  valor_total:     fmtBRL(p.total_value),
})))}

### E. PLANOS DE ACÇÃO COM ITENS PENDENTES (${data.actionPlans.length} contratos)
${fmt(data.actionPlans.map(a => ({
  cliente:          a.client_name,
  processo:         a.process_number,
  itens_pendentes:  a.pending_count,
  mais_antigo_ha:   `${a.oldest_days} dias`,
  departamentos:    a.departments.join(', ') || '(sem departamento)',
})))}

---

## SUA TAREFA

Gera um briefing executivo DIRECTO E NOMINAL (sempre diz o nome do cliente/lead).
Actua como um consultor de vendas que vai reportar ao director comercial.

🚨 TOP 3 ACÇÕES URGENTES
Liste as 3 situações mais críticas com:
• Nome do cliente/lead
• O que está parado e porquê é urgente
• Acção concreta a tomar HOJE (quem faz o quê)

💰 MAIOR OPORTUNIDADE DA SEMANA
O negócio com maior impacto financeiro imediato:
• Nome do cliente, valor em jogo
• Contexto da situação actual
• Próximo passo específico

⚠️ SINAL DE ALERTA
Um padrão preocupante que o gestor precisa saber:
• Exemplo: "3 propostas aguardam aprovação técnica há mais de X dias"
• Ou: "Pipeline de vendas tem Y oportunidades paradas na mesma etapa"
• Se não houver nada relevante: "Nenhum padrão crítico detectado esta semana."

📊 SAÚDE DO PIPELINE
Uma linha com os números: X oportunidades activas | Y em risco | Z propostas paradas | W leads para qualificar

---

Regras obrigatórias:
- SEMPRE menciona nomes reais (cliente, lead, responsável)
- Nunca inventa dados ausentes; se faltar um campo, diz "(sem informação)"
- Máximo 350 palavras no total
- Português do Brasil
- Sem markdown pesado — pronto para WhatsApp
- Usa apenas os emojis das secções acima
`.trim()
}

// ─── Criação automática de tarefas após o briefing ────────────────────────────
async function createAutomaticTasks(
  supabase: ReturnType<typeof getAdminClient>,
  data: {
    dormant:     DormantRun[]
    renewal:     RenewalCandidate[]
    proposals:   StuckProposal[]
    actionPlans: PendingActionPlan[]
  }
): Promise<number> {
  let created = 0

  // Tarefa para oportunidades mais críticas (top 3 mais paradas)
  for (const d of data.dormant.slice(0, 3)) {
    const ok = await createAgentTask(
      supabase,
      d.contract_id,
      'dormant',
      `[Copiloto IA] Oportunidade parada há ${d.days_idle} dias na etapa "${d.stage_name ?? 'desconhecida'}". ` +
      `Retomar contato com ${d.client_name} e registar próximo passo até amanhã.`,
      1
    )
    if (ok) created++
  }

  // Renovações: tratadas pelo agente de alertas (expiration-alerts.ts)

  // Tarefa para propostas paradas (top 2)
  for (const p of data.proposals.slice(0, 2)) {
    if (p.status === 'pending_technical' || p.status === 'pending_commercial') {
      const ok = await createAgentTask(
        supabase,
        // proposals não têm contract_id directo — busca via control_code
        p.id, 'proposal', // usará proposal_id como fallback; não é ideal mas evita join extra
        `[Copiloto IA] Proposta ${p.control_code} para ${p.client_name} aguarda aprovação ` +
        `(${p.status_label}) há ${p.days_waiting} dias. ` +
        `Cobrar ${p.pending_approver ?? 'o responsável'} para dar andamento.`,
        1
      )
      if (ok) created++
    }
  }

  return created
}

// ─── Envio WhatsApp ───────────────────────────────────────────────────────────
export async function sendWhatsApp(text: string): Promise<WhatsAppResult> {
  const baseUrl  = process.env.EVOLUTION_API_URL
  const apiKey   = process.env.EVOLUTION_API_KEY
  // Instância do briefing; se não definida, usa a de "novos negócios" (Matheus)
  const instance = process.env.EVOLUTION_INSTANCE_NAME ?? process.env.EVOLUTION_INSTANCE_NOVOS
  const number   = process.env.WHATSAPP_NUMBER

  if (!baseUrl || !apiKey || !instance || !number) {
    const missing = [
      !baseUrl  && 'EVOLUTION_API_URL',
      !apiKey   && 'EVOLUTION_API_KEY',
      !instance && 'EVOLUTION_INSTANCE_NAME',
      !number   && 'WHATSAPP_NUMBER',
    ].filter(Boolean).join(', ')
    console.error(`[whatsapp] configuração incompleta — variáveis em falta: ${missing}`)
    return { sent: false, error: `Variáveis de ambiente em falta: ${missing}` }
  }

  const cleanNumber = number.replace(/\D/g, '')
  // encodeURIComponent: o nome da instância tem espaços ("drone_whatsapp - Matheus")
  const url         = `${baseUrl.replace(/\/$/, '')}/message/sendText/${encodeURIComponent(instance)}`

  console.log(`[whatsapp] target → ${cleanNumber.slice(0, 4)}**** | instância: ${instance}`)
  console.log(`[whatsapp] endpoint → POST ${url}`)

  try {
    const startMs = Date.now()
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': apiKey },
      body: JSON.stringify({
        number:  cleanNumber,
        text,
        options: { delay: 1200, presence: 'composing' },
      }),
    })
    const elapsedMs = Date.now() - startMs
    const body      = await res.json().catch(() => ({}))

    console.log(`[whatsapp] resposta HTTP ${res.status} em ${elapsedMs}ms`)

    if (!res.ok) {
      const detail = body?.message ?? body?.error ?? body?.response?.message ?? res.statusText
      console.error(`[whatsapp] erro Evolution API → ${res.status}: ${detail}`)
      return { sent: false, error: `Evolution API ${res.status}: ${detail}` }
    }

    console.log(`[whatsapp] entregue → messageId: ${body?.key?.id ?? body?.id ?? '(sem id)'}`)
    return { sent: true, statusCode: res.status }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[whatsapp] erro de rede → ${msg}`)
    return { sent: false, error: `Erro de rede ao contactar Evolution API: ${msg}` }
  }
}

// ─── Serializa erros para string legível ──────────────────────────────────────
function serializeError(err: unknown): string {
  if (err instanceof Error) {
    const e = err as Error & {
      status?: number
      statusCode?: number
      error?: { message?: string; type?: string }
      cause?: unknown
    }
    const parts: string[] = [`${e.constructor?.name ?? 'Error'}: ${e.message}`]
    if (e.status || e.statusCode)  parts.push(`HTTP ${e.status ?? e.statusCode}`)
    if (e.error?.type)             parts.push(`type: ${e.error.type}`)
    if (e.error?.message)          parts.push(`api_error: ${e.error.message}`)
    if (e.cause)                   parts.push(`cause: ${serializeError(e.cause)}`)
    return parts.join(' | ')
  }
  try { return JSON.stringify(err) } catch { return String(err) }
}

// ─── Função principal ─────────────────────────────────────────────────────────
export async function generateBriefing(opts: {
  sendViaWhatsApp: boolean
  createTasks?: boolean   // default: true (cria tarefas no CRM)
  renewalSince?: string   // ISO: envios de avisos a listar a partir de (default: 24h atrás)
}): Promise<BriefingResult | BriefingError> {

  console.log('[agent] verificando variáveis de ambiente...')

  const missingVars: string[] = []
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL)  missingVars.push('NEXT_PUBLIC_SUPABASE_URL')
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missingVars.push('SUPABASE_SERVICE_ROLE_KEY')
  if (!process.env.ANTHROPIC_API_KEY)         missingVars.push('ANTHROPIC_API_KEY')

  if (missingVars.length > 0) {
    const msg = `Variáveis de ambiente em falta no Vercel: ${missingVars.join(', ')}`
    console.error(`[agent] ${msg}`)
    return { ok: false, error: msg }
  }

  const keyPreview = process.env.ANTHROPIC_API_KEY!
  console.log(`[agent] ANTHROPIC_API_KEY presente — prefixo: ${keyPreview.slice(0, 7)}... (${keyPreview.length} chars)`)

  // ── Queries ao Supabase ──────────────────────────────────────────────────────
  const today    = format(new Date(), "EEEE, dd 'de' MMMM 'de' yyyy", { locale: ptBR })
  const supabase = getAdminClient()

  console.log('[agent] iniciando queries ao Supabase (schema: contract_crm)...')

  let dormant: DormantRun[], renewal: RenewalCandidate[], stale: StaleLead[],
      proposals: StuckProposal[], actionPlans: PendingActionPlan[]

  try {
    ;[dormant, renewal, stale, proposals, actionPlans] = await Promise.all([
      fetchDormantOpportunities(supabase),
      fetchRenewalCandidates(supabase),
      fetchStaleLeds(supabase),
      fetchStuckProposals(supabase),
      fetchPendingActionPlans(supabase),
    ])
  } catch (err) {
    const msg = `Erro nas queries ao Supabase: ${serializeError(err)}`
    console.error(`[agent] ${msg}`)
    return { ok: false, error: msg }
  }

  console.log(
    `[agent] dados carregados — ${dormant.length} dormentes, ${renewal.length} renovações, ` +
    `${stale.length} leads, ${proposals.length} propostas paradas, ${actionPlans.length} planos acção`
  )

  // ── Chamada ao LLM ──────────────────────────────────────────────────────────
  console.log('[agent] chamando Anthropic API — modelo: claude-haiku-4-5')
  let briefing: string
  let usage: { promptTokens: number; completionTokens: number }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const response = await client.messages.create({
      model:      'claude-haiku-4-5',
      max_tokens: 1200,
      system: `Você é o Copiloto Estratégico de uma empresa brasileira de Engenharia Clínica e Hospitalar.
Especialista em vendas B2B consultivas (hospitais, clínicas, equipamentos médicos).
Gera briefings executivos precisos, nominais e acionáveis em português do Brasil.
Tom: consultor sénior directo, como se estivesse numa reunião de vendas.
NUNCA inventa dados. Sempre cita nomes reais dos clientes.`,
      messages: [
        { role: 'user', content: buildPrompt({ dormant, renewal, stale, proposals, actionPlans, today }) }
      ],
    })

    const block = response.content.find((b: { type: string }) => b.type === 'text')
    briefing = block && block.type === 'text' ? block.text : ''
    usage = {
      promptTokens:     response.usage.input_tokens,
      completionTokens: response.usage.output_tokens,
    }
  } catch (err) {
    const detail = serializeError(err)
    console.error('[agent] ERRO na chamada Anthropic API:')
    console.error(err)
    return { ok: false, error: `Falha na chamada ao modelo Anthropic: ${detail}` }
  }

  console.log('\n========================================')
  console.log('COPILOTO ESTRATÉGICO — BRIEFING')
  console.log('========================================')
  console.log(briefing)
  console.log('========================================')
  console.log(
    `[agent] tokens — input: ${usage.promptTokens} | output: ${usage.completionTokens}`
  )

  // ── Seção fixa: avisos de renovação enviados / aguardando ───────────────────
  try {
    const since = opts.renewalSince ?? new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    const section = await buildRenewalSendsSection(supabase, since)
    if (section && briefing.trim()) briefing = `${briefing.trim()}\n\n${section}`
  } catch (err) {
    console.error('[agent] erro na seção de avisos de renovação:', serializeError(err))
  }

  // ── Criação automática de tarefas no CRM ────────────────────────────────────
  const shouldCreateTasks = opts.createTasks !== false  // default: true
  let tasksCreated = 0

  if (shouldCreateTasks) {
    console.log('[agent] criando tarefas automáticas no CRM...')
    try {
      tasksCreated = await createAutomaticTasks(supabase, { dormant, renewal, proposals, actionPlans })
      console.log(`[agent] ${tasksCreated} tarefas criadas no CRM`)
    } catch (err) {
      console.error('[agent] erro ao criar tarefas:', serializeError(err))
      // Não falha o briefing por causa de tarefas
    }
  }

  // ── Envio WhatsApp ──────────────────────────────────────────────────────────
  let whatsapp: WhatsAppResult = { sent: false, error: 'Envio WhatsApp desactivado nesta chamada' }
  if (opts.sendViaWhatsApp && !briefing.trim()) {
    whatsapp = { sent: false, error: 'Briefing vazio — nada enviado' }
    console.error('[agent] ✗ briefing vazio, envio WhatsApp ignorado')
  } else if (opts.sendViaWhatsApp) {
    console.log('[agent] enviando via WhatsApp...')
    whatsapp = await sendWhatsApp(briefing)
    if (whatsapp.sent) {
      console.log(`[agent] ✓ WhatsApp entregue (HTTP ${whatsapp.statusCode})`)
    } else {
      console.error(`[agent] ✗ falha WhatsApp — ${whatsapp.error}`)
    }
  }

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    stats: {
      dormantOpportunities: dormant.length,
      renewalCandidates:    renewal.length,
      staleLeads:           stale.length,
      stuckProposals:       proposals.length,
      pendingActionPlans:   actionPlans.length,
      tokensInput:          usage.promptTokens,
      tokensOutput:         usage.completionTokens,
    },
    briefing,
    tasksCreated,
    whatsapp,
  }
}
