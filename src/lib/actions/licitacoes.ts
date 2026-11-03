'use server'
// Licitações (PNCP): monitoramentos (admin), decisões no radar, análise do agente e "virar oportunidade".
// Sempre na empresa atual; nunca em acesso de suporte.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { scopeAdminClient } from '@/lib/tenant/scoped-admin'
import { resolveTenantId } from '@/lib/tenant/context'
import { getSupportSession, SUPPORT_READONLY_MESSAGE } from '@/lib/tenant/support'
import { getTenantFeatures } from '@/lib/config/tenant-features'
import { parseTerms, MATCH_STATUS, MODALIDADES, pncpUrl, termWords, stem, SEARCH_SITUACOES, type SearchSituacao, type MatchStatus, type PncpRow } from '@/lib/pncp/catalog'
import { normalizeUf } from '@/lib/geo/uf'

type Result = { ok: true } | { ok: false; error: string }
type G = { tenantId: string; userId: string; isAdmin: boolean; db: ReturnType<typeof createAdminClient> }

async function guard(adminOnly = false): Promise<G | { error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }
  const [{ data: me }, tenantId, s] = await Promise.all([
    supabase.from('profiles').select('role').eq('id', user.id).maybeSingle(),
    resolveTenantId(), getSupportSession(),
  ])
  if (!tenantId) return { error: 'Empresa não identificada.' }
  if (s && s.tenantId === tenantId) return { error: SUPPORT_READONLY_MESSAGE }
  const tf = await getTenantFeatures(tenantId)
  if (!tf.features.includes('licitacoes')) return { error: 'A aba Licitações não está liberada no plano da empresa.' }
  const isAdmin = me?.role === 'admin'
  if (adminOnly && !isAdmin) return { error: 'Só o administrador da empresa altera os monitoramentos.' }
  return { tenantId, userId: user.id, isAdmin, db: scopeAdminClient(createAdminClient(), tenantId, user.id) }
}

export type WatcherInput = {
  id?: string | null; name: string; keywords: string | string[]; exclude: string | string[]
  ufs: string[]; modalidades: number[]; min_value: number | null; max_value: number | null
  recipient_ids: string[]; area_ids: string[]; channels: { sino: boolean; whatsapp: boolean; email: boolean }
  ai_analysis: boolean; remind_days: number; enabled: boolean
}

export async function saveWatcher(input: WatcherInput): Promise<Result & { id?: string }> {
  const g = await guard(true)
  if ('error' in g) return { ok: false, error: g.error }
  const name = String(input.name ?? '').trim().slice(0, 80)
  if (!name) return { ok: false, error: 'Dê um nome ao monitoramento.' }
  const keywords = parseTerms(input.keywords)
  if (!keywords.length) return { ok: false, error: 'Informe ao menos uma palavra ou frase do objeto.' }
  if (keywords.some(k => k.length < 3)) return { ok: false, error: 'Cada palavra precisa ter ao menos 3 letras.' }
  const ufs = [...new Set((input.ufs ?? []).map(u => normalizeUf(u)).filter((u): u is string => !!u))]
  const valid = new Set(MODALIDADES.map(m => m.id))
  const modalidades = [...new Set((input.modalidades ?? []).map(Number).filter(m => valid.has(m)))]
  const minV = input.min_value === null || input.min_value === undefined || String(input.min_value) === '' ? null : Number(input.min_value)
  const maxV = input.max_value === null || input.max_value === undefined || String(input.max_value) === '' ? null : Number(input.max_value)
  if ((minV !== null && (!Number.isFinite(minV) || minV < 0)) || (maxV !== null && (!Number.isFinite(maxV) || maxV < 0))) return { ok: false, error: 'Valores inválidos.' }
  if (minV !== null && maxV !== null && minV > maxV) return { ok: false, error: 'O valor mínimo é maior que o máximo.' }
  const remind = Math.round(Number(input.remind_days))
  if (!Number.isFinite(remind) || remind < 0 || remind > 30) return { ok: false, error: 'Lembrete do prazo: de 0 a 30 dias antes.' }
  // Pessoas e áreas precisam ser da empresa
  const ids = [...new Set(input.recipient_ids ?? [])]
  if (ids.length) {
    const { data } = await g.db.from('profiles').select('id').in('id', ids)
    if ((data ?? []).length !== ids.length) return { ok: false, error: 'Escolha pessoas da própria empresa.' }
  }
  const areas = [...new Set(input.area_ids ?? [])]
  if (areas.length) {
    const { data } = await g.db.from('org_areas').select('id').in('id', areas)
    if ((data ?? []).length !== areas.length) return { ok: false, error: 'Área inválida.' }
  }
  if (!ids.length && !areas.length) return { ok: false, error: 'Escolha quem recebe os avisos (pessoa ou área).' }
  const row = {
    name, keywords, exclude: parseTerms(input.exclude), ufs, modalidades, min_value: minV, max_value: maxV,
    recipient_ids: ids, area_ids: areas,
    channels: { sino: input.channels?.sino !== false, whatsapp: !!input.channels?.whatsapp, email: !!input.channels?.email },
    ai_analysis: !!input.ai_analysis, remind_days: remind, enabled: input.enabled !== false, updated_at: new Date().toISOString(),
  }
  if (input.id) {
    const { error } = await g.db.from('pncp_watchers').update(row).eq('id', input.id)
    if (error) return { ok: false, error: error.message }
    revalidatePath('/licitacoes')
    return { ok: true, id: input.id }
  }
  const { data, error } = await g.db.from('pncp_watchers').insert({ ...row, created_by: g.userId }).select('id').single()
  if (error || !data) return { ok: false, error: error?.message ?? 'Não foi possível salvar.' }
  revalidatePath('/licitacoes')
  return { ok: true, id: data.id as string }
}

