// ─── Regras: execução das ações (só servidor) ────────────────────────────────
// Quem faz:
//   manual → o texto escrito pelo admin vira a tarefa / o e-mail como está (sem IA);
//   agent  → o agente de IA da empresa (chave do Théo) escreve a partir das instruções e dos dados.
// O agente cai para manual sozinho quando: modo sem IA ligado, sem chave, orçamento do mês
// esgotado ou erro da IA. Nada deixa de acontecer.
// E-mail interno automático só sai com o "responsável pelos envios" definido e com cadastro
// completo (nome e sobrenome, telefone, área, e-mail) e e-mail conectado; senão vira tarefa
// para esse envio ser feito por uma pessoa. Nada vai ao cliente por aqui.

import { createAdminClient } from '@/lib/supabase/admin'
import { inPreview, record } from './agent-preview'
import { renderRuleText, criterionDef, type RuleActions, type RuleExecutor } from './rules-catalog'
import { profileProblems } from '@/lib/people/profile-complete'

type Db = ReturnType<typeof createAdminClient>
export type ActMatch = {
  entityId: string; name: string; ownerId: string | null
  contractId: string | null; companyId: string | null; leadId?: string | null
  vars: Record<string, string>; detail: string
}
export type ActRule = { id: string; name: string; criterion: string; threshold: number; executor?: RuleExecutor; actions: RuleActions }

const DAY = 86_400_000
const addDays = (iso: string, d: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + d * DAY).toISOString().slice(0, 10)
const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.comercialdrone.com.br').replace(/\/$/, '')
export const linkFor = (m: Pick<ActMatch, 'contractId' | 'leadId'>) =>
  m.contractId ? `${appUrl()}/contracts/${m.contractId}` : m.leadId ? `${appUrl()}/leads/${m.leadId}` : appUrl()

type Area = { id: string; name: string; lead_id: string | null; member_ids: string[]; emails: string[] }
type Person = { id: string; full_name: string | null; email: string | null; phone: string | null; department: string | null }

// Contexto da empresa para uma rodada (carregado uma vez)
export type ActCtx = {
  tenantId: string; db: Db
  areas: Map<string, Area>; people: Map<string, Person>
  aiPaused: boolean; senderId: string | null
  ai?: { provider: string; model: string; key: string } | null | undefined  // undefined = ainda não carregado
}

export async function loadActCtx(tenantId: string, db: Db): Promise<ActCtx> {
  const [{ data: areas }, { data: people }, { data: org }] = await Promise.all([
    db.from('org_areas').select('id, name, lead_id, member_ids, emails'),
    db.from('profiles').select('id, full_name, email, phone, department'),
    db.from('organization_settings').select('ai_paused, auto_sender_id').maybeSingle(),
  ])
  const o = org as { ai_paused?: boolean; auto_sender_id?: string | null } | null
  return {
    tenantId, db,
    areas: new Map(((areas ?? []) as Area[]).map(a => [a.id, a])),
    people: new Map(((people ?? []) as Person[]).map(p => [p.id, p])),
    aiPaused: !!o?.ai_paused, senderId: o?.auto_sender_id ?? null,
  }
}

// Destino → quem recebe a tarefa (uma pessoa) e quem é avisado
function taskTarget(ctx: ActCtx, dest: string, m: ActMatch): { assignee: string | null; also: string[] } {
  if (dest === 'owner') return { assignee: m.ownerId, also: [] }
  if (dest.startsWith('area:')) {
    const a = ctx.areas.get(dest.slice(5))
    if (!a) return { assignee: null, also: [] }
    const lead = a.lead_id ?? a.member_ids[0] ?? null
    return { assignee: lead, also: a.member_ids.filter(x => x !== lead) }
  }
  return { assignee: dest, also: [] }
}

