// ─── Licitações (PNCP) · rotina ──────────────────────────────────────────────
// 1. Baixa do PNCP as contratações publicadas no período (API pública, por modalidade e estado)
//    e guarda só as que ainda dá para disputar, uma vez para todas as empresas.
// 2. Para cada empresa, confere os monitoramentos, grava o que bateu, avisa quem a empresa escolheu
//    e (se ligado) pede ao agente de IA a análise do objeto.
// 3. Lembra o prazo de proposta do que a empresa marcou "Vamos participar".
// Rotina da plataforma: admin client, sempre filtrando tenant_id.

import { createAdminClient } from '@/lib/supabase/admin'
import {
  SEARCH_MODALIDADES, mapCompra, matchWatcher, isOpen, termWords, pncpUrl, modalidadeNome,
  type PncpRow, type WatcherRule,
} from './catalog'

const API = 'https://pncp.gov.br/api/consulta/v1'
const PAGE = 50
const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.comercialdrone.com.br').replace(/\/+$/, '')
const ymd = (d: Date) => new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 10).replace(/-/g, '')
const BRL = (v: number | null) => (v && v > 0 ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v) : 'valor não informado')
const brDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—')

async function getPage(url: string): Promise<{ data: Record<string, unknown>[]; totalPaginas: number } | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 30_000)
      const r = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store', signal: ctrl.signal })
      clearTimeout(timer)
      if (r.status === 204) return { data: [], totalPaginas: 0 }
      if (!r.ok) continue
      const j = (await r.json()) as { data?: Record<string, unknown>[]; totalPaginas?: number }
      return { data: j.data ?? [], totalPaginas: Number(j.totalPaginas ?? 0) }
    } catch { /* tenta de novo */ }
  }
  return null
}

export type SyncResult = { pages: number; fetched: number; saved: number; partial: boolean; failed: number; numeros: string[] }

/**
 * Baixa as publicações de [from, to] (datas) das modalidades e estados pedidos e guarda as que estão abertas.
 * ufs = null → país inteiro. Para no prazo (deadlineMs) e avisa que ficou parcial.
 */
// Estados pedidos: muitos (ou todos) viram uma busca só no país inteiro (bem mais rápido que um por um)
export function ufScope(ufs: string[] | null | undefined): string[] | null {
  if (!ufs || ufs.length === 0 || ufs.length > 8) return null
  return ufs
}

const CONCURRENCY = 6

