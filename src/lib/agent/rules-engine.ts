// ─── Regras dos agentes: motor (só servidor/cron) ────────────────────────────
// Busca os casos de cada critério, tira os já tratados (agent_rule_hits) e executa as
// ações. Sempre pelo cliente admin restrito à empresa (scopeAdminClient: todas as
// tabelas lidas aqui estão em TENANT_TABLES). Dentro de runPreview nada é gravado.

import { createAdminClient } from '@/lib/supabase/admin'
import { scopeAdminClient } from '@/lib/tenant/scoped-admin'
import { inPreview, record } from './agent-preview'
import { criterionDef, renderRuleText, MAX_HITS_PER_RUN, type RuleActions, type RuleConditions } from './rules-catalog'
import { todayBrIso, weekdayOf, normDays } from './agent-tasks'

type Db = ReturnType<typeof createAdminClient>
export type RuleRow = {
  id: string; tenant_id: string; agent: 'farmer' | 'hunter'; name: string; criterion: string; threshold: number
  conditions: RuleConditions; actions: RuleActions; days: number[]; enabled: boolean; last_run_at: string | null
}
export type Match = {
  entityId: string; episode: string; name: string; ownerId: string | null
  contractId: string | null; companyId: string | null; leadId?: string | null
  vars: Record<string, string>; detail: string
}

