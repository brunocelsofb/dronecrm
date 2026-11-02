'use server'
// ─── Regras dos agentes (Central de regras, só o admin) ─────────────────

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { scopeAdminClient } from '@/lib/tenant/scoped-admin'
import { resolveTenantId } from '@/lib/tenant/context'
import { getSupportSession, SUPPORT_READONLY_MESSAGE } from '@/lib/tenant/support'
import { getTenantFeatures } from '@/lib/config/tenant-features'
import { validateRule, suggestedRules, MAX_RULES } from '@/lib/agent/rules-catalog'

type Result = { ok: true; id?: string } | { ok: false; error: string }

async function guard(): Promise<{ tenantId: string; userId: string; features: string[] } | { error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }
  const [{ data: me }, tenantId, s] = await Promise.all([
    supabase.from('profiles').select('role').eq('id', user.id).maybeSingle(),
    resolveTenantId(),
    getSupportSession(),
  ])
  if (me?.role !== 'admin') return { error: 'Só o administrador da empresa monta as regras.' }
  if (!tenantId) return { error: 'Empresa não identificada.' }
  if (s && s.tenantId === tenantId) return { error: SUPPORT_READONLY_MESSAGE }
  const tf = await getTenantFeatures(tenantId)
  return { tenantId, userId: user.id, features: tf.features }
}
const dbFor = (g: { tenantId: string; userId: string }) => scopeAdminClient(createAdminClient(), g.tenantId, g.userId)

async function personOk(db: ReturnType<typeof dbFor>, tenantId: string, ids: string[]): Promise<boolean> {
  const list = [...new Set(ids.filter(x => x && x !== 'owner'))]
  if (!list.length) return true
  const { data } = await db.from('profiles').select('id').eq('tenant_id', tenantId).in('id', list)
  return (data ?? []).length === list.length
}

export async function saveAgentRule(id: string | null, raw: unknown): Promise<Result> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  const v = validateRule(raw, g.features)
  if ('error' in v) return { ok: false, error: v.error }
  const r = v.rule
  const db = dbFor(g)
  const dests = [r.actions.task?.assignee ?? '', r.actions.notify?.assignee ?? '', ...(r.actions.email?.to ?? [])]
  if (!(await personOk(db, g.tenantId, dests.filter(x => x && !x.startsWith('area:') && !x.includes('@'))))) return { ok: false, error: 'Pessoa não encontrada nesta empresa.' }
  const areaIds = [...new Set(dests.filter(x => x.startsWith('area:')).map(x => x.slice(5)))]
  if (areaIds.length) {
    const { data } = await db.from('org_areas').select('id').in('id', areaIds)
    if ((data ?? []).length !== areaIds.length) return { ok: false, error: 'Área não encontrada.' }
  }
  const fields = { agent: r.agent, name: r.name, criterion: r.criterion, threshold: r.threshold, executor: r.executor, conditions: r.conditions, actions: r.actions, days: r.days, enabled: r.enabled, updated_at: new Date().toISOString() }
  if (id) {
    const { error } = await db.from('agent_rules').update(fields).eq('id', id)
    if (error) return { ok: false, error: error.message }
    revalidatePath('/regras')
    return { ok: true, id }
  }
  const { count } = await db.from('agent_rules').select('id', { count: 'exact', head: true })
  if ((count ?? 0) >= MAX_RULES) return { ok: false, error: `Limite de ${MAX_RULES} regras.` }
  const { data, error } = await db.from('agent_rules').insert({ ...fields, created_by: g.userId }).select('id').single()
  if (error) return { ok: false, error: error.message }
  revalidatePath('/regras')
  return { ok: true, id: data.id as string }
}

export async function toggleAgentRule(id: string, enabled: boolean): Promise<Result> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  const { error } = await dbFor(g).from('agent_rules').update({ enabled, updated_at: new Date().toISOString() }).eq('id', id)
  return error ? { ok: false, error: error.message } : { ok: true }
}

export async function deleteAgentRule(id: string): Promise<Result> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  const { error } = await dbFor(g).from('agent_rules').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/regras')
  return { ok: true }
}

// Regras sugeridas (desligadas): a empresa revisa e liga as que quiser
export async function createSuggestedRules(): Promise<Result> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  const db = dbFor(g)
  const { data: existing } = await db.from('agent_rules').select('criterion, name')
  const have = new Set(((existing ?? []) as { name: string }[]).map(r => r.name))
  const rows = suggestedRules(g.features).filter(r => !have.has(r.name)).map(r => ({ ...r, created_by: g.userId }))
  if (!rows.length) return { ok: false, error: 'As regras sugeridas já estão na lista.' }
  const { error } = await db.from('agent_rules').insert(rows)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/regras')
  return { ok: true }
}