// Destinos → e-mails
function emailsFor(ctx: ActCtx, dests: string[], m: ActMatch): string[] {
  const out = new Set<string>()
  for (const d of dests) {
    if (d.includes('@')) out.add(d.toLowerCase())
    else if (d === 'owner') { const e = m.ownerId ? ctx.people.get(m.ownerId)?.email : null; if (e) out.add(e.toLowerCase()) }
    else if (d.startsWith('area:')) {
      const a = ctx.areas.get(d.slice(5))
      for (const id of a?.member_ids ?? []) { const e = ctx.people.get(id)?.email; if (e) out.add(e.toLowerCase()) }
      for (const e of a?.emails ?? []) out.add(e.toLowerCase())
    } else { const e = ctx.people.get(d)?.email; if (e) out.add(e.toLowerCase()) }
  }
  return [...out]
}

// Agente: IA escreve o texto a partir das instruções e dos dados. null = cair para manual.
async function agentWrite(ctx: ActCtx, rule: ActRule, m: ActMatch, instruction: string, kind: 'tarefa' | 'email'): Promise<{ text: string | null; why?: string }> {
  if (ctx.aiPaused) return { text: null, why: 'modo sem IA' }
  if (ctx.ai === undefined) {
    const { loadTheoTenantAi, monthUsage } = await import('@/lib/ai/theo-server')
    const ai = await loadTheoTenantAi(ctx.tenantId)
    if (!ai.provider || !ai.key || !ai.model) ctx.ai = null
    else {
      const used = await monthUsage(ctx.tenantId)
      ctx.ai = used.total >= ai.budgetUsd ? null : { provider: ai.provider, model: ai.model, key: ai.key }
    }
  }
  if (!ctx.ai) return { text: null, why: 'IA indisponível (sem chave ou orçamento do mês esgotado)' }
  const def = criterionDef(rule.criterion)
  const { runTheo } = await import('@/lib/ai/theo-engine')
  const { estimateCostUsd } = await import('@/lib/ai/theo-catalog')
  const system = [
    `Você é o agente ${def?.agent === 'hunter' ? 'Hunter (novos negócios)' : 'Farmer (carteira e contratos)'} de um CRM. Escreva em português do Brasil.`,
    kind === 'email'
      ? 'Escreva só o corpo de um e-mail interno para o time da empresa (não é para o cliente): direto, em tópicos curtos quando ajudar, sem assunto e sem assinatura.'
      : 'Escreva só a descrição de uma tarefa interna: o que fazer, em passos curtos, com os dados importantes.',
    'Use apenas os dados informados; nunca invente valor, data ou nome. Valores em reais com centavos; datas dd/mm/aaaa.',
  ].join('\n')
  const data = Object.entries(m.vars).filter(([, v]) => v && v !== '—').map(([k, v]) => `${k}: ${v}`).join('\n')
  const r = await runTheo({
    provider: ctx.ai.provider as never, model: ctx.ai.model, key: ctx.ai.key, system, tools: [],
    history: [{ role: 'user', text: `Instruções: ${instruction}\n\nDados:\n${data}\nDetalhe: ${m.detail}\nLink no CRM: ${linkFor(m)}` }],
    read: async () => '',
  })
  if ((r.tokensIn || r.tokensOut) && !inPreview()) {
    await ctx.db.from('assistant_usage_log').insert({
      user_id: null, input_tokens: r.tokensIn, output_tokens: r.tokensOut, provider: ctx.ai.provider, model: ctx.ai.model,
      cost_usd: estimateCostUsd(ctx.ai.provider as never, ctx.ai.model, r.tokensIn, r.tokensOut),
    })
  }
  if (r.error || !r.text.trim()) return { text: null, why: r.error ?? 'IA sem resposta' }
  return { text: r.text.trim() }
}

async function createTask(ctx: ActCtx, rule: ActRule, m: ActMatch, title: string, content: string, dueIso: string, assignee: string | null, also: string[], agentName: string) {
  if (inPreview()) { record({ kind: 'atividade', title, content, assignedTo: assignee, due: dueIso }); return }
  await ctx.db.from('activities').insert({
    contract_id: m.contractId, company_id: m.companyId, user_id: null, assigned_to: assignee,
    type: 'task', activity_type: 'task', status: 'planned', completed: false, title, content, activity_date: dueIso,
    metadata: { source: 'regra_agente', kind: 'agent_rule', agent: agentName, rule_id: rule.id, ...(m.leadId ? { lead_id: m.leadId } : {}) },
  })
  const notifyIds = [...new Set(also)].filter(Boolean)
  if (notifyIds.length) await ctx.db.from('notifications').insert(notifyIds.map(u => ({ user_id: u, contract_id: m.contractId, message: `${title} (com ${ctx.people.get(assignee ?? '')?.full_name ?? 'a área'})`, read: false })))
}