export async function syncPublications(opts: { from: Date; to: Date; ufs: string[] | null; modalidades?: number[]; deadlineMs: number }): Promise<SyncResult> {
  const admin = createAdminClient()
  const res: SyncResult = { pages: 0, fetched: 0, saved: 0, partial: false, failed: 0, numeros: [] }
  const mods = opts.modalidades?.length ? opts.modalidades : SEARCH_MODALIDADES
  const scope = ufScope(opts.ufs)
  const ufs: (string | null)[] = scope ?? [null]
  const nowMs = Date.now()
  const urlFor = (mod: number, uf: string | null, page: number) => {
    const q = new URLSearchParams({ dataInicial: ymd(opts.from), dataFinal: ymd(opts.to), codigoModalidadeContratacao: String(mod), pagina: String(page), tamanhoPagina: String(PAGE) })
    if (uf) q.set('uf', uf)
    return `${API}/contratacoes/publicacao?${q}`
  }
  const save = async (data: Record<string, unknown>[]) => {
    res.fetched += data.length
    const rows = data.map(mapCompra).filter((r): r is PncpRow => !!r && isOpen(r, nowMs))
    if (!rows.length) return
    const { error } = await admin.from('pncp_contratacoes').upsert(rows.map(r => ({ ...r, baixado_em: new Date().toISOString() })), { onConflict: 'numero_controle' })
    if (!error) { res.saved += rows.length; res.numeros.push(...rows.map(r => r.numero_controle)) }
  }
  // 1ª página de cada combinação (descobre quantas páginas há), depois as demais — várias ao mesmo tempo
  const queue: { mod: number; uf: string | null; page: number }[] = []
  for (const mod of mods) for (const uf of ufs) queue.push({ mod, uf, page: 1 })
  const worker = async () => {
    while (queue.length) {
      if (Date.now() > opts.deadlineMs) { res.partial = true; return }
      const job = queue.shift()!
      const p = await getPage(urlFor(job.mod, job.uf, job.page))
      if (!p) { res.failed++; continue }
      res.pages++
      await save(p.data)
      if (job.page === 1) for (let pg = 2; pg <= p.totalPaginas; pg++) queue.push({ mod: job.mod, uf: job.uf, page: pg })
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  if (queue.length) res.partial = true
  return res
}

// ── Monitoramentos da empresa ────────────────────────────────────────────────
export type WatcherRow = WatcherRule & {
  id: string; tenant_id: string; name: string; enabled: boolean
  recipient_ids: string[]; area_ids: string[]; channels: { sino?: boolean; whatsapp?: boolean; email?: boolean }
  ai_analysis: boolean; remind_days: number
}

async function loadWatchers(tenantId: string): Promise<WatcherRow[]> {
  const { data } = await createAdminClient().from('pncp_watchers').select('*').eq('tenant_id', tenantId).eq('enabled', true)
  return ((data ?? []) as Record<string, unknown>[]).map(w => ({
    id: String(w.id), tenant_id: String(w.tenant_id), name: String(w.name), enabled: true,
    keywords: (w.keywords as string[]) ?? [], exclude: (w.exclude as string[]) ?? [], ufs: (w.ufs as string[]) ?? [],
    modalidades: (w.modalidades as number[]) ?? [],
    min_value: w.min_value === null || w.min_value === undefined ? null : Number(w.min_value),
    max_value: w.max_value === null || w.max_value === undefined ? null : Number(w.max_value),
    recipient_ids: (w.recipient_ids as string[]) ?? [], area_ids: (w.area_ids as string[]) ?? [],
    channels: (w.channels ?? {}) as WatcherRow['channels'], ai_analysis: w.ai_analysis === true, remind_days: Number(w.remind_days ?? 3),
  }))
}

// Estados que alguma empresa monitora (null = alguém monitora o país inteiro)
export async function watchedUfs(): Promise<string[] | null> {
  const { data } = await createAdminClient().from('pncp_watchers').select('ufs').eq('enabled', true)
  const rows = (data ?? []) as { ufs: string[] | null }[]
  if (!rows.length) return []
  if (rows.some(r => !r.ufs || r.ufs.length === 0)) return null
  return ufScope([...new Set(rows.flatMap(r => r.ufs ?? []))])
}

// Pessoas que recebem o aviso do monitoramento: escolhidas + coordenador e gerente das áreas
async function recipientsOf(tenantId: string, w: WatcherRow): Promise<string[]> {
  const ids = new Set(w.recipient_ids)
  if (w.area_ids.length) {
    const { data } = await createAdminClient().from('org_areas').select('lead_id, manager_id').eq('tenant_id', tenantId).in('id', w.area_ids)
    for (const a of (data ?? []) as { lead_id: string | null; manager_id: string | null }[]) { if (a.lead_id) ids.add(a.lead_id); if (a.manager_id) ids.add(a.manager_id) }
  }
  return [...ids]
}

// Candidatas abertas no banco para os monitoramentos (pré-filtro por palavra no banco, conferência fina no código)
async function candidates(watchers: WatcherRow[], numeros?: string[]): Promise<PncpRow[]> {
  const admin = createAdminClient()
  const nowIso = new Date().toISOString()
  // Pré-filtro no banco: a palavra mais longa de cada linha (a conferência completa é feita depois)
  const terms = [...new Set(watchers.flatMap(w => w.keywords.map(k => {
    const tw = termWords(k)
    return tw.phrase ?? [...tw.words].sort((a, b) => b.length - a.length)[0] ?? ''
  })))].map(t => t.replace(/[%,()*."]/g, ' ').trim()).filter(t => t.length >= 3)
  if (!terms.length) return []
  const out: PncpRow[] = []
  const base = () => admin.from('pncp_contratacoes').select('*')
    .or(`data_encerramento.is.null,data_encerramento.gte.${nowIso}`)
    .or(terms.map(t => `objeto_norm.ilike.*${t}*`).join(','))
  if (numeros) {
    for (let i = 0; i < numeros.length; i += 300) {
      const { data } = await base().in('numero_controle', numeros.slice(i, i + 300))
      out.push(...((data ?? []) as PncpRow[]))
    }
    return out
  }
  for (let from = 0; from < 10_000; from += 1000) {
    const { data } = await base().order('data_publicacao', { ascending: false }).range(from, from + 999)
    out.push(...((data ?? []) as PncpRow[]))
    if (!data || data.length < 1000) break
  }
  return out
}

export type MatchRun = { watchers: number; candidates: number; created: number; notified: number; analyzed: number }

/** Confere os monitoramentos da empresa; numeros = só essas contratações (rotina diária) ou todas as abertas. */
export async function matchTenant(tenantId: string, opts: { numeros?: string[]; notify?: boolean; analyze?: boolean } = {}): Promise<MatchRun> {
  const admin = createAdminClient()
  const run: MatchRun = { watchers: 0, candidates: 0, created: 0, notified: 0, analyzed: 0 }
  const watchers = await loadWatchers(tenantId)
  run.watchers = watchers.length
  if (!watchers.length) return run
  const rows = (await candidates(watchers, opts.numeros)).filter(r => isOpen(r, Date.now()))
  run.candidates = rows.length
  await admin.from('pncp_watchers').update({ last_run_at: new Date().toISOString() }).eq('tenant_id', tenantId).in('id', watchers.map(w => w.id))
  const hits = new Map<string, { row: PncpRow; watcherIds: string[] }>()
  for (const r of rows) for (const w of watchers) if (matchWatcher(r, w).length) {
    const h = hits.get(r.numero_controle) ?? { row: r, watcherIds: [] }
    h.watcherIds.push(w.id); hits.set(r.numero_controle, h)
  }
  if (!hits.size) return run
  const { data: existing } = await admin.from('pncp_matches').select('numero_controle').eq('tenant_id', tenantId).in('numero_controle', [...hits.keys()])
  const have = new Set(((existing ?? []) as { numero_controle: string }[]).map(e => e.numero_controle))
  const fresh = [...hits.values()].filter(h => !have.has(h.row.numero_controle))
  for (let i = 0; i < fresh.length; i += 200) {
    const { error } = await admin.from('pncp_matches').insert(fresh.slice(i, i + 200).map(h => ({ tenant_id: tenantId, numero_controle: h.row.numero_controle, watcher_ids: h.watcherIds })))
    if (!error) run.created += Math.min(200, fresh.length - i)
  }

  // Análise do agente de IA (monitoramentos com a análise ligada), até 15 por rodada
  if (opts.analyze !== false) {
    const want = fresh.filter(h => h.watcherIds.some(id => watchers.find(w => w.id === id)?.ai_analysis)).slice(0, 15)
    for (const h of want) {
      const r = await analyzeContratacao(tenantId, h.row, watchers.filter(w => h.watcherIds.includes(w.id)))
      if (!r.ok) break   // sem IA, sem chave ou sem orçamento: para as outras
      run.analyzed++
    }
  }

  // Aviso por monitoramento: um resumo por pessoa
  if (opts.notify !== false && fresh.length) {
    const { notifyPerson } = await import('@/lib/agent/handoff')
    for (const w of watchers) {
      const mine = fresh.filter(h => h.watcherIds.includes(w.id))
      if (!mine.length) continue
      const top = mine.slice(0, 5).map(h => `• ${h.row.uf ?? ''} · ${h.row.orgao_nome ?? ''}: ${(h.row.objeto ?? '').slice(0, 140)} (${BRL(h.row.valor_estimado)}; propostas até ${brDate(h.row.data_encerramento)})`).join('\n')
      const text = `🔎 Licitações · ${w.name}: ${mine.length} nova(s)\n${top}${mine.length > 5 ? `\n… e mais ${mine.length - 5}` : ''}\n\nVeja e decida no CRM: ${appUrl()}/licitacoes`
      for (const u of await recipientsOf(tenantId, w)) {
        const ch = await notifyPerson(tenantId, u, { text, subject: `Licitações: ${mine.length} nova(s) em "${w.name}"` }, w.channels)
        if (ch.length) run.notified++
      }
    }
    await admin.from('pncp_matches').update({ notified_at: new Date().toISOString() }).eq('tenant_id', tenantId).in('numero_controle', fresh.map(h => h.row.numero_controle))
  }
  return run
}

// ── Análise do objeto pelo agente de IA ─────────────────────────────────────
export async function analyzeContratacao(tenantId: string, row: PncpRow, watchers: Pick<WatcherRow, 'name' | 'keywords'>[]): Promise<{ ok: true; score: number; summary: string } | { ok: false; error: string }> {
  const admin = createAdminClient()
  const { data: org } = await admin.from('organization_settings').select('ai_paused, company_name').eq('tenant_id', tenantId).maybeSingle()
  if (org?.ai_paused) return { ok: false, error: 'Modo sem IA ligado.' }
  const { loadTheoTenantAi, monthUsage } = await import('@/lib/ai/theo-server')
  const ai = await loadTheoTenantAi(tenantId)
  if (!ai.provider || !ai.key || !ai.model) return { ok: false, error: 'IA da empresa não configurada.' }
  if ((await monthUsage(tenantId)).total >= ai.budgetUsd) return { ok: false, error: 'Orçamento de IA do mês esgotado.' }
  const { data: tags } = await admin.from('tags').select('name').eq('tenant_id', tenantId).limit(30)
  const servicos = ((tags ?? []) as { name: string }[]).map(t => t.name).join(', ')
  const { runTheo } = await import('@/lib/ai/theo-engine')
  const { estimateCostUsd } = await import('@/lib/ai/theo-catalog')
  const r = await runTheo({
    provider: ai.provider as never, model: ai.model, key: ai.key, tools: [],
    system: [
      'Você é o agente Hunter (novos negócios) de um CRM. Analise uma contratação pública para a empresa decidir se participa.',
      'Responda só em JSON válido, sem texto fora dele: {"nota": 0-100, "resumo": "...", "atencao": ["..."]}.',
      'nota = aderência do objeto ao que a empresa vende (0 nada a ver, 100 exatamente o que ela faz).',
      'resumo: 2 ou 3 frases em português do Brasil dizendo o que o órgão quer comprar e por que combina ou não.',
      'atencao: até 4 pontos de atenção (prazo curto, escopo misturado, exigências, valor). Use só os dados informados; não invente.',
    ].join('\n'),
    history: [{ role: 'user', text: [
      `Empresa: ${org?.company_name ?? ''}`,
      `O que a empresa vende (serviços/tags): ${servicos || '—'}`,
      `Monitoramentos que encontraram: ${watchers.map(w => `${w.name} (${w.keywords.join(', ')})`).join(' | ')}`,
      '',
      `Órgão: ${row.orgao_nome ?? ''} — ${row.municipio ?? ''}/${row.uf ?? ''}`,
      `Modalidade: ${row.modalidade_nome ?? modalidadeNome(row.modalidade_id)}`,
      `Valor estimado: ${BRL(row.valor_estimado)}`,
      `Propostas até: ${brDate(row.data_encerramento)}`,
      `Objeto: ${row.objeto ?? ''}`,
      row.info_complementar ? `Informação complementar: ${row.info_complementar.slice(0, 1500)}` : '',
    ].join('\n') }],
    read: async () => '',
  })
  if (r.tokensIn || r.tokensOut) {
    const { scopeAdminClient } = await import('@/lib/tenant/scoped-admin')
    await scopeAdminClient(admin, tenantId, null).from('assistant_usage_log').insert({
      user_id: null, input_tokens: r.tokensIn, output_tokens: r.tokensOut, provider: ai.provider, model: ai.model,
      cost_usd: estimateCostUsd(ai.provider as never, ai.model, r.tokensIn, r.tokensOut),
    })
  }
  if (r.error || !r.text.trim()) return { ok: false, error: r.error ?? 'A IA não respondeu.' }
  const m = r.text.match(/\{[\s\S]*\}/)
  let score = 0, summary = r.text.trim().slice(0, 1500)
  try {
    const j = JSON.parse(m ? m[0] : r.text) as { nota?: number; resumo?: string; atencao?: string[] }
    score = Math.max(0, Math.min(100, Math.round(Number(j.nota) || 0)))
    summary = [String(j.resumo ?? '').trim(), ...(Array.isArray(j.atencao) ? j.atencao.slice(0, 4).map(a => `⚠ ${String(a).trim()}`) : [])].filter(Boolean).join('\n').slice(0, 1500)
  } catch { /* guarda o texto como veio */ }
  await admin.from('pncp_matches').update({ ai_score: score, ai_summary: summary, ai_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId).eq('numero_controle', row.numero_controle)
  return { ok: true, score, summary }
}

// ── Lembrete de prazo do que a empresa vai disputar ─────────────────────────
export async function remindDeadlines(tenantId: string): Promise<number> {
  const admin = createAdminClient()
  const { data } = await admin.from('pncp_matches').select('id, numero_controle, assigned_to, watcher_ids, decided_by')
    .eq('tenant_id', tenantId).eq('status', 'participar').is('reminded_at', null).limit(200)
  const list = (data ?? []) as { id: string; numero_controle: string; assigned_to: string | null; watcher_ids: string[]; decided_by: string | null }[]
  if (!list.length) return 0
  const watchers = await loadWatchers(tenantId)
  const { data: rows } = await admin.from('pncp_contratacoes').select('*').in('numero_controle', list.map(l => l.numero_controle))
  const byId = new Map(((rows ?? []) as PncpRow[]).map(r => [r.numero_controle, r]))
  const { notifyPerson } = await import('@/lib/agent/handoff')
  let sent = 0
  for (const m of list) {
    const r = byId.get(m.numero_controle)
    if (!r?.data_encerramento) continue
    const days = Math.max(...watchers.filter(w => m.watcher_ids.includes(w.id)).map(w => w.remind_days), 3)
    const left = Math.ceil((Date.parse(r.data_encerramento) - Date.now()) / 86_400_000)
    if (left > days || left < 0) continue
    const to = m.assigned_to ?? m.decided_by
    if (!to) continue
    const link = pncpUrl(r)
    await notifyPerson(tenantId, to, {
      text: `⏰ Hunter: as propostas de "${(r.objeto ?? '').slice(0, 120)}" (${r.orgao_nome ?? ''} · ${r.uf ?? ''}) encerram em ${left} dia(s), ${brDate(r.data_encerramento)}.${link ? `\nEdital: ${link}` : ''}\n${appUrl()}/licitacoes`,
      subject: `Prazo de proposta em ${left} dia(s): ${r.orgao_nome ?? ''}`,
    })
    await admin.from('pncp_matches').update({ reminded_at: new Date().toISOString() }).eq('id', m.id).eq('tenant_id', tenantId)
    sent++
  }
  return sent
}

// Limpa a cópia: encerradas há mais de 60 dias que nenhuma empresa guardou
export async function pruneOld(): Promise<void> {
  const admin = createAdminClient()
  const cut = new Date(Date.now() - 60 * 86_400_000).toISOString()
  const { data } = await admin.from('pncp_contratacoes').select('numero_controle').lt('data_encerramento', cut).limit(2000)
  const ids = ((data ?? []) as { numero_controle: string }[]).map(d => d.numero_controle)
  if (!ids.length) return
  const { data: kept } = await admin.from('pncp_matches').select('numero_controle').in('numero_controle', ids)
  const keep = new Set(((kept ?? []) as { numero_controle: string }[]).map(k => k.numero_controle))
  const drop = ids.filter(id => !keep.has(id))
  for (let i = 0; i < drop.length; i += 300) await admin.from('pncp_contratacoes').delete().in('numero_controle', drop.slice(i, i + 300))
}
