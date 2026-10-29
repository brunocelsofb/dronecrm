// ─── Anúncios do Meta (regras puras, sem imports) ────────────────────────────
// A conexão é da empresa e serve a mais de um módulo:
// - Varejo: campanhas da loja, link da vitrine com ?c=codigo
// - Marketing: campanhas da empresa, link com utm_campaign=codigo
// O Drone lê do Meta o gasto, o alcance e os cliques de cada campanha de anúncio e soma
// no investimento da campanha do Drone ligada a ela (pelo código no link ou à mão).

export const META_GRAPH_DEFAULT = 'v23.0'
export const BIO_CODE = 'bio'
export type AdsModule = 'varejo' | 'marketing'

function findCodes(text: string, param: string, max: number): string[] {
  const out = new Set<string>()
  const raw = String(text ?? '')
  let decoded = raw
  try { decoded = decodeURIComponent(raw) } catch { /* texto com % solto: usa como veio */ }
  const re = new RegExp(`(?:^|[?&"])${param}=([a-z0-9][a-z0-9_-]{0,${max - 1}})(?![a-z0-9_-])`, 'gi')
  for (const t of [raw, decoded]) for (const m of t.matchAll(re)) out.add(m[1].toLowerCase())
  return [...out]
}
// Códigos de campanha do Varejo (c=...) no texto do criativo (links, url_tags)
export const codesInText = (text: string) => findCodes(text, 'c', 40).filter(c => !c.includes('_'))
// Códigos de campanha do Marketing (utm_campaign=...)
export const utmCodesInText = (text: string) => findCodes(text, 'utm_campaign', 80)

export type MetaCampaignStat = { meta_campaign_id: string; name: string; status: string | null; spend: number; reach: number; impressions: number; clicks: number; codes: string[]; utm_codes: string[] }
export type MetaMonth = { meta_campaign_id: string; year: number; month: number; spend: number }

// Campanhas do Meta ligadas a uma campanha do Drone (pelo código do link ou à mão)
export function linkedMeta(stats: MetaCampaignStat[], campaign: { code: string; meta_campaign_ids?: string[] | null }, mod: AdsModule = 'varejo'): MetaCampaignStat[] {
  const manual = new Set(campaign.meta_campaign_ids ?? [])
  const code = String(campaign.code ?? '').toLowerCase()
  return stats.filter(s => manual.has(s.meta_campaign_id) || (!!code && (mod === 'varejo' ? s.codes : s.utm_codes).includes(code)))
}

export function sumMeta(list: MetaCampaignStat[]) {
  return list.reduce((t, s) => ({ spend: t.spend + s.spend, reach: t.reach + s.reach, impressions: t.impressions + s.impressions, clicks: t.clicks + s.clicks }), { spend: 0, reach: 0, impressions: 0, clicks: 0 })
}

// Gasto do Meta por campanha do Marketing e mês, no formato dos custos lançados à mão
export function metaMonthlyCosts(stats: MetaCampaignStat[], months: MetaMonth[], campaigns: { id: string; utm_campaign: string | null; meta_campaign_ids?: string[] | null }[]) {
  const out = new Map<string, { campaign_id: string; year: number; month: number; amount: number }>()
  for (const c of campaigns) {
    const ids = new Set(linkedMeta(stats, { code: c.utm_campaign ?? '', meta_campaign_ids: c.meta_campaign_ids }, 'marketing').map(s => s.meta_campaign_id))
    for (const m of months) {
      if (!ids.has(m.meta_campaign_id) || !m.spend) continue
      const k = `${c.id}|${m.year}|${m.month}`
      const cur = out.get(k) ?? { campaign_id: c.id, year: m.year, month: m.month, amount: 0 }
      cur.amount = Math.round((cur.amount + m.spend) * 100) / 100
      out.set(k, cur)
    }
  }
  return [...out.values()]
}

// Situação do acesso: sem data (acesso que não vence), vencido, vence logo (até 10 dias) ou ok
export function tokenState(expiresAt: string | null, now: Date): 'ok' | 'vence-logo' | 'vencido' {
  if (!expiresAt) return 'ok'
  const left = Date.parse(expiresAt) - now.getTime()
  if (left <= 0) return 'vencido'
  return left < 10 * 86_400_000 ? 'vence-logo' : 'ok'
}

