// Dados do Meta para as telas (sem o acesso: ele nunca sai do servidor). Conexão da empresa.
import type { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import type { MetaCampaignStat, MetaMonth } from '@/lib/ads/meta'

type Db = Awaited<ReturnType<typeof createScopedAdmin>>
export type MetaConnectionInfo = {
  userName: string | null; accounts: { id: string; name: string; currency: string; active?: boolean }[]
  adAccountId: string | null; adAccountName: string | null; currency: string | null
  expiresAt: string | null; lastSyncAt: string | null; lastError: string | null
}

export async function loadMeta(db: Db): Promise<{ conn: MetaConnectionInfo | null; stats: MetaCampaignStat[] }> {
  const { data: c } = await db.from('ads_meta_connections').select('meta_user_name, accounts, ad_account_id, ad_account_name, currency, token_expires_at, last_sync_at, last_error').maybeSingle()
  if (!c) return { conn: null, stats: [] }
  const conn: MetaConnectionInfo = {
    userName: (c.meta_user_name as string | null) ?? null, accounts: (c.accounts ?? []) as MetaConnectionInfo['accounts'],
    adAccountId: (c.ad_account_id as string | null) ?? null, adAccountName: (c.ad_account_name as string | null) ?? null, currency: (c.currency as string | null) ?? null,
    expiresAt: (c.token_expires_at as string | null) ?? null, lastSyncAt: (c.last_sync_at as string | null) ?? null, lastError: (c.last_error as string | null) ?? null,
  }
  if (!conn.adAccountId) return { conn, stats: [] }
  const { data } = await db.from('ads_meta_campaigns').select('meta_campaign_id, name, status, spend, reach, impressions, clicks, codes, utm_codes').eq('ad_account_id', conn.adAccountId).order('spend', { ascending: false }).limit(1000)
  const stats = ((data ?? []) as MetaCampaignStat[]).map(s => ({ ...s, spend: Number(s.spend), reach: Number(s.reach), impressions: Number(s.impressions), clicks: Number(s.clicks), codes: s.codes ?? [], utm_codes: s.utm_codes ?? [] }))
  return { conn, stats }
}

// Gasto por mês das campanhas da conta escolhida
export async function loadMetaMonths(db: Db, adAccountId: string | null): Promise<MetaMonth[]> {
  if (!adAccountId) return []
  const { data } = await db.from('ads_meta_campaign_months').select('meta_campaign_id, year, month, spend').eq('ad_account_id', adAccountId).limit(20000)
  return ((data ?? []) as MetaMonth[]).map(m => ({ ...m, spend: Number(m.spend) }))
}