export async function deleteWatcher(id: string): Promise<Result> {
  const g = await guard(true)
  if ('error' in g) return { ok: false, error: g.error }
  const { error } = await g.db.from('pncp_watchers').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/licitacoes')
  return { ok: true }
}

// "Buscar agora": roda em segundo plano (a tela responde na hora) e avisa no sino quando terminar.
// Baixa os últimos dias dos estados/modalidades monitorados e confere os monitoramentos da empresa.
export async function searchNow(): Promise<{ ok: true; started: true } | { ok: false; error: string }> {
  const g = await guard(true)
  if ('error' in g) return { ok: false, error: g.error }
  const { count } = await g.db.from('pncp_watchers').select('id', { count: 'exact', head: true }).eq('enabled', true)
  if (!count) return { ok: false, error: 'Crie e ligue um monitoramento antes de buscar.' }
  const { tenantId, userId } = g
  const job = async () => {
    const { seedWatchers, matchTenant } = await import('@/lib/pncp/engine')
    const { notifyPerson } = await import('@/lib/agent/handoff')
    let text: string
    try {
      const numeros = await seedWatchers(tenantId, Date.now() + 200_000)
      const run = numeros.length ? await matchTenant(tenantId, { numeros, notify: false }) : { created: 0, analyzed: 0 }
      text = `🔎 Busca de licitações concluída: ${numeros.length} aberta(s) no PNCP com as palavras dos monitoramentos, ${run.created} nova(s) no radar` +
        `${run.analyzed ? `, ${run.analyzed} analisada(s) pelo agente` : ''}.`
    } catch (e) {
      text = `🔎 A busca de licitações falhou: ${(e as Error)?.message ?? 'erro'}. Tente de novo em alguns minutos.`
    }
    await notifyPerson(tenantId, userId, { text, subject: 'Busca de licitações' }, { sino: true, whatsapp: false, email: false })
  }
  try {
    const { after } = await import('next/server')
    after(job)
  } catch { await job() }
  return { ok: true, started: true }
}

export async function setMatchStatus(id: string, status: MatchStatus, note?: string): Promise<Result> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  if (!MATCH_STATUS.includes(status) || status === 'oportunidade') return { ok: false, error: 'Situação inválida.' }
  const patch: Record<string, unknown> = { status, decided_by: g.userId, updated_at: new Date().toISOString() }
  if (note !== undefined) patch.note = String(note).trim().slice(0, 1000) || null
  if (status === 'participar') patch.reminded_at = null
  const { error } = await g.db.from('pncp_matches').update(patch).eq('id', id).neq('status', 'oportunidade')
  if (error) return { ok: false, error: error.message }
  revalidatePath('/licitacoes')
  return { ok: true }
}

