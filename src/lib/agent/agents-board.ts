// ─── Tela dos agentes: dados de clientes do Farmer e do Hunter ───────────────
// Sem texto de IA: cada item é um cliente/oportunidade real, com os números dele.
// Tudo filtrado pela empresa (tenant) atual.

import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { loadDashboardInput } from '@/lib/revenue/dashboard-data'
import { computeDashboard } from '@/lib/revenue/dashboard-compute'
import { pendingReference, todayBrasilia } from '@/lib/revenue/measurement'

const DAY = 86_400_000
const daysBetween = (a: number, b: number) => Math.floor((a - b) / DAY)

export type BoardRow = {
  href: string | null
  client: string
  number?: string | null
  cols: Record<string, string | number | null>
  tone?: 'bad' | 'warn' | 'good' | null
}

export type AgentsBoard = {
  generatedAt: string
  reference: { year: number; month: number }
  farmer: {
    renewals: BoardRow[]
    measurements: BoardRow[]
    losses: BoardRow[]
    churn: BoardRow[]
    actionPlans: BoardRow[]
    detractors: BoardRow[]
    overdueTickets: BoardRow[]
    tasks: BoardRow[]
  }
  hunter: {
    stalled: BoardRow[]
    proposals: BoardRow[]
    leads: BoardRow[]
    closed: BoardRow[]
    avulsos: BoardRow[]
    tasks: BoardRow[]
  }
}

const PROPOSAL_LABEL: Record<string, string> = {
  rascunho: 'Rascunho', em_aprovacao_tecnica: 'Análise técnica', aprovado_tecnico: 'OK técnico',
  reprovado_tecnico: 'Reprovada técnica', em_aprovacao_comercial: 'Aprovação comercial', aprovado_comercial: 'Aguardando cliente',
}
const FARMER_KINDS = new Set(['renewal_alert', 'renewal_confirmation', 'internal_notice', 'impl_kickoff', 'impl_follow', 'impl_final_report', 'internal_impl_report', 'measurement_pending'])
const HUNTER_KINDS = new Set(['dormant', 'stuck_proposal'])