const DAY = 86_400_000
const dateOnly = (iso: string | null | undefined) => (iso ? String(iso).slice(0, 10) : '')
const daysSince = (iso: string, today: string) => Math.floor((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${dateOnly(iso)}T12:00:00Z`)) / DAY)
const brl = (v: number | null | undefined) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))
const chunks = <T,>(a: T[], n = 200) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n))
const addDays = (iso: string, d: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + d * DAY).toISOString().slice(0, 10)

async function contractsById(db: Db, ids: string[]) {
  const out = new Map<string, { client_name: string; owner_id: string | null; current_assignee_id: string | null; company_id: string | null }>()
  for (const c of chunks([...new Set(ids)])) {
    const { data } = await db.from('contracts').select('id, client_name, owner_id, current_assignee_id, company_id').in('id', c)
    for (const r of data ?? []) out.set(r.id as string, r as never)
  }
  return out
}

// Casos do critério hoje (antes de tirar os já tratados)
export async function findMatches(db: Db, rule: Pick<RuleRow, 'criterion' | 'threshold' | 'conditions'>, today = todayBrIso()): Promise<Match[]> {
  const n = rule.threshold
  const c = rule.conditions ?? {}
  switch (rule.criterion) {
    case 'opp_idle':
    case 'opp_stage_stuck': {
      let q = db.from('pipeline_runs').select('id, contract_id, pipeline_id, stage_id, value, started_at, stage_entered_at').eq('status', 'open').limit(3000)
      if (c.pipeline_id) q = q.eq('pipeline_id', c.pipeline_id)
      if (c.stage_id) q = q.eq('stage_id', c.stage_id)
      if (c.min_value != null) q = q.gte('value', c.min_value)
      if (rule.criterion === 'opp_stage_stuck') q = q.lte('stage_entered_at', `${addDays(today, -n)}T23:59:59Z`)
      const { data: runs } = await q
      const list = (runs ?? []) as { contract_id: string; stage_id: string | null; value: number | null; started_at: string | null; stage_entered_at: string | null }[]
      if (!list.length) return []
      const stageIds = [...new Set(list.map(r => r.stage_id).filter(Boolean))] as string[]
      const { data: st } = stageIds.length ? await db.from('stages').select('id, name').in('id', stageIds) : { data: [] }
      const stageName = new Map(((st ?? []) as { id: string; name: string }[]).map(s => [s.id, s.name]))
      // Última atividade de cada oportunidade
      const last = new Map<string, string>()
      if (rule.criterion === 'opp_idle') {
        for (const ch of chunks(list.map(r => r.contract_id))) {
          const { data } = await db.from('activities').select('contract_id, created_at').in('contract_id', ch).order('created_at', { ascending: false }).limit(5000)
          for (const a of data ?? []) if (!last.has(a.contract_id as string)) last.set(a.contract_id as string, a.created_at as string)
        }
      }
      const cs = await contractsById(db, list.map(r => r.contract_id))
      const out: Match[] = []
      for (const r of list) {
        const ref = rule.criterion === 'opp_idle' ? (last.get(r.contract_id) ?? r.stage_entered_at ?? r.started_at) : r.stage_entered_at
        if (!ref) continue
        const d = daysSince(ref, today)
        if (d < n) continue
        const k = cs.get(r.contract_id)
        if (!k) continue
        const etapa = (r.stage_id && stageName.get(r.stage_id)) || '—'
        out.push({
          entityId: r.contract_id, episode: `${rule.criterion === 'opp_stage_stuck' ? `${r.stage_id}:` : ''}${dateOnly(ref)}`, name: k.client_name,
          ownerId: k.owner_id ?? k.current_assignee_id, contractId: r.contract_id, companyId: k.company_id,
          vars: { nome: k.client_name, dias: String(d), valor: brl(r.value), etapa }, detail: `${d} dias · ${etapa} · ${brl(r.value)}`,
        })
      }
      return out
    }
    case 'proposal_waiting': {
      let q = db.from('proposal_status').select('contract_id, status, proposal_value, updated_at')
        .not('status', 'in', '(aprovado_cliente,recusado,cancelado)').lte('updated_at', `${addDays(today, -n)}T23:59:59Z`).limit(1000)
      if (c.min_value != null) q = q.gte('proposal_value', c.min_value)
      const { data } = await q
      const list = (data ?? []) as { contract_id: string; proposal_value: number | null; updated_at: string }[]
      const cs = await contractsById(db, list.map(p => p.contract_id))
      return list.flatMap(p => {
        const k = cs.get(p.contract_id)
        if (!k) return []
        const d = daysSince(p.updated_at, today)
        return [{ entityId: p.contract_id, episode: dateOnly(p.updated_at), name: k.client_name, ownerId: k.owner_id ?? k.current_assignee_id,
          contractId: p.contract_id, companyId: k.company_id, vars: { nome: k.client_name, dias: String(d), valor: brl(p.proposal_value), etapa: '—' },
          detail: `${d} dias · ${brl(p.proposal_value)}` }]
      })
    }
    case 'lead_stale': {
      let q = db.from('leads').select('id, name, company_name, assigned_to, updated_at, source').in('status', ['novo', 'em_qualificacao'])
        .lte('updated_at', `${addDays(today, -n)}T23:59:59Z`).limit(1000)
      if (c.lead_source) q = q.eq('source', c.lead_source)
      const { data } = await q
      return ((data ?? []) as { id: string; name: string; company_name: string | null; assigned_to: string | null; updated_at: string }[]).map(l => {
        const d = daysSince(l.updated_at, today)
        const nome = l.company_name ? `${l.name} (${l.company_name})` : l.name
        return { entityId: l.id, episode: dateOnly(l.updated_at), name: nome, ownerId: l.assigned_to, contractId: null, companyId: null, leadId: l.id,
          vars: { nome, dias: String(d), valor: '—', etapa: '—' }, detail: `${d} dias sem movimentação` }
      })
    }
    case 'contract_expiring': {
      let q = db.from('contracts').select('id, client_name, owner_id, current_assignee_id, company_id, valid_until, monthly_value')
        .gte('valid_until', today).lte('valid_until', addDays(today, n)).limit(1000)
      if (c.min_value != null) q = q.gte('monthly_value', c.min_value)
      const { data } = await q
      return ((data ?? []) as { id: string; client_name: string; owner_id: string | null; current_assignee_id: string | null; company_id: string | null; valid_until: string; monthly_value: number | null }[]).map(k => {
        const d = -daysSince(k.valid_until, today)
        return { entityId: k.id, episode: dateOnly(k.valid_until), name: k.client_name, ownerId: k.owner_id ?? k.current_assignee_id,
          contractId: k.id, companyId: k.company_id, vars: { nome: k.client_name, dias: String(d), valor: brl(k.monthly_value), etapa: '—' },
          detail: `vence em ${d} dias (${dateOnly(k.valid_until).split('-').reverse().join('/')}) · ${brl(k.monthly_value)}/mês` }
      })
    }
    case 'nps_low': {
      const { data } = await db.from('nps_surveys').select('id, contract_id, score, answered_at, respondent_name')
        .not('score', 'is', null).lte('score', n).gte('answered_at', new Date(Date.parse(`${today}T12:00:00Z`) - 30 * DAY).toISOString()).limit(500)
      const list = (data ?? []) as { id: string; contract_id: string | null; score: number; respondent_name: string | null }[]
      const cs = await contractsById(db, list.map(s => s.contract_id).filter(Boolean) as string[])
      return list.map(s => {
        const k = s.contract_id ? cs.get(s.contract_id) : undefined
        const nome = k?.client_name ?? s.respondent_name ?? 'cliente'
        return { entityId: s.id, episode: 'resposta', name: nome, ownerId: k ? k.owner_id ?? k.current_assignee_id : null,
          contractId: s.contract_id, companyId: k?.company_id ?? null, vars: { nome, dias: '0', valor: '—', etapa: '—', nota: String(s.score) },
          detail: `nota ${s.score}${s.respondent_name ? ` · ${s.respondent_name}` : ''}` }
      })
    }
    case 'ticket_overdue': {
      let q = db.from('tickets').select('id, ticket_number, subject, assigned_to, sla_due_at, contract_id, company_id, priority')
        .not('status', 'in', '(resolvido,fechado,cancelado)').not('sla_due_at', 'is', null)
        .lte('sla_due_at', new Date(Date.now() - n * DAY).toISOString()).limit(500)
      if (c.priority) q = q.eq('priority', c.priority)
      const { data } = await q
      return ((data ?? []) as { id: string; ticket_number: number | string | null; subject: string; assigned_to: string | null; sla_due_at: string; contract_id: string | null; company_id: string | null }[]).map(t => {
        const d = Math.max(0, daysSince(t.sla_due_at, today))
        const nome = `#${t.ticket_number ?? ''} ${t.subject}`.trim()
        return { entityId: t.id, episode: dateOnly(t.sla_due_at), name: nome, ownerId: t.assigned_to, contractId: t.contract_id, companyId: t.company_id,
          vars: { nome, dias: String(d), valor: '—', etapa: '—' }, detail: `prazo vencido há ${d} dia(s)` }
      })
    }
    default:
      return []
  }
}