export async function assignMatch(id: string, userId: string | null): Promise<Result> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  if (userId) {
    const { data } = await g.db.from('profiles').select('id').eq('id', userId).maybeSingle()
    if (!data) return { ok: false, error: 'Pessoa inválida.' }
  }
  const { error } = await g.db.from('pncp_matches').update({ assigned_to: userId, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) return { ok: false, error: error.message }
  if (userId && userId !== g.userId) {
    const { data: m } = await g.db.from('pncp_matches').select('numero_controle').eq('id', id).maybeSingle()
    const { data: r } = m ? await createAdminClient().from('pncp_contratacoes').select('objeto, orgao_nome, uf').eq('numero_controle', m.numero_controle).maybeSingle() : { data: null }
    const { notifyPerson } = await import('@/lib/agent/handoff')
    await notifyPerson(g.tenantId, userId, { text: `🔎 Licitação atribuída a você: ${(r?.objeto as string | undefined)?.slice(0, 160) ?? ''} (${r?.orgao_nome ?? ''} · ${r?.uf ?? ''}). Veja em Licitações no CRM.`, subject: 'Licitação atribuída a você' })
  }
  revalidatePath('/licitacoes')
  return { ok: true }
}

export async function analyzeMatch(id: string): Promise<Result> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  const { data: m } = await g.db.from('pncp_matches').select('numero_controle, watcher_ids').eq('id', id).maybeSingle()
  if (!m) return { ok: false, error: 'Item não encontrado.' }
  const { data: row } = await createAdminClient().from('pncp_contratacoes').select('*').eq('numero_controle', m.numero_controle).maybeSingle()
  if (!row) return { ok: false, error: 'Contratação não encontrada.' }
  const { data: ws } = await g.db.from('pncp_watchers').select('name, keywords').in('id', (m.watcher_ids as string[]) ?? [])
  const { analyzeContratacao } = await import('@/lib/pncp/engine')
  const r = await analyzeContratacao(g.tenantId, row as PncpRow, (ws ?? []) as { name: string; keywords: string[] }[])
  if (!r.ok) return { ok: false, error: r.error }
  revalidatePath('/licitacoes')
  return { ok: true }
}

