// ─── Varejo: anúncios do Meta (regras puras, sem imports) ────────────────────
// O Drone lê do Meta o gasto, o alcance e os cliques de cada campanha de anúncio
// e soma ao investimento da campanha do Drone ligada a ela. A ligação é automática
// quando o link do anúncio tem ?c=codigo (o link da campanha do Drone) ou feita à mão.

export const META_GRAPH_DEFAULT = 'v23.0'
export const BIO_CODE = 'bio'

// Códigos de campanha do Drone (c=...) que aparecem no texto do criativo (links, url_tags)
export function codesInText(text: string): string[] {
  const out = new Set<string>()
  const raw = String(text ?? '')
  let decoded = raw
  try { decoded = decodeURIComponent(raw) } catch { /* texto com % solto: usa como veio */ }
  const re = /(?:^|[?&"])c=([a-z0-9][a-z0-9-]{0,39})(?![a-z0-9-])/gi
  for (const t of [raw, decoded]) for (const m of t.matchAll(re)) out.add(m[1].toLowerCase())
  return [...out]
}

export type MetaCampaignStat = { meta_campaign_id: string; name: string; status: string | null; spend: number; reach: number; impressions: number; clicks: number; codes: string[] }

// Campanhas do Meta ligadas a uma campanha do Drone (pelo código do link ou à mão)
export function linkedMeta(stats: MetaCampaignStat[], campaign: { code: string; meta_campaign_ids?: string[] | null }): MetaCampaignStat[] {
  const manual = new Set(campaign.meta_campaign_ids ?? [])
  return stats.filter(s => manual.has(s.meta_campaign_id) || s.codes.includes(campaign.code))
}

export function sumMeta(list: MetaCampaignStat[]) {
  return list.reduce((t, s) => ({ spend: t.spend + s.spend, reach: t.reach + s.reach, impressions: t.impressions + s.impressions, clicks: t.clicks + s.clicks }), { spend: 0, reach: 0, impressions: 0, clicks: 0 })
}

// Situação do acesso: sem data (token que não vence), vencido, vence logo (até 10 dias) ou ok
export function tokenState(expiresAt: string | null, now: Date): 'ok' | 'vence-logo' | 'vencido' {
  if (!expiresAt) return 'ok'
  const left = Date.parse(expiresAt) - now.getTime()
  if (left <= 0) return 'vencido'
  return left < 10 * 86_400_000 ? 'vence-logo' : 'ok'
}

// Endereço da tela de autorização do Meta. Com configId (Login do Facebook para Empresas)
// as permissões vêm da configuração do app; sem ele, pede só ads_read.
export function metaAuthUrl(o: { version: string; appId: string; redirectUri: string; state: string; configId?: string | null }): string {
  const q = new URLSearchParams({ client_id: o.appId, redirect_uri: o.redirectUri, state: o.state, response_type: 'code' })
  if (o.configId) q.set('config_id', o.configId)
  else q.set('scope', 'ads_read')
  return `https://www.facebook.com/${o.version}/dialog/oauth?${q.toString()}`
}

// "act_123" ou "123" → "123"
export const adAccountNumber = (v: string) => String(v ?? '').replace(/^act_/, '').replace(/\D/g, '')

export function num(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0 }
