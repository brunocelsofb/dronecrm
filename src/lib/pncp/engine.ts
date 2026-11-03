// ─── Licitações (PNCP) · rotina ──────────────────────────────────────────────
// 1. Baixa do PNCP as contratações publicadas no período (API pública, por modalidade e estado)
//    e guarda só as que ainda dá para disputar, uma vez para todas as empresas.
// 2. Para cada empresa, confere os monitoramentos, grava o que bateu, avisa quem a empresa escolheu
//    e (se ligado) pede ao agente de IA a análise do objeto.
// 3. Lembra o prazo de proposta do que a empresa marcou "Vamos participar".
// Rotina da plataforma: admin client, sempre filtrando tenant_id.

import { createAdminClient } from '@/lib/supabase/admin'
import {
  SEARCH_MODALIDADES, SEARCH_SITUACOES, PNCP_SEARCH_URL, pncpSearchQuery, mapSearchItem, type SearchSituacao, mapCompra, matchWatcher, isOpen, termWords, pncpUrl, modalidadeNome,
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

// ── Busca por palavra no PNCP (a mesma do portal), em qualquer período ──────────
// Guarda o que veio na cópia local, para o painel, o radar e o funil usarem a mesma linha.
export async function pncpLiveSearch(opts: { q: string; situacao: SearchSituacao; uf?: string | null; modalidade?: number | null; de?: string | null; ate?: string | null; page: number; size: number }):
  Promise<{ rows: PncpRow[]; total: number } | null> {
  const sit = SEARCH_SITUACOES.find(x => x.id === opts.situacao) ?? SEARCH_SITUACOES[0]
  const q = new URLSearchParams({ tipos_documento: 'edital', ordenacao: '-data', pagina: String(opts.page), tam_pagina: String(opts.size) })
  const query = pncpSearchQuery(opts.q)
  if (query) q.set('q', query)
  if (sit.api) q.set('status', sit.api)
  if (opts.uf) q.set('ufs', opts.uf)
  if (opts.modalidade) q.set('modalidades', String(opts.modalidade))
  if (opts.de) q.set('data_publicacao_inicio', opts.de)
  if (opts.ate) q.set('data_publicacao_fim', opts.ate)
  let j: { items?: Record<string, unknown>[]; total?: number } | null = null
  for (let attempt = 0; attempt < 2 && !j; attempt++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 20_000)
    try {
      const r = await fetch(`${PNCP_SEARCH_URL}?${q}`, { headers: { Accept: 'application/json' }, cache: 'no-store', signal: ctrl.signal })
      if (r.ok) j = await r.json()
    } catch { /* tenta de novo */ } finally { clearTimeout(timer) }
  }
  if (!j) return null
  const rows = (j.items ?? []).map(mapSearchItem).filter((r): r is PncpRow => !!r)
  if (rows.length) {
    await createAdminClient().from('pncp_contratacoes')
      .upsert(rows.map(r => ({ ...r, baixado_em: new Date().toISOString() })), { onConflict: 'numero_controle' })
  }
  return { rows, total: Number(j.total ?? rows.length) }
}