// Virar oportunidade: o órgão vira empresa (pelo CNPJ) e a contratação entra no funil escolhido
export async function convertMatch(id: string, pipelineId: string): Promise<{ ok: true; contractId: string } | { ok: false; error: string }> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  const { data: m } = await g.db.from('pncp_matches').select('id, numero_controle, status, contract_id, ai_summary, assigned_to').eq('id', id).maybeSingle()
  if (!m) return { ok: false, error: 'Item não encontrado.' }
  if (m.contract_id) return { ok: true, contractId: m.contract_id as string }
  const { data: rowData } = await createAdminClient().from('pncp_contratacoes').select('*').eq('numero_controle', m.numero_controle).maybeSingle()
  const row = rowData as PncpRow | null
  if (!row) return { ok: false, error: 'Contratação não encontrada.' }
  const { data: pipe } = await g.db.from('pipelines').select('id, type').eq('id', pipelineId).maybeSingle()
  if (!pipe || pipe.type !== 'vendas') return { ok: false, error: 'Escolha um funil de vendas.' }
  const { data: stage } = await g.db.from('stages').select('id').eq('pipeline_id', pipe.id).order('order_index').limit(1).maybeSingle()
  if (!stage) return { ok: false, error: 'O funil escolhido não tem etapas.' }

  // Órgão como empresa (reaproveita pelo CNPJ)
  const cnpj = String(row.orgao_cnpj ?? '').replace(/\D/g, '')
  let companyId: string | null = null
  if (cnpj.length === 14) {
    const { data: found } = await g.db.from('companies').select('id').eq('cnpj', cnpj).maybeSingle()
    companyId = (found?.id as string | undefined) ?? null
  }
  if (!companyId) {
    const { data: comp, error } = await g.db.from('companies').insert({
      name: row.orgao_nome ?? 'Órgão público', cnpj: cnpj.length === 14 ? cnpj : null, owner_id: g.userId, status: 'prospect',
      state: normalizeUf(row.uf), city: row.municipio,
    }).select('id').single()
    if (error || !comp) return { ok: false, error: `Falha ao criar o órgão: ${error?.message ?? ''}` }
    companyId = comp.id as string
  }

  let processNumber = `PNCP-${Date.now()}`
  try {
    const { data: seq } = await (await createClient()).rpc('next_opportunity_number' as never)
    if (seq) processNumber = seq as unknown as string
  } catch { /* usa o número provisório */ }
  const link = pncpUrl(row)
  const fmt = (v: number | null) => (v && v > 0 ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v) : 'não informado')
  const enc = row.data_encerramento ? new Date(row.data_encerramento).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—'
  const owner = (m.assigned_to as string | null) ?? g.userId
  const { data: contract, error: cErr } = await g.db.from('contracts').insert({
    process_number: processNumber,
    title: (row.objeto ?? 'Licitação').slice(0, 180),
    client_name: row.orgao_nome ?? 'Órgão público',
    description: [`Licitação PNCP ${row.numero_controle}`, `${row.modalidade_nome ?? ''} · ${row.unidade_nome ?? ''} — ${row.municipio ?? ''}/${row.uf ?? ''}`,
      `Valor estimado: ${fmt(row.valor_estimado)} · Propostas até: ${enc}`, link ? `Edital: ${link}` : '', row.link_origem ? `Sistema de origem: ${row.link_origem}` : '',
      '', row.objeto ?? '', m.ai_summary ? `\nAnálise do agente:\n${m.ai_summary}` : ''].filter(x => x !== null).join('\n').slice(0, 8000),
    company_id: companyId, owner_id: owner, current_assignee_id: owner,
    uf: normalizeUf(row.uf), municipality: row.municipio, lead_source: 'PNCP',
  }).select('id').single()
  if (cErr || !contract) return { ok: false, error: cErr?.message ?? 'Falha ao criar a oportunidade.' }
  const now = new Date().toISOString()
  const { data: run } = await g.db.from('pipeline_runs').insert({
    contract_id: contract.id, pipeline_id: pipe.id, stage_id: stage.id, stage_entered_at: now,
    value: row.valor_estimado && row.valor_estimado > 0 ? row.valor_estimado : 0, created_by: g.userId,
    expected_close_date: row.data_encerramento ? row.data_encerramento.slice(0, 10) : null,
  }).select('id').single()
  if (run) await g.db.from('stage_history').insert({ pipeline_run_id: run.id, stage_id: stage.id, entered_at: now, changed_by: g.userId })
  await g.db.from('activities').insert({ contract_id: contract.id, user_id: g.userId, type: 'system',
    content: `🔎 Oportunidade criada a partir da licitação ${row.numero_controle} (PNCP).${link ? ` Edital: ${link}` : ''}` })
  await g.db.from('pncp_matches').update({ status: 'oportunidade', contract_id: contract.id, decided_by: g.userId, updated_at: now }).eq('id', m.id)
  revalidatePath('/licitacoes'); revalidatePath('/pipeline')
  return { ok: true, contractId: contract.id as string }
}

// ── Pesquisa na base (resultado na hora) ─────────────────────────────────────
export type SearchInput = { q: string; uf?: string | null; modalidade?: number | null; situacao?: SearchSituacao; page?: number }
export type SearchHit = PncpRow & { match_id: string | null; match_status: MatchStatus | null; ai_score: number | null }
const SEARCH_PAGE = 30