// Permissões pedidas no login (sem configId):
// - ads_read: gasto, alcance e cliques das campanhas
// - pages_show_list, pages_manage_metadata, pages_read_engagement, leads_retrieval: leads dos formulários (Lead Ads)
export const META_SCOPES = ['ads_read', 'pages_show_list', 'pages_manage_metadata', 'pages_read_engagement', 'leads_retrieval']

// Endereço da tela de autorização do Meta. Com configId (Login do Facebook para Empresas)
// as permissões vêm da configuração do app; sem ele, pede a lista acima.
export function metaAuthUrl(o: { version: string; appId: string; redirectUri: string; state: string; configId?: string | null; scopes?: string[] }): string {
  const q = new URLSearchParams({ client_id: o.appId, redirect_uri: o.redirectUri, state: o.state, response_type: 'code' })
  if (o.configId) q.set('config_id', o.configId)
  else q.set('scope', (o.scopes?.length ? o.scopes : META_SCOPES).join(','))
  return `https://www.facebook.com/${o.version}/dialog/oauth?${q.toString()}`
}

// Para onde voltar depois de conectar
export const ADS_RETURN: Record<AdsModule, string> = { varejo: '/varejo/anuncios', marketing: '/marketing/anuncios' }
export const isAdsModule = (v: unknown): v is AdsModule => v === 'varejo' || v === 'marketing'

// "act_123" ou "123" → "123"
export const adAccountNumber = (v: string) => String(v ?? '').replace(/^act_/, '').replace(/\D/g, '')

export function num(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0 }

// Respostas do formulário (field_data do Meta) → campos do lead.
// Perguntas padrão do Meta: full_name, first_name, last_name, email, phone_number, company_name,
// job_title, city… As demais (perguntas personalizadas) vão para a mensagem, "pergunta: resposta".
export type MetaFieldData = { name?: string; values?: unknown[] }[]
export function metaLeadFields(fields: MetaFieldData) {
  const map = new Map<string, string>()
  const extra: string[] = []
  const KNOWN = new Set(['full_name', 'first_name', 'last_name', 'email', 'phone_number', 'phone', 'company_name', 'company', 'cnpj'])
  for (const f of fields ?? []) {
    const key = String(f?.name ?? '').trim().toLowerCase()
    const val = (f?.values ?? []).map(v => String(v ?? '').trim()).filter(Boolean).join(', ')
    if (!key || !val) continue
    if (KNOWN.has(key)) { if (!map.has(key)) map.set(key, val); continue }
    extra.push(`${String(f.name).replace(/_/g, ' ').replace(/\?$/, '')}: ${val}`)
  }
  const name = map.get('full_name') || [map.get('first_name'), map.get('last_name')].filter(Boolean).join(' ')
  const email = map.get('email') ?? null
  return {
    name: (name || email || 'Lead do Meta').slice(0, 200),
    email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email.toLowerCase().slice(0, 200) : null,
    phone: (map.get('phone_number') ?? map.get('phone') ?? null)?.slice(0, 40) ?? null,
    company_name: (map.get('company_name') ?? map.get('company') ?? null)?.slice(0, 200) ?? null,
    cnpj: map.get('cnpj')?.slice(0, 20) ?? null,
    message: extra.length ? extra.join('\n').slice(0, 2000) : null,
  }
}

// Aviso do Meta (webhook "leadgen" da página) → lista de leads novos
export type LeadgenChange = { leadgen_id: string; page_id: string; form_id: string | null; ad_id: string | null; created_time: number | null }
export function leadgenChanges(body: unknown): LeadgenChange[] {
  const b = (body && typeof body === 'object' ? body : {}) as { object?: string; entry?: { changes?: { field?: string; value?: Record<string, unknown> }[] }[] }
  if (b.object !== 'page') return []
  const out: LeadgenChange[] = []
  for (const e of b.entry ?? []) for (const c of e.changes ?? []) {
    const v = c.value ?? {}
    if (c.field !== 'leadgen' || !v.leadgen_id || !v.page_id) continue
    out.push({ leadgen_id: String(v.leadgen_id), page_id: String(v.page_id), form_id: v.form_id ? String(v.form_id) : null, ad_id: v.ad_id ? String(v.ad_id) : null, created_time: Number(v.created_time) || null })
  }
  return out
}