// Roda uma regra: casos novos → ações → marca como tratados
export async function runRule(tenantId: string, rule: RuleRow, today = todayBrIso()): Promise<{ found: number; fresh: number; done: number; status: string }> {
  const db = scopeAdminClient(createAdminClient(), tenantId, null)
  const def = criterionDef(rule.criterion)
  if (!def) return { found: 0, fresh: 0, done: 0, status: 'critério desconhecido' }
  const all = await findMatches(db, rule, today)

  // Tira os já tratados (mesmo caso e mesmo "episódio")
  const seen = new Set<string>()
  for (const ch of chunks(all.map(m => m.entityId))) {
    const { data } = await db.from('agent_rule_hits').select('entity_id, episode').eq('rule_id', rule.id).in('entity_id', ch)
    for (const h of data ?? []) seen.add(`${h.entity_id}|${h.episode}`)
  }
  const fresh = all.filter(m => !seen.has(`${m.entityId}|${m.episode}`))
  const batch = fresh.slice(0, MAX_HITS_PER_RUN)
  const a = rule.actions ?? {}
  const prefix = def.agent === 'hunter' ? 'Hunter · ' : 'Farmer · '
  const preview = inPreview()

  for (const m of batch) {
    const who = (x: string) => (x === 'owner' ? m.ownerId : x)
    if (a.task?.enabled) {
      const title = prefix + renderRuleText(a.task.title, m.vars)
      const content = `[Regra: ${rule.name}] ${renderRuleText(a.task.text || def.sentence.replace('{n}', String(rule.threshold)), m.vars)}`
      const due = addDays(today, a.task.due_days)
      if (preview) record({ kind: 'atividade', title, content, assignedTo: who(a.task.assignee), due })
      else await db.from('activities').insert({
        contract_id: m.contractId, company_id: m.companyId, user_id: null, assigned_to: who(a.task.assignee),
        type: 'task', activity_type: 'task', status: 'planned', completed: false, title, content, activity_date: due,
        metadata: { source: 'regra_agente', kind: 'agent_rule', agent: def.agent, rule_id: rule.id, ...(m.leadId ? { lead_id: m.leadId } : {}) },
      })
    }
    if (a.notify?.enabled) {
      const to = who(a.notify.assignee)
      const message = `${prefix}${renderRuleText(a.notify.message || `Regra "${rule.name}": {{nome}}.`, m.vars)}`
      if (preview) record({ kind: 'aviso', to, text: message })
      else if (to) await db.from('notifications').insert({ user_id: to, contract_id: m.contractId, message, read: false })
    }
    if (!preview) await db.from('agent_rule_hits').insert({ rule_id: rule.id, entity_id: m.entityId, episode: m.episode })
  }

  if (a.whatsapp?.enabled && batch.length) {
    const lines = batch.slice(0, 25).map(m => `• ${m.name} — ${m.detail}`)
    const text = `🤖 *${def.agent === 'hunter' ? 'Hunter' : 'Farmer'} — ${rule.name}*\n${batch.length} caso(s) novo(s):\n\n${lines.join('\n')}${batch.length > 25 ? `\n… e mais ${batch.length - 25}` : ''}`
    const { sendWhatsApp } = await import('./briefing-core')
    await sendWhatsApp(text, tenantId, a.whatsapp.to)
  }
  const status = fresh.length > batch.length ? `${batch.length} tratado(s); ${fresh.length - batch.length} ficam para a próxima rodada` : `${batch.length} caso(s) novo(s)`
  return { found: all.length, fresh: fresh.length, done: batch.length, status }
}

// Rodada diária da empresa: regras ligadas, do dia, que ainda não rodaram hoje
export async function runRulesForTenant(tenantId: string, opts: { force?: boolean } = {}) {
  const today = todayBrIso()
  const db = scopeAdminClient(createAdminClient(), tenantId, null)
  const { data, error } = await db.from('agent_rules').select('*').eq('enabled', true).order('created_at')
  if (error) return { error: error.message }
  const out: { id: string; status: string }[] = []
  for (const r of (data ?? []) as RuleRow[]) {
    const last = r.last_run_at ? todayBrIso(new Date(r.last_run_at).getTime()) : null
    if (!opts.force && (!normDays(r.days).includes(weekdayOf(today)) || last === today)) continue
    await db.from('agent_rules').update({ last_run_at: new Date().toISOString(), last_status: 'rodando' }).eq('id', r.id)
    let status: string
    try { status = (await runRule(tenantId, r, today)).status } catch (e) { status = `erro: ${e instanceof Error ? e.message : String(e)}` }
    await db.from('agent_rules').update({ last_status: status.slice(0, 300) }).eq('id', r.id)
    out.push({ id: r.id, status })
  }
  return { ran: out.length, rules: out }
}