export async function searchContratacoes(input: SearchInput): Promise<{ ok: true; rows: SearchHit[]; total: number; page: number; pages: number; live: boolean } | { ok: false; error: string }> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  const page = Math.max(1, Math.min(50, Math.round(Number(input.page) || 1)))
  const text = String(input.q ?? '').trim().slice(0, 200)
  const uf = normalizeUf(input.uf ?? null)
  const modalidade = input.modalidade ? Number(input.modalidade) : null
  const situacao: SearchSituacao = SEARCH_SITUACOES.some(x => x.id === input.situacao) ? input.situacao! : 'abertas'
  let rows: PncpRow[] = []
  let total = 0
  let live = true
  const { pncpLiveSearch } = await import('@/lib/pncp/engine')
  const r = await pncpLiveSearch({ q: text, situacao, uf, modalidade, page, size: SEARCH_PAGE })
  if (r) { rows = r.rows; total = r.total }
  else {
    // PNCP fora do ar: usa a cópia local (só o que o CRM já baixou)
    live = false
    let q = createAdminClient().from('pncp_contratacoes').select('*', { count: 'exact' })
    const nowIso = new Date().toISOString()
    if (situacao === 'abertas') q = q.or(`data_encerramento.is.null,data_encerramento.gte.${nowIso}`)
    if (situacao === 'encerradas') q = q.lt('data_encerramento', nowIso)
    if (text) {
      const tw = termWords(text)
      const parts = tw.phrase ? [tw.phrase] : tw.words.map(stem)
      for (const p of parts) q = q.ilike('objeto_norm', `%${p.replace(/[%_]/g, ' ')}%`)
    }
    if (uf) q = q.eq('uf', uf)
    if (modalidade) q = q.eq('modalidade_id', modalidade)
    const { data, count, error } = await q.order('data_encerramento', { ascending: situacao === 'abertas', nullsFirst: false })
      .range((page - 1) * SEARCH_PAGE, page * SEARCH_PAGE - 1)
    if (error) return { ok: false, error: 'O PNCP não respondeu e a cópia local falhou. Tente de novo em instantes.' }
    rows = (data ?? []) as PncpRow[]
    total = count ?? rows.length
  }
  // Abertas: as que encerram primeiro no topo (dentro da página)
  if (situacao === 'abertas') rows.sort((a, b) => (Date.parse(a.data_encerramento ?? '') || Infinity) - (Date.parse(b.data_encerramento ?? '') || Infinity))
  const { data: ms } = rows.length
    ? await g.db.from('pncp_matches').select('id, numero_controle, status, ai_score').in('numero_controle', rows.map(x => x.numero_controle))
    : { data: [] }
  const byId = new Map(((ms ?? []) as { id: string; numero_controle: string; status: MatchStatus; ai_score: number | null }[]).map(m => [m.numero_controle, m]))
  const pages = Math.max(1, Math.min(50, Math.ceil(total / SEARCH_PAGE)))
  return {
    ok: true, page, total, pages, live,
    rows: rows.map(x => { const m = byId.get(x.numero_controle); return { ...x, match_id: m?.id ?? null, match_status: m?.status ?? null, ai_score: m?.ai_score ?? null } }),
  }
}

// ── Detalhe (painel): itens e arquivos do edital direto do PNCP ─────────────
export type DetailItem = { numero: number; descricao: string; quantidade: number | null; unidade: string | null; valorUnitario: number | null; valorTotal: number | null; tipo: string | null }
export type DetailFile = { titulo: string; tipo: string | null; url: string }
export async function getContratacaoDetail(numero: string): Promise<{ ok: true; row: PncpRow; items: DetailItem[]; files: DetailFile[]; itemsTotal: number; match: { id: string; status: MatchStatus; ai_score: number | null; ai_summary: string | null; contract_id: string | null } | null; warn?: string } | { ok: false; error: string }> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  const { data } = await createAdminClient().from('pncp_contratacoes').select('*').eq('numero_controle', numero).maybeSingle()
  const row = data as PncpRow | null
  if (!row) return { ok: false, error: 'Licitação não encontrada na base.' }
  const { data: m } = await g.db.from('pncp_matches').select('id, status, ai_score, ai_summary, contract_id').eq('numero_controle', numero).maybeSingle()
  const base = row.orgao_cnpj && row.ano_compra && row.sequencial_compra ? `https://pncp.gov.br/api/pncp/v1/orgaos/${row.orgao_cnpj}/compras/${row.ano_compra}/${row.sequencial_compra}` : null
  const get = async (url: string) => {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 15_000)
    try { const r = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store', signal: ctrl.signal }); return r.ok ? await r.json() : null } catch { return null } finally { clearTimeout(t) }
  }
  let items: DetailItem[] = [], files: DetailFile[] = [], warn: string | undefined
  if (base) {
    const [it, ar, qt] = await Promise.all([get(`${base}/itens?pagina=1&tamanhoPagina=50`), get(`${base}/arquivos`), get(`${base}/itens/quantidade`)])
    if (Array.isArray(it)) items = (it as Record<string, unknown>[]).map(x => ({
      numero: Number(x.numeroItem) || 0, descricao: String(x.descricao ?? '').trim(), quantidade: x.quantidade === null ? null : Number(x.quantidade),
      unidade: (x.unidadeMedida as string | null) ?? null, valorUnitario: x.valorUnitarioEstimado === null ? null : Number(x.valorUnitarioEstimado),
      valorTotal: x.valorTotal === null ? null : Number(x.valorTotal), tipo: (x.materialOuServicoNome as string | null) ?? null,
    }))
    if (Array.isArray(ar)) files = (ar as Record<string, unknown>[]).filter(f => f.statusAtivo !== false).map(f => ({
      titulo: String(f.titulo ?? 'Arquivo'), tipo: (f.tipoDocumentoNome as string | null) ?? null, url: String(f.url ?? f.uri ?? ''),
    })).filter(f => /^https:\/\/pncp\.gov\.br\//.test(f.url))
    if (it === null && ar === null) warn = 'O PNCP não respondeu agora; itens e arquivos não carregaram. Tente abrir de novo.'
    return { ok: true, row, items, files, itemsTotal: typeof qt === 'number' ? qt : items.length, match: (m as never) ?? null, warn }
  }
  return { ok: true, row, items, files, itemsTotal: 0, match: (m as never) ?? null }
}