// Procura no PNCP cada linha dos monitoramentos da empresa (só abertas, qualquer data de publicação).
// Assim o radar acha também o que foi publicado antes de o monitoramento existir.
export async function seedWatchers(tenantId: string, deadlineMs: number): Promise<string[]> {
  const watchers = await loadWatchers(tenantId)
  const numeros = new Set<string>()
  for (const w of watchers) {
    const ufs = w.ufs.length === 1 ? w.ufs : [null]
    const mods = w.modalidades.length === 1 ? w.modalidades : [null]
    for (const term of w.keywords) for (const uf of ufs) for (const mod of mods) {
      for (let page = 1; page <= 4; page++) {
        if (Date.now() > deadlineMs) return [...numeros]
        const r = await pncpLiveSearch({ q: term, situacao: 'abertas', uf, modalidade: mod, page, size: 50 })
        if (!r) break
        for (const row of r.rows) numeros.add(row.numero_controle)
        if (page * 50 >= r.total) break
      }
    }
  }
  return [...numeros]
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
  const { data: existing } = await admin.from('pncp_matches').select('id, numero_controle, watcher_ids').eq('tenant_id', tenantId).in('numero_controle', [...hits.keys()])
  const ex = (existing ?? []) as { id: string; numero_controle: string; watcher_ids: string[] | null }[]
  const have = new Set(ex.map(e => e.numero_controle))
  // Já estava no radar: só registra quais monitoramentos atuais também acham (sem avisar de novo)
  const liveIds = new Set(watchers.map(w => w.id))
  for (const e of ex) {
    const h = hits.get(e.numero_controle)
    if (!h) continue
    const next = [...new Set([...(e.watcher_ids ?? []).filter(w => liveIds.has(w)), ...h.watcherIds])]
    const cur = e.watcher_ids ?? []
    if (next.length !== cur.length || next.some(w => !cur.includes(w))) await admin.from('pncp_matches').update({ watcher_ids: next }).eq('id', e.id).eq('tenant_id', tenantId)
  }
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

// ── Base para a pesquisa: carrega os dias anteriores, um por vez, até BACKFILL_DAYS ─────────────
export const BACKFILL_DAYS = 45
export async function backfillStep(deadlineMs: number): Promise<{ day: string | null; saved: number; done: boolean; partial: boolean }> {
  const admin = createAdminClient()
  const { data } = await admin.from('pncp_sync_state').select('value').eq('key', 'backfill').maybeSingle()
  const st = (data?.value ?? {}) as { next?: string; mods_done?: number[] }
  const today = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)
  const limit = new Date(Date.parse(`${today}T12:00:00Z`) - BACKFILL_DAYS * 86_400_000).toISOString().slice(0, 10)
  const day = st.next ?? new Date(Date.parse(`${today}T12:00:00Z`) - 2 * 86_400_000).toISOString().slice(0, 10)
  if (day < limit) return { day: null, saved: 0, done: true, partial: false }
  const d = new Date(`${day}T15:00:00Z`)
  // Uma modalidade por vez, guardando o progresso: se o tempo acabar no meio do dia,
  // a próxima rodada continua da modalidade que faltou (não repete o dia inteiro).
  const done = new Set(st.mods_done ?? [])
  let saved = 0
  for (const mod of SEARCH_MODALIDADES) {
    if (done.has(mod)) continue
    if (Date.now() > deadlineMs - 20_000) return { day, saved, done: false, partial: true }
    const r = await syncPublications({ from: d, to: d, ufs: null, modalidades: [mod], deadlineMs })
    saved += r.saved
    if (r.partial) return { day, saved, done: false, partial: true }
    done.add(mod)
    await admin.from('pncp_sync_state').upsert({ key: 'backfill', value: { next: day, mods_done: [...done] }, updated_at: new Date().toISOString() })
  }
  const prev = new Date(Date.parse(`${day}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
  await admin.from('pncp_sync_state').upsert({ key: 'backfill', value: { next: prev, mods_done: [] }, updated_at: new Date().toISOString() })
  return { day, saved, done: false, partial: false }
}

// ── Acompanhamento das licitações que a empresa disputa ─────────────────────────
// Para as marcadas "Vamos participar" ou que viraram oportunidade: lê no PNCP a situação de cada
// item e o vencedor; se mudou desde a última leitura, guarda e avisa quem a empresa escolheu
// (configuração da inteligência) e o responsável pela licitação.
export type PncpSettings = { own_cnpjs: string[]; recipient_ids: string[]; channels: { sino?: boolean; whatsapp?: boolean; email?: boolean } }

export async function loadPncpSettings(tenantId: string): Promise<PncpSettings> {
  const { data } = await createAdminClient().from('pncp_settings').select('own_cnpjs, recipient_ids, channels').eq('tenant_id', tenantId).maybeSingle()
  const d = (data ?? {}) as Partial<PncpSettings>
  const c = d.channels ?? {}
  return { own_cnpjs: d.own_cnpjs ?? [], recipient_ids: d.recipient_ids ?? [], channels: { sino: c.sino !== false, email: c.email !== false, whatsapp: c.whatsapp === true } }
}

// Foto do acompanhamento guardada em pncp_matches.result: situação, prazos, arquivos e itens/vencedores.
export type TrackSnap = {
  sig: string; situacao: string | null; situacao_id: number | null; encerramento: string | null; abertura: string | null
  arquivos: string[]; res: import('./results').Resultado | null; lidoEm: string
  log: { at: string; lines: string[] }[]
}
const brDateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')

// O que mudou entre duas fotos, em frases curtas
function diffSnap(a: TrackSnap | null, b: TrackSnap): string[] {
  const out: string[] = []
  if (!a) return out
  if (a.situacao !== b.situacao) out.push(`Situação no PNCP: ${a.situacao ?? '—'} → ${b.situacao ?? '—'}`)
  if (a.encerramento !== b.encerramento) out.push(`Prazo das propostas: ${brDateTime(a.encerramento)} → ${brDateTime(b.encerramento)}`)
  if (a.abertura !== b.abertura) out.push(`Abertura: ${brDateTime(a.abertura)} → ${brDateTime(b.abertura)}`)
  const novos = b.arquivos.filter(f => !a.arquivos.includes(f))
  for (const f of novos.slice(0, 5)) out.push(`Novo arquivo no edital: ${f}`)
  const ai = new Map((a.res?.itens ?? []).map(i => [i.numero, i]))
  for (const i of b.res?.itens ?? []) {
    const p = ai.get(i.numero)
    if (p && p.situacao !== i.situacao) out.push(`Item ${i.numero}: ${p.situacao} → ${i.situacao}`)
    const was = new Set((p?.vencedores ?? []).map(v => v.ni))
    for (const v of i.vencedores) if (!was.has(v.ni)) out.push(`Item ${i.numero}: vencedor ${v.nome} (${BRL(v.valorTotal)})`)
  }
  return out
}

// Lê no PNCP a situação, os arquivos e (depois da sessão) o resultado; guarda e devolve o que mudou.
export async function refreshMatchResult(tenantId: string, matchId: string, row: PncpRow, settings: PncpSettings, prev: TrackSnap | { sig?: string } | null) {
  const { fetchResultado, fetchCompraHead, fetchArquivos, outcomeFor } = await import('./results')
  const admin = createAdminClient()
  const head = await fetchCompraHead(row)
  let cur = row
  if (head) {
    const m = mapCompra(head)
    if (m) { cur = { ...row, ...m, objeto_norm: m.objeto_norm || row.objeto_norm }; await admin.from('pncp_contratacoes').update({ ...m, baixado_em: new Date().toISOString() }).eq('numero_controle', row.numero_controle) }
  }
  const sessaoPassou = !cur.data_encerramento || Date.parse(cur.data_encerramento) < Date.now()
  const [arquivos, res] = await Promise.all([
    fetchArquivos(cur),
    sessaoPassou || head?.existeResultado === true ? fetchResultado(cur) : Promise.resolve(null),
  ])
  if (!head && arquivos === null && !res) return null   // PNCP fora do ar
  const old = prev && 'lidoEm' in prev ? (prev as TrackSnap) : null
  const snap: TrackSnap = {
    sig: '', situacao: cur.situacao_nome, situacao_id: cur.situacao_id, encerramento: cur.data_encerramento, abertura: cur.data_abertura,
    arquivos: arquivos ?? old?.arquivos ?? [], res: res ?? old?.res ?? null, lidoEm: new Date().toISOString(), log: old?.log ?? [],
  }
  snap.sig = [snap.situacao, snap.encerramento, snap.abertura, snap.arquivos.length, snap.res?.sig ?? ''].join('#')
  const lines = diffSnap(old, snap)
  if (lines.length) snap.log = [{ at: snap.lidoEm, lines }, ...snap.log].slice(0, 30)
  const out = snap.res ? outcomeFor(snap.res, cur, settings.own_cnpjs)
    : { status: (cur.situacao_id === 2 || cur.situacao_id === 3 ? 'cancelada' : 'aguardando') as import('./results').Outcome, wonValue: 0, winners: [] as string[] }
  const changed = !old || old.sig !== snap.sig
  const patch: Record<string, unknown> = {
    tracked_at: snap.lidoEm, result: snap, result_status: out.status, won_value: out.wonValue || null,
    homologado_value: snap.res?.homologadoTotal || null, winners: out.winners,
  }
  if (out.status !== 'aguardando' && changed) patch.result_at = snap.lidoEm
  await admin.from('pncp_matches').update(patch).eq('id', matchId).eq('tenant_id', tenantId)
  return { res: snap.res, out, changed, lines, first: !old, snap, row: cur }
}

export async function trackParticipations(tenantId: string, deadlineMs: number, onlyIds?: string[]): Promise<{ tracked: number; checked: number; changed: number; notified: number; failed: number }> {
  const admin = createAdminClient()
  const run = { tracked: 0, checked: 0, changed: 0, notified: 0, failed: 0 }
  const settings = await loadPncpSettings(tenantId)
  let q = admin.from('pncp_matches')
    .select('id, numero_controle, assigned_to, decided_by, result, result_status, tracked_at')
    .eq('tenant_id', tenantId).in('status', ['participar', 'oportunidade'])
    .or('result_status.is.null,result_status.eq.aguardando')
  if (onlyIds?.length) q = q.in('id', onlyIds)
  const { data } = await q.order('tracked_at', { ascending: true, nullsFirst: true }).limit(80)
  const list = (data ?? []) as { id: string; numero_controle: string; assigned_to: string | null; decided_by: string | null; result: TrackSnap | null }[]
  run.tracked = list.length
  if (!list.length) return run
  const { data: rows } = await admin.from('pncp_contratacoes').select('*').in('numero_controle', list.map(l => l.numero_controle))
  const byId = new Map(((rows ?? []) as PncpRow[]).map(r => [r.numero_controle, r]))
  const { notifyPerson } = await import('@/lib/agent/handoff')
  const { OUTCOME_LABEL } = await import('./results')
  for (const m of list) {
    if (Date.now() > deadlineMs) break
    const row = byId.get(m.numero_controle)
    if (!row) continue
    if (row.data_encerramento && Date.now() - Date.parse(row.data_encerramento) > 365 * 86_400_000) continue
    const r = await refreshMatchResult(tenantId, m.id, row, settings, m.result)
    if (!r) { run.failed++; continue }
    run.checked++
    if (!r.changed) continue
    run.changed++
    // Primeira leitura: só avisa se já há algo fora do normal (suspensa, revogada, com resultado)
    const lines = r.first
      ? [`Acompanhamento iniciado. Situação no PNCP: ${r.snap.situacao ?? '—'}; propostas até ${brDateTime(r.snap.encerramento)}.`,
         ...(r.res?.comResultado ? [`${r.res.comResultado} item(ns) com vencedor.`] : [])]
      : r.lines
    if (r.first && r.snap.situacao_id === 1 && !r.res?.comResultado) continue
    if (!lines.length) continue
    const head = r.out.status === 'ganhou' ? `🏆 Ganhamos ${BRL(r.out.wonValue)}` : r.out.status !== 'aguardando' ? `📣 ${OUTCOME_LABEL[r.out.status]}` : '📣 Novidade na licitação'
    const text = `${head} · ${r.row.orgao_nome ?? ''} (${r.row.uf ?? ''})\n${(r.row.objeto ?? '').slice(0, 160)}\n\n${lines.map(l => `• ${l}`).join('\n')}` +
      `${pncpUrl(r.row) ? `\n\nEdital: ${pncpUrl(r.row)}` : ''}\n${appUrl()}/licitacoes`
    const to = new Set([...settings.recipient_ids, ...(m.assigned_to ? [m.assigned_to] : m.decided_by ? [m.decided_by] : [])])
    for (const u of to) {
      const ch = await notifyPerson(tenantId, u, { text, subject: `Licitação: ${lines[0].slice(0, 80)} · ${r.row.orgao_nome ?? ''}` }, settings.channels)
      if (ch.length) run.notified++
    }
  }
  return run
}
