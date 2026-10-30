// Dados das telas de estatísticas: site da empresa (Marketing → Páginas) e vitrine (Varejo → Visitas).
// Período em datas de São Paulo [from, to). Leitura pelo cliente com escopo da empresa.
import type { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { fetchAll } from '@/lib/revenue/dashboard-data'
import { PAID_STATUSES } from '@/lib/retail/customers'
import { change, daysBetween, pageKey, pageRef, sourceLabel, visitMetrics, type Period, type VisitMetrics, type VisitRow } from '@/lib/analytics/visits'

type Db = Awaited<ReturnType<typeof createScopedAdmin>>
const COLS = 'started_at, visited_on, visitor_day, duration_ms, engaged, host, path, utm_source, utm_medium, utm_campaign, campaign_code, referrer_host, device'
const spIso = (d: string) => new Date(new Date(d).getTime() - 3 * 3_600_000).toISOString().slice(0, 10)
// Limites do período em horário de São Paulo (00:00 -03:00)
const startOf = (day: string) => `${day}T03:00:00.000Z`

async function visits(db: Db, channel: 'site' | 'vitrine', from: string, to: string): Promise<VisitRow[]> {
  return fetchAll<VisitRow>((a, b) => db.from('page_visits').select(COLS).eq('channel', channel).gte('visited_on', from).lt('visited_on', to).order('started_at').range(a, b))
}

export type Delta = { now: number | null; before: number | null; change: number | null }
const delta = (now: number | null, before: number | null): Delta => ({ now, before, change: change(now, before) })
export type StatCards = { visits: Delta; uniques: Delta; bounce: Delta; avgMs: Delta }
function cards(now: VisitMetrics, before: VisitMetrics): StatCards {
  return { visits: delta(now.visits, before.visits), uniques: delta(now.uniques, before.uniques), bounce: delta(now.bounceRate, before.bounceRate), avgMs: delta(now.avgMs, before.avgMs) }
}
export type DayPoint = { day: string; visits: number; results: number }
export type SourceRow = { label: string; visits: number; results: number }

// ─── Site da empresa ─────────────────────────────────────────────────────────
type LeadRow = { id: string; name: string; created_at: string; status: string; landing_page: string | null; utm_source: string | null; utm_medium: string | null; referrer: string | null }
export type SitePage = { key: string; host: string; path: string; title: string | null; visits: number; leads: number }
export type SiteReport = {
  pages: SitePage[]; selected: string | null; hosts: string[]
  cards: StatCards; leads: Delta; conversion: Delta; won: Delta
  days: DayPoint[]; sources: SourceRow[]
  opportunities: { lead: string; title: string; status: 'ganha' | 'perdida' | 'aberta'; value: number | null }[]
}

export async function loadSiteReport(db: Db, period: Period, selected: string | null): Promise<SiteReport> {
  const [rows, prev, leadsNow, leadsPrev] = await Promise.all([
    visits(db, 'site', period.from, period.to),
    visits(db, 'site', period.prevFrom, period.prevTo),
    siteLeads(db, period.from, period.to),
    siteLeads(db, period.prevFrom, period.prevTo),
  ])
  const keyOfLead = (l: LeadRow) => { const r = l.landing_page ? pageRef(l.landing_page) : null; return r ? pageKey(r.host, r.path) : null }
  // Páginas do site: as que tiveram visita no período ou no anterior
  const byPage = new Map<string, SitePage>()
  for (const r of [...rows, ...prev]) {
    const k = pageKey(r.host, r.path)
    if (!byPage.has(k)) byPage.set(k, { key: k, host: r.host, path: r.path, title: null, visits: 0, leads: 0 })
  }
  for (const r of rows) byPage.get(pageKey(r.host, r.path))!.visits++
  const hosts = [...new Set([...byPage.values()].map(p => p.host))]
  for (const l of leadsNow) { const k = keyOfLead(l); if (k && byPage.has(k)) byPage.get(k)!.leads++ }
  const pages = [...byPage.values()].sort((a, b) => b.visits - a.visits || a.key.localeCompare(b.key))
  const sel = selected && byPage.has(selected) ? selected : null
  const inSel = (k: string | null, host: string) => (sel ? k === sel : hosts.includes(host))
  const leadHost = (l: LeadRow) => { const r = l.landing_page ? pageRef(l.landing_page) : null; return r?.host ?? '' }
  const pick = (list: VisitRow[]) => list.filter(r => inSel(pageKey(r.host, r.path), r.host))
  const pickLeads = (list: LeadRow[]) => list.filter(l => inSel(keyOfLead(l), leadHost(l)))
  const vNow = pick(rows), vPrev = pick(prev), lNow = pickLeads(leadsNow), lPrev = pickLeads(leadsPrev)
  const mNow = visitMetrics(vNow), mPrev = visitMetrics(vPrev)

  // Oportunidades e ganhos dos leads do período
  const opps = lNow.length ? await opportunitiesOf(db, lNow) : []
  const oppsPrev = lPrev.length ? await opportunitiesOf(db, lPrev) : []
  const wonNow = opps.filter(o => o.status === 'ganha').length, wonPrev = oppsPrev.filter(o => o.status === 'ganha').length

  const days = daysBetween(period.from, period.to).map(day => ({ day, visits: 0, results: 0 }))
  const di = new Map(days.map((d, i) => [d.day, i]))
  for (const r of vNow) { const i = di.get(r.visited_on); if (i !== undefined) days[i].visits++ }
  for (const l of lNow) { const i = di.get(spIso(l.created_at)); if (i !== undefined) days[i].results++ }

  const src = new Map<string, SourceRow>()
  const add = (label: string, k: 'visits' | 'results') => { const s = src.get(label) ?? { label, visits: 0, results: 0 }; s[k]++; src.set(label, s) }
  for (const r of vNow) add(sourceLabel(r), 'visits')
  for (const l of lNow) add(sourceLabel({ utm_source: l.utm_source, utm_medium: l.utm_medium, referrer_host: refHost(l.referrer) }), 'results')

  return {
    pages, selected: sel, hosts,
    cards: cards(mNow, mPrev),
    leads: delta(lNow.length, lPrev.length),
    conversion: delta(mNow.visits ? lNow.length / mNow.visits : null, mPrev.visits ? lPrev.length / mPrev.visits : null),
    won: delta(wonNow, wonPrev),
    days, sources: [...src.values()].sort((a, b) => b.visits - a.visits || b.results - a.results).slice(0, 12),
    opportunities: opps.slice(0, 50),
  }
}

function refHost(ref: string | null): string | null {
  if (!ref) return null
  try { return new URL(ref).hostname.toLowerCase().replace(/^www\./, '') } catch { return null }
}

async function siteLeads(db: Db, from: string, to: string): Promise<LeadRow[]> {
  return fetchAll<LeadRow>((a, b) => db.from('leads').select('id, name, created_at, status, landing_page, utm_source, utm_medium, referrer')
    .gte('created_at', startOf(from)).lt('created_at', startOf(to)).not('landing_page', 'is', null)
    .or('entry_type.is.null,entry_type.eq.inbound').order('created_at').range(a, b))
}

async function opportunitiesOf(db: Db, leads: LeadRow[]) {
  const name = new Map(leads.map(l => [l.id, l.name]))
  const ids = leads.map(l => l.id)
  const contracts: { id: string; lead_id: string; title: string | null }[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from('contracts').select('id, lead_id, title').in('lead_id', ids.slice(i, i + 200))
    contracts.push(...((data ?? []) as typeof contracts))
  }
  if (!contracts.length) return []
  const runs: { contract_id: string; status: string; value: number | null }[] = []
  const cids = contracts.map(c => c.id)
  for (let i = 0; i < cids.length; i += 200) {
    const { data } = await db.from('pipeline_runs').select('contract_id, status, value').in('contract_id', cids.slice(i, i + 200))
    runs.push(...((data ?? []) as typeof runs))
  }
  return contracts.map(c => {
    const rs = runs.filter(r => r.contract_id === c.id)
    const won = rs.find(r => r.status === 'won'), open = rs.some(r => r.status !== 'won' && r.status !== 'lost')
    const status: 'ganha' | 'perdida' | 'aberta' = won ? 'ganha' : open || !rs.length ? 'aberta' : 'perdida'
    const value = (won ?? rs[0])?.value ?? null
    return { lead: name.get(c.lead_id) ?? '', title: c.title ?? '', status, value: value === null ? null : Number(value) }
  }).sort((a, b) => (a.status === 'ganha' ? 0 : a.status === 'aberta' ? 1 : 2) - (b.status === 'ganha' ? 0 : b.status === 'aberta' ? 1 : 2))
}

// ─── Vitrine da loja ─────────────────────────────────────────────────────────
type OrderRow = { created_at: string; status: string; total: number; shipping: number | null; campaign_id: string | null }
export type StoreReport = {
  cards: StatCards; orders: Delta; paid: Delta; sold: Delta; conversion: Delta
  days: DayPoint[]; sources: SourceRow[]; campaigns: { name: string; visits: number; orders: number }[]
}
const PAID = new Set<string>(PAID_STATUSES)

export async function loadStoreReport(db: Db, period: Period): Promise<StoreReport> {
  const [vNow, vPrev, oNow, oPrev, { data: camps }] = await Promise.all([
    visits(db, 'vitrine', period.from, period.to),
    visits(db, 'vitrine', period.prevFrom, period.prevTo),
    storeOrders(db, period.from, period.to),
    storeOrders(db, period.prevFrom, period.prevTo),
    db.from('retail_campaigns').select('id, name, code').limit(500),
  ])
  const mNow = visitMetrics(vNow), mPrev = visitMetrics(vPrev)
  const sold = (l: OrderRow[]) => l.filter(o => PAID.has(o.status)).reduce((t, o) => t + Number(o.total ?? 0) - Number(o.shipping ?? 0), 0)
  const days = daysBetween(period.from, period.to).map(day => ({ day, visits: 0, results: 0 }))
  const di = new Map(days.map((d, i) => [d.day, i]))
  for (const r of vNow) { const i = di.get(r.visited_on); if (i !== undefined) days[i].visits++ }
  for (const o of oNow) { const i = di.get(spIso(o.created_at)); if (i !== undefined) days[i].results++ }
  const src = new Map<string, SourceRow>()
  for (const r of vNow) { const label = sourceLabel(r); const s = src.get(label) ?? { label, visits: 0, results: 0 }; s.visits++; src.set(label, s) }
  const list = (camps ?? []) as { id: string; name: string; code: string }[]
  const campaigns = list.map(c => ({ name: c.name, visits: vNow.filter(v => v.campaign_code === c.code).length, orders: oNow.filter(o => o.campaign_id === c.id).length }))
    .filter(c => c.visits || c.orders).sort((a, b) => b.visits - a.visits)
  return {
    cards: cards(mNow, mPrev),
    orders: delta(oNow.length, oPrev.length),
    paid: delta(oNow.filter(o => PAID.has(o.status)).length, oPrev.filter(o => PAID.has(o.status)).length),
    sold: delta(sold(oNow), sold(oPrev)),
    conversion: delta(mNow.visits ? oNow.length / mNow.visits : null, mPrev.visits ? oPrev.length / mPrev.visits : null),
    days, sources: [...src.values()].sort((a, b) => b.visits - a.visits).slice(0, 12), campaigns,
  }
}

async function storeOrders(db: Db, from: string, to: string): Promise<OrderRow[]> {
  const rows = await fetchAll<OrderRow>((a, b) => db.from('retail_orders').select('created_at, status, total, shipping, campaign_id')
    .eq('source', 'vitrine').gte('created_at', startOf(from)).lt('created_at', startOf(to)).order('created_at').range(a, b))
  return rows.filter(o => o.status !== 'cancelado')
}