// Garante o item no radar da empresa (para decidir, analisar ou virar oportunidade a partir da pesquisa)
async function ensureMatch(g: G, numero: string): Promise<string | null> {
  const { data: m } = await g.db.from('pncp_matches').select('id').eq('numero_controle', numero).maybeSingle()
  if (m?.id) return m.id as string
  const { data: row } = await createAdminClient().from('pncp_contratacoes').select('numero_controle').eq('numero_controle', numero).maybeSingle()
  if (!row) return null
  const { data: ins } = await g.db.from('pncp_matches').insert({ numero_controle: numero, watcher_ids: [], status: 'analisando', assigned_to: g.userId }).select('id').single()
  return (ins?.id as string | undefined) ?? null
}

export async function saveToRadar(numero: string, status: MatchStatus = 'analisando'): Promise<Result & { id?: string }> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  const id = await ensureMatch(g, numero)
  if (!id) return { ok: false, error: 'Licitação não encontrada.' }
  if (status !== 'analisando') { const r = await setMatchStatus(id, status); if (!r.ok) return r }
  revalidatePath('/licitacoes')
  return { ok: true, id }
}

export async function analyzeNumero(numero: string): Promise<Result & { id?: string }> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  const id = await ensureMatch(g, numero)
  if (!id) return { ok: false, error: 'Licitação não encontrada.' }
  const r = await analyzeMatch(id)
  return r.ok ? { ok: true, id } : r
}

export async function convertNumero(numero: string, pipelineId: string): Promise<{ ok: true; contractId: string } | { ok: false; error: string }> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  const id = await ensureMatch(g, numero)
  if (!id) return { ok: false, error: 'Licitação não encontrada.' }
  return convertMatch(id, pipelineId)
}

// Admin: carrega mais dias antigos na base da pesquisa agora (em segundo plano; avisa no sino)
export async function loadBaseNow(): Promise<Result> {
  const g = await guard(true)
  if ('error' in g) return { ok: false, error: g.error }
  const { tenantId, userId } = g
  const job = async () => {
    const { backfillStep } = await import('@/lib/pncp/engine')
    const { notifyPerson } = await import('@/lib/agent/handoff')
    const started = Date.now()
    const days: string[] = []
    let saved = 0, done = false
    while (Date.now() - started < 220_000) {
      const b = await backfillStep(started + 240_000)
      if (b.day && !b.partial) days.push(b.day.split('-').reverse().join('/'))
      saved += b.saved
      if (b.done) { done = true; break }
      if (b.partial) break
    }
    const { count } = await createAdminClient().from('pncp_contratacoes').select('numero_controle', { count: 'exact', head: true })
    await notifyPerson(tenantId, userId, {
      text: done ? `🔎 A base de licitações já cobre os últimos 45 dias (${(count ?? 0).toLocaleString('pt-BR')} abertas).`
        : `🔎 Base de licitações: ${days.length} dia(s) carregado(s)${days.length ? ` (${days[days.length - 1]} a ${days[0]})` : ''}, ${saved} abertas a mais. Total: ${(count ?? 0).toLocaleString('pt-BR')}. Clique de novo para carregar mais.`,
      subject: 'Base de licitações',
    }, { sino: true, whatsapp: false, email: false })
  }
  try { const { after } = await import('next/server'); after(job) } catch { await job() }
  return { ok: true }
}