// Testar: o que a regra (como está no formulário) pegaria hoje e o que faria — nada é gravado
export type RulePreview = {
  ok: boolean; error?: string; found: number; fresh: number
  cases: { name: string; detail: string }[]
  items: { kind: 'tarefa' | 'aviso' | 'whatsapp' | 'email'; to: string; title: string; text: string }[]
}
export async function previewAgentRule(id: string | null, raw: unknown): Promise<RulePreview> {
  const empty: RulePreview = { ok: false, found: 0, fresh: 0, cases: [], items: [] }
  const g = await guard()
  if ('error' in g) return { ...empty, error: g.error }
  const v = validateRule(raw, g.features)
  if ('error' in v) return { ...empty, error: v.error }
  const { runPreview } = await import('@/lib/agent/agent-preview')
  const { runRule, findMatches } = await import('@/lib/agent/rules-engine')
  const db = dbFor(g)
  const rule = { ...v.rule, id: id ?? '00000000-0000-0000-0000-000000000000', tenant_id: g.tenantId, last_run_at: null }
  const { criterionDef } = await import('@/lib/agent/rules-catalog')
  if (criterionDef(rule.criterion)?.kind === 'evento') {
    // Evento: usa o caso mais recente desse tipo para mostrar o que sairia
    const { sampleEventRef } = await import('@/lib/agent/rules-engine')
    const ref = await sampleEventRef(db, rule.criterion as never, rule.conditions)
    if (!ref) return { ...empty, ok: true, error: 'Ainda não há nenhum caso desse tipo para testar. A regra roda na hora em que acontecer.' }
    const { loadActCtx, executeMatch } = await import('@/lib/agent/rules-actions')
    const run = await runPreview(async () => {
      const { eventMatchForPreview } = await import('@/lib/agent/rules-engine')
      const m = await eventMatchForPreview(db, rule.criterion as never, ref)
      if (!m) return { found: 0, fresh: 0, cases: [] as { name: string; detail: string }[] }
      const ctx = await loadActCtx(g.tenantId, db)
      await executeMatch(ctx, { ...rule }, m, new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10))
      return { found: 1, fresh: 1, cases: [{ name: `${m.name} (exemplo: o caso mais recente)`, detail: m.detail }] }
    })
    return { ...(await shapePreview(db, run.items, run.error)), found: run.result?.found ?? 0, fresh: run.result?.fresh ?? 0, cases: run.result?.cases ?? [] }
  }
  const matches = await findMatches(db, rule)
  const run = await runPreview(() => runRule(g.tenantId, rule))
  const shaped = await shapePreview(db, run.items, run.error)
  return { ...shaped, found: matches.length, fresh: run.result?.fresh ?? 0, cases: matches.slice(0, 30).map(m => ({ name: m.name, detail: m.detail })) }
}

// Itens da prévia → texto da tela (nomes das pessoas no lugar dos ids)
async function shapePreview(db: ReturnType<typeof dbFor>, previewItems: import('@/lib/agent/agent-preview').PreviewItem[], error?: string): Promise<RulePreview> {
  const run = { items: previewItems }
  const ids = [...new Set(run.items.flatMap(i => ('assignedTo' in i && i.assignedTo) ? [i.assignedTo] : (i.kind === 'aviso' && i.to) ? [i.to] : []))]
  const { data: people } = ids.length ? await db.from('profiles').select('id, full_name').in('id', ids) : { data: [] }
  const nameOf = new Map(((people ?? []) as { id: string; full_name: string | null }[]).map(p => [p.id, p.full_name ?? 'pessoa']))
  const items: RulePreview['items'] = run.items.flatMap((i): RulePreview['items'] => {
    if (i.kind === 'atividade') return [{ kind: 'tarefa', to: i.assignedTo ? nameOf.get(i.assignedTo) ?? 'pessoa' : 'sem responsável', title: i.title, text: i.content }]
    if (i.kind === 'aviso') return [{ kind: 'aviso', to: i.to ? nameOf.get(i.to) ?? 'pessoa' : 'ninguém (sem responsável)', title: 'Aviso no sino do CRM', text: i.text }]
    if (i.kind === 'whatsapp') return [{ kind: 'whatsapp', to: i.to ?? 'gestor (número não configurado)', title: 'WhatsApp', text: i.text }]
    if (i.kind === 'email') return [{ kind: 'email', to: i.to, title: i.subject, text: i.html.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&amp;/g, '&').replace(/\s+\n/g, '\n').trim() }]
    return []
  })
  return { ok: !error, error, found: 0, fresh: 0, cases: [], items: items.slice(0, 40) }
}