// Executa as ações de uma regra para um caso (tarefa, aviso, e-mail). O WhatsApp em lista
// fica com quem chama (uma mensagem por rodada).
export async function executeMatch(ctx: ActCtx, rule: ActRule, m: ActMatch, today: string): Promise<string[]> {
  const def = criterionDef(rule.criterion)
  const agentName = def?.agent ?? 'farmer'
  const prefix = agentName === 'hunter' ? 'Hunter · ' : 'Farmer · '
  const a = rule.actions ?? {}
  const vars = { ...m.vars, link: linkFor(m) }
  const notes: string[] = []
  const useAgent = rule.executor === 'agent'

  if (a.task?.enabled) {
    const title = prefix + renderRuleText(a.task.title, vars)
    const base = renderRuleText(a.task.text || (def?.sentence ?? '').replace('{n}', String(rule.threshold)), vars)
    let content = `[Regra: ${rule.name}] ${base}`
    if (useAgent) {
      const w = await agentWrite(ctx, rule, m, base, 'tarefa')
      if (w.text) content = `[Regra: ${rule.name} · escrito pelo agente] ${w.text}`
      else notes.push(`tarefa sem IA (${w.why})`)
    }
    const t = taskTarget(ctx, a.task.assignee, m)
    await createTask(ctx, rule, m, title, content, addDays(today, a.task.due_days), t.assignee, t.also, agentName)
  }

  if (a.notify?.enabled) {
    const t = taskTarget(ctx, a.notify.assignee, m)
    const message = `${prefix}${renderRuleText(a.notify.message || `Regra "${rule.name}": {{nome}}.`, vars)}`
    const ids = [t.assignee, ...t.also].filter(Boolean) as string[]
    if (inPreview()) ids.forEach(id => record({ kind: 'aviso', to: id, text: message }))
    else if (ids.length) await ctx.db.from('notifications').insert(ids.map(u => ({ user_id: u, contract_id: m.contractId, message, read: false })))
  }

  if (a.email?.enabled) {
    const to = emailsFor(ctx, a.email.to, m)
    const subject = renderRuleText(a.email.subject, vars)
    let body = renderRuleText(a.email.body, vars)
    if (useAgent) {
      const w = await agentWrite(ctx, rule, m, body, 'email')
      if (w.text) body = w.text
      else notes.push(`e-mail sem IA (${w.why})`)
    }
    const sender = ctx.senderId ? ctx.people.get(ctx.senderId) : null
    const senderOk = !!sender && profileProblems(sender).length === 0
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111;white-space:pre-wrap">${body.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div><p style="font-size:12px;color:#666">Abrir no CRM: <a href="${linkFor(m)}">${linkFor(m)}</a></p>`
    if (!to.length) notes.push('e-mail sem destinatário (cadastre e-mails na área ou na pessoa)')
    else if (!senderOk) {
      // Sem responsável pelos envios (ou cadastro incompleto): vira tarefa para uma pessoa enviar
      const t = taskTarget(ctx, 'owner', m)
      await createTask(ctx, rule, m, `${prefix}Enviar e-mail: ${subject}`, `Para: ${to.join(', ')}\n\n${body}`, today, ctx.senderId ?? t.assignee, [], agentName)
      notes.push('e-mail virou tarefa (defina o responsável pelos envios com cadastro completo)')
    } else if (inPreview()) record({ kind: 'email', to: to.join(', '), subject, html })
    else {
      try {
        const { sendEmailForUser } = await import('@/lib/email/send')
        await sendEmailForUser(sender!.id, to.join(', '), subject, html)
      } catch (e) {
        await createTask(ctx, rule, m, `${prefix}Enviar e-mail: ${subject}`, `O envio automático falhou (${e instanceof Error ? e.message : 'erro'}). Para: ${to.join(', ')}\n\n${body}`, today, sender!.id, [], agentName)
        notes.push('e-mail falhou e virou tarefa')
      }
    }
  }
  return notes
}