export async function loadAgentsBoard(tenantId: string): Promise<AgentsBoard> {
  const db = await createScopedAdmin(tenantId)
  const now = Date.now()
  const today = todayBrasilia()
  const year = today.getFullYear()

  const input = await loadDashboardInput(year, tenantId)
  const typeOf = new Map(input.pipelines.map(p => [p.id, p.type]))
  const pipeName = new Map(input.pipelines.map(p => [p.id, p.name]))
  const stageName = new Map(input.stages.map(s => [s.id, s.name]))
  const stageSla = new Map(input.stages.map(s => [s.id, s.sla_days]))
  const contractById = new Map(input.contracts.map(c => [c.id, c]))
  const tagName = new Map(input.tags.map(t => [t.id, t.name]))

  // Responsáveis e validade dos contratos
  const [{ data: cExtra }, { data: profiles }] = await Promise.all([
    db.from('contracts').select('id, valid_until, owner_id'),
    db.from('profiles').select('id, full_name'),
  ])
  const extraById = new Map((cExtra ?? []).map(c => [c.id as string, c as { id: string; valid_until: string | null; owner_id: string | null }]))
  const nameOf = new Map((profiles ?? []).map(p => [p.id as string, (p.full_name as string) ?? '']))
  const ownerOf = (contractId: string) => nameOf.get(extraById.get(contractId)?.owner_id ?? '') ?? null
  const contractRow = (contractId: string, cols: BoardRow['cols'], tone?: BoardRow['tone']): BoardRow => {
    const c = contractById.get(contractId)
    return { href: `/contracts/${contractId}`, client: c?.client_name ?? '—', number: c?.process_number ?? null, cols, tone: tone ?? null }
  }

  // ── FARMER ───────────────────────────────────────────────────────────────
  const gestaoOpen = input.runs.filter(r => typeOf.get(r.pipeline_id) === 'gestao_contratos' && r.status === 'open')

  // Renovações: vencidos e a vencer em 120 dias
  const renewals = gestaoOpen
    .map(r => {
      const vu = extraById.get(r.contract_id)?.valid_until
      if (!vu) return null
      const d = daysBetween(Date.parse(`${vu}T12:00:00-03:00`), now)
      if (d > 120) return null
      const c = contractById.get(r.contract_id)
      return {
        d,
        row: contractRow(r.contract_id, {
          'Vence em': vu.split('-').reverse().join('/'),
          'Prazo': d < 0 ? `vencido há ${-d} d` : `${d} d`,
          'Valor/mês': Number(c?.monthly_value) || 0,
          'Etapa': (r.stage_id && stageName.get(r.stage_id)) || '—',
          'Responsável': ownerOf(r.contract_id) ?? '—',
        }, d < 0 ? 'bad' : d <= 30 ? 'warn' : null),
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => a.d - b.d)
    .map(x => x.row)

  // Medições do mês de referência (mês anterior) e perdas do mês
  const ref = pendingReference(today, input.measurementDueDay)
  const refD = computeDashboard(input, ref.year, ref.month)
  const curD = computeDashboard(input, year, today.getMonth() + 1)
  const measurements = refD.revenue.measurePending.map(p => contractRow(p.contractId, {
    'Mês': `${String(ref.month).padStart(2, '0')}/${ref.year}`,
    'Potencial': p.value,
    'Situação': p.note ?? '—',
    'Responsável': ownerOf(p.contractId) ?? '—',
  }, ref.overdue ? 'bad' : 'warn'))

  const lossesSrc = [
    ...refD.revenue.gapParts.discounts.lines.map(l => ({ l, kind: 'Desconto', m: ref })),
    ...refD.revenue.gapParts.glosas.lines.map(l => ({ l, kind: 'Glosa', m: ref })),
    ...refD.revenue.gapParts.below.lines.map(l => ({ l, kind: 'Medido abaixo', m: ref })),
    ...curD.revenue.gapParts.discounts.lines.map(l => ({ l, kind: 'Desconto', m: { year, month: today.getMonth() + 1 } })),
  ]
  const seenLoss = new Set<string>()
  const losses = lossesSrc
    .filter(x => { const k = `${x.l.contractId}-${x.kind}-${x.m.year}-${x.m.month}`; if (seenLoss.has(k)) return false; seenLoss.add(k); return true })
    .sort((a, b) => b.l.value - a.l.value)
    .map(x => contractRow(x.l.contractId, {
      'Mês': `${String(x.m.month).padStart(2, '0')}/${x.m.year}`,
      'Tipo': x.kind,
      'Valor perdido': x.l.value,
      'Detalhe': x.l.note ?? '—',
    }, 'bad'))

  // Rescisões nos últimos 90 dias
  const churn = input.runs
    .filter(r => typeOf.get(r.pipeline_id) === 'gestao_contratos' && r.status === 'lost' && r.ended_at && now - Date.parse(r.ended_at) <= 90 * DAY)
    .sort((a, b) => Date.parse(b.ended_at!) - Date.parse(a.ended_at!))
    .map(r => contractRow(r.contract_id, {
      'Rescindido em': new Date(r.ended_at!).toLocaleDateString('pt-BR'),
      'Receita/mês perdida': Number(contractById.get(r.contract_id)?.monthly_value) || 0,
      'Responsável': ownerOf(r.contract_id) ?? '—',
    }, 'bad'))

  // Planos de ação com itens pendentes
  const { data: apItems } = await db.from('action_plan_items').select('contract_id, responsible_department, created_at, status').in('status', ['pending', 'in_progress'])
  const apBy = new Map<string, { n: number; oldest: number; depts: Set<string> }>()
  for (const it of apItems ?? []) {
    const cur = apBy.get(it.contract_id) ?? { n: 0, oldest: 0, depts: new Set<string>() }
    cur.n++
    cur.oldest = Math.max(cur.oldest, daysBetween(now, Date.parse(it.created_at)))
    if (it.responsible_department) cur.depts.add(it.responsible_department)
    apBy.set(it.contract_id, cur)
  }
  const actionPlans = [...apBy.entries()].sort((a, b) => b[1].oldest - a[1].oldest).map(([cid, v]) => contractRow(cid, {
    'Itens pendentes': v.n,
    'Mais antigo': `${v.oldest} d`,
    'Setores': [...v.depts].join(', ') || '—',
  }, v.oldest > 15 ? 'warn' : null))

  // NPS detratores (nota até 6) nos últimos 90 dias
  const { data: npsRows } = await db.from('nps_surveys').select('contract_id, score, comment, answered_at, respondent_name').not('score', 'is', null).lte('score', 6)
  const detractors = (npsRows ?? [])
    .filter(n => n.answered_at && now - Date.parse(n.answered_at) <= 90 * DAY)
    .sort((a, b) => Date.parse(b.answered_at!) - Date.parse(a.answered_at!))
    .map(n => contractRow(n.contract_id, {
      'Nota': n.score,
      'Quem respondeu': n.respondent_name ?? '—',
      'Comentário': (n.comment ?? '').slice(0, 80) || '—',
      'Em': new Date(n.answered_at!).toLocaleDateString('pt-BR'),
    }, 'bad'))

  // Chamados abertos fora do prazo
  const { data: tickets } = await db.from('tickets').select('id, ticket_number, subject, status, sla_due_at, contract_id, requester_name').not('status', 'in', '("fechado","resolvido","cancelado")')
  const overdueTickets = (tickets ?? [])
    .filter(t => t.sla_due_at && Date.parse(t.sla_due_at) < now)
    .sort((a, b) => Date.parse(a.sla_due_at!) - Date.parse(b.sla_due_at!))
    .map(t => {
      const c = t.contract_id ? contractById.get(t.contract_id) : null
      return {
        href: `/tickets/${t.id}`,
        client: c?.client_name ?? t.requester_name ?? '—',
        number: t.ticket_number ? `#${t.ticket_number}` : null,
        cols: { 'Assunto': (t.subject ?? '').slice(0, 60), 'Atrasado há': `${daysBetween(now, Date.parse(t.sla_due_at!))} d` },
        tone: 'bad' as const,
      }
    })

  // Atividades abertas pelos agentes (separadas por agente)
  const { data: agentActs } = await db.from('activities')
    .select('id, contract_id, title, activity_date, status, assigned_to, metadata')
    .eq('metadata->>source', 'copiloto_ia').neq('status', 'done').order('activity_date', { ascending: true }).limit(300)
  const actRow = (a: { contract_id: string | null; title: string | null; activity_date: string | null; assigned_to: string | null }): BoardRow => {
    const c = a.contract_id ? contractById.get(a.contract_id) : null
    const late = a.activity_date ? daysBetween(now, Date.parse(`${a.activity_date}T23:59:00-03:00`)) : 0
    return {
      href: a.contract_id ? `/contracts/${a.contract_id}` : '/copiloto/relatorios',
      client: c?.client_name ?? '(interno)',
      number: c?.process_number ?? null,
      cols: {
        'Tarefa': (a.title ?? '').replace(/^(Farmer|Hunter) · /, ''),
        'Data': a.activity_date ? a.activity_date.split('-').reverse().join('/') : '—',
        'Responsável': nameOf.get(a.assigned_to ?? '') ?? '—',
      },
      tone: late > 0 ? 'warn' : null,
    }
  }
  const agentOf = (m: Record<string, unknown> | null): 'farmer' | 'hunter' => {
    const a = m?.agent
    if (a === 'farmer' || a === 'hunter') return a
    const k = String(m?.kind ?? '')
    if (HUNTER_KINDS.has(k)) return 'hunter'
    if (FARMER_KINDS.has(k)) return 'farmer'
    return 'farmer'
  }
  const farmerTasks = (agentActs ?? []).filter(a => agentOf(a.metadata as Record<string, unknown>) === 'farmer').map(actRow)
  const hunterTasks = (agentActs ?? []).filter(a => agentOf(a.metadata as Record<string, unknown>) === 'hunter').map(actRow)

  // ── HUNTER ───────────────────────────────────────────────────────────────
  const { data: lastActs } = await db.from('activities').select('contract_id, created_at').order('created_at', { ascending: false }).limit(2000)
  const lastActBy = new Map<string, number>()
  for (const a of lastActs ?? []) if (a.contract_id && !lastActBy.has(a.contract_id)) lastActBy.set(a.contract_id, Date.parse(a.created_at))

  const salesOpen = input.runs.filter(r => typeOf.get(r.pipeline_id) === 'vendas' && r.status === 'open')
  const stalled = salesOpen
    .map(r => {
      const entered = Date.parse(r.stage_entered_at ?? r.started_at ?? new Date().toISOString())
      const inStage = daysBetween(now, entered)
      const lastAct = lastActBy.get(r.contract_id) ?? entered
      const idle = daysBetween(now, lastAct)
      const sla = (r.stage_id ? stageSla.get(r.stage_id) : null) || 7
      return { idle, inStage, sla, r }
    })
    .filter(x => x.idle >= 7 || x.inStage > x.sla)
    .sort((a, b) => b.idle - a.idle)
    .map(({ idle, inStage, r }) => contractRow(r.contract_id, {
      'Funil': pipeName.get(r.pipeline_id) ?? '—',
      'Etapa': (r.stage_id && stageName.get(r.stage_id)) || '—',
      'Sem interação': `${idle} d`,
      'Na etapa': `${inStage} d`,
      'Valor': Number(r.value) || 0,
      'Responsável': ownerOf(r.contract_id) ?? '—',
    }, idle >= 15 ? 'bad' : 'warn'))

  const { data: props } = await db.from('proposals')
    .select('id, contract_id, control_code, workflow_status, proposal_value, updated_at')
    .is('deleted_at', null)
    .not('workflow_status', 'in', '("cliente_aprovado","cliente_recusado","declinada")')
  const proposals = (props ?? [])
    .map(p => ({ p, d: daysBetween(now, Date.parse(p.updated_at)) }))
    .filter(x => x.d >= 5)
    .sort((a, b) => b.d - a.d)
    .map(({ p, d }) => contractRow(p.contract_id, {
      'Proposta': p.control_code ?? '—',
      'Situação': PROPOSAL_LABEL[p.workflow_status ?? ''] ?? p.workflow_status ?? '—',
      'Parada há': `${d} d`,
      'Valor': Number(p.proposal_value) || 0,
    }, d >= 15 ? 'bad' : 'warn'))

  const { data: leadRows } = await db.from('leads').select('id, name, company_name, status, score, source, created_at, updated_at').in('status', ['novo', 'em_qualificacao', 'qualificado'])
  const leads = (leadRows ?? [])
    .map(l => ({ l, d: daysBetween(now, Date.parse(l.updated_at ?? l.created_at)) }))
    .filter(x => x.d >= 3)
    .sort((a, b) => (b.l.score ?? 0) - (a.l.score ?? 0) || b.d - a.d)
    .map(({ l, d }) => ({
      href: `/leads/${l.id}`,
      client: l.company_name || l.name || '—',
      number: l.company_name ? l.name : null,
      cols: { 'Situação': l.status ?? '—', 'Pontos': l.score ?? 0, 'Origem': l.source ?? '—', 'Sem andamento': `${d} d` },
      tone: d >= 15 ? 'bad' as const : 'warn' as const,
    }))

  const monthStart = new Date(Date.UTC(year, today.getMonth(), 1, 3)).getTime()
  const closed = input.runs
    .filter(r => ['vendas', 'servico_avulso'].includes(typeOf.get(r.pipeline_id) ?? '') && (r.status === 'won' || r.status === 'lost') && r.ended_at && Date.parse(r.ended_at) >= monthStart)
    .sort((a, b) => Date.parse(b.ended_at!) - Date.parse(a.ended_at!))
    .map(r => contractRow(r.contract_id, {
      'Resultado': r.status === 'won' ? 'Ganha' : 'Perdida',
      'Funil': pipeName.get(r.pipeline_id) ?? '—',
      'Serviço': (r.tag_id && tagName.get(r.tag_id)) || (input.contractTag[r.contract_id] && tagName.get(input.contractTag[r.contract_id])) || '—',
      'Valor': Number(r.value) || 0,
      'Em': new Date(r.ended_at!).toLocaleDateString('pt-BR'),
    }, r.status === 'won' ? 'good' : 'bad'))

  const avulsos = input.runs
    .filter(r => typeOf.get(r.pipeline_id) === 'servico_avulso' && r.status === 'open')
    .map(r => ({ r, d: daysBetween(now, Date.parse(r.stage_entered_at ?? r.started_at ?? new Date().toISOString())) }))
    .sort((a, b) => b.d - a.d)
    .map(({ r, d }) => contractRow(r.contract_id, {
      'Etapa': (r.stage_id && stageName.get(r.stage_id)) || '—',
      'Na etapa': `${d} d`,
      'Valor': Number(r.value) || 0,
      'Responsável': ownerOf(r.contract_id) ?? '—',
    }, d > 15 ? 'warn' : null))

  return {
    generatedAt: new Date().toISOString(),
    reference: { year: ref.year, month: ref.month },
    farmer: { renewals, measurements, losses, churn, actionPlans, detractors, overdueTickets, tasks: farmerTasks },
    hunter: { stalled, proposals, leads, closed, avulsos, tasks: hunterTasks },
  }
}
