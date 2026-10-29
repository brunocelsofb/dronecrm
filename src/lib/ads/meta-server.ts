// ─── Conexão da empresa com o Meta Ads (servidor) ────────────────────────────
// O app do Meta é da plataforma (variáveis META_APP_ID e META_APP_SECRET no Vercel);
// sem elas a conexão aparece como "em breve". Cada empresa conecta a própria conta de
// anúncios com um clique (Entrar com o Facebook) e o Drone lê só números (ads_read):
// gasto, alcance, impressões e cliques no link de cada campanha (total e por mês).
// A mesma conexão serve ao Varejo (campanhas da loja) e ao Marketing (campanhas da empresa).
// Rotina da plataforma (cron e retorno do login): usa o cliente admin com tenant_id explícito.

import { createHmac } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { encryptSecret, decryptSecret } from '@/lib/ai/tenant-key'
import { META_GRAPH_DEFAULT, adAccountNumber, codesInText, utmCodesInText, num } from '@/lib/ads/meta'

export type MetaConfig = { appId: string; secret: string; configId: string | null; version: string }
export function metaConfig(): MetaConfig | null {
  const appId = process.env.META_APP_ID?.trim()
  const secret = process.env.META_APP_SECRET?.trim()
  if (!appId || !secret) return null
  const v = process.env.META_GRAPH_VERSION?.trim()
  return { appId, secret, configId: process.env.META_CONFIG_ID?.trim() || null, version: v && /^v\d+\.\d+$/.test(v) ? v : META_GRAPH_DEFAULT }
}

type Json = Record<string, unknown>
class MetaError extends Error {}

async function graphGet(cfg: MetaConfig, path: string, token: string, params: Record<string, string> = {}): Promise<Json> {
  const q = new URLSearchParams({ ...params, access_token: token, appsecret_proof: createHmac('sha256', cfg.secret).update(token).digest('hex') })
  return fetchJson(`https://graph.facebook.com/${cfg.version}/${path.replace(/^\/+/, '')}?${q.toString()}`)
}
async function fetchJson(url: string): Promise<Json> {
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(20_000) })
  const body = (await res.json().catch(() => ({}))) as Json
  if (!res.ok || body.error) {
    const e = (body.error ?? {}) as Json
    throw new MetaError(String(e.message ?? `Meta respondeu ${res.status}`).slice(0, 300))
  }
  return body
}
// Lista com páginas (segue paging.next até o limite)
async function graphAll(cfg: MetaConfig, path: string, token: string, params: Record<string, string>, maxPages = 10): Promise<Json[]> {
  const out: Json[] = []
  let page = await graphGet(cfg, path, token, params)
  for (let i = 0; i < maxPages; i++) {
    out.push(...((page.data ?? []) as Json[]))
    const next = ((page.paging ?? {}) as Json).next
    if (typeof next !== 'string' || !next.startsWith('https://graph.facebook.com/')) break
    page = await fetchJson(next)
  }
  return out
}

// Login: troca o código por um acesso de longa duração e lê as contas de anúncio da pessoa
export async function finishMetaLogin(cfg: MetaConfig, code: string, redirectUri: string) {
  const short = await fetchJson(`https://graph.facebook.com/${cfg.version}/oauth/access_token?${new URLSearchParams({ client_id: cfg.appId, client_secret: cfg.secret, redirect_uri: redirectUri, code })}`)
  let token = String(short.access_token ?? '')
  let expiresIn = num(short.expires_in)
  if (!token) throw new MetaError('O Meta não devolveu o acesso.')
  try {
    const long = await fetchJson(`https://graph.facebook.com/${cfg.version}/oauth/access_token?${new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: cfg.appId, client_secret: cfg.secret, fb_exchange_token: token })}`)
    if (long.access_token) { token = String(long.access_token); expiresIn = num(long.expires_in) }
  } catch { /* fica com o acesso curto; a tela avisa quando vencer */ }
  const me = await graphGet(cfg, 'me', token, { fields: 'name' })
  const accounts = (await graphAll(cfg, 'me/adaccounts', token, { fields: 'account_id,name,currency,account_status', limit: '100' }, 3))
    .map(a => ({ id: adAccountNumber(String(a.account_id ?? a.id ?? '')), name: String(a.name ?? ''), currency: String(a.currency ?? ''), active: num(a.account_status) === 1 }))
    .filter(a => a.id)
  return { token, expiresAt: expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : null, userName: String(me.name ?? ''), accounts }
}

export async function saveMetaConnection(tenantId: string, userId: string, r: Awaited<ReturnType<typeof finishMetaLogin>>) {
  const one = r.accounts.length === 1 ? r.accounts[0] : null
  const { error } = await createAdminClient().from('ads_meta_connections').upsert({
    tenant_id: tenantId, token_enc: encryptSecret(r.token), token_expires_at: r.expiresAt, meta_user_name: r.userName,
    accounts: r.accounts, ad_account_id: one?.id ?? null, ad_account_name: one?.name ?? null, currency: one?.currency ?? null,
    connected_by: userId, connected_at: new Date().toISOString(), last_error: null,
  }, { onConflict: 'tenant_id' })
  if (error) throw new Error(error.message)
}

// Atualiza os números das campanhas do Meta de uma empresa (desde o início de cada campanha)
export async function syncMetaAds(tenantId: string): Promise<{ ok: true; campaigns: number } | { ok: false; error: string }> {
  const cfg = metaConfig()
  if (!cfg) return { ok: false, error: 'Conexão com o Meta ainda não liberada na plataforma.' }
  const admin = createAdminClient()
  const { data: conn } = await admin.from('ads_meta_connections').select('token_enc, ad_account_id').eq('tenant_id', tenantId).maybeSingle()
  if (!conn) return { ok: false, error: 'Meta não conectado.' }
  if (!conn.ad_account_id) return { ok: false, error: 'Escolha a conta de anúncios.' }
  const act = `act_${adAccountNumber(String(conn.ad_account_id))}`
  try {
    const token = decryptSecret(String(conn.token_enc))
    const [camps, insights] = await Promise.all([
      graphAll(cfg, `${act}/campaigns`, token, { fields: 'id,name,effective_status', limit: '500' }),
      graphAll(cfg, `${act}/insights`, token, { level: 'campaign', fields: 'campaign_id,campaign_name,spend,reach,impressions,inline_link_clicks,date_start,date_stop', date_preset: 'maximum', limit: '500' }),
    ])
    // Links dos anúncios (para ligar sozinho pela ?c=codigo). Se falhar, a ligação à mão continua valendo.
    const codes = new Map<string, Set<string>>()
    const utm = new Map<string, Set<string>>()
    try {
      const ads = await graphAll(cfg, `${act}/ads`, token, { fields: 'campaign_id,creative{object_story_spec,asset_feed_spec,url_tags}', limit: '200' }, 5)
      for (const a of ads) {
        const id = String(a.campaign_id ?? '')
        if (!id) continue
        const text = JSON.stringify(a.creative ?? {})
        const set = codes.get(id) ?? new Set<string>()
        for (const c of codesInText(text)) set.add(c)
        codes.set(id, set)
        const uset = utm.get(id) ?? new Set<string>()
        for (const c of utmCodesInText(text)) uset.add(c)
        utm.set(id, uset)
      }
    } catch (e) { console.warn('[meta-ads] links dos anúncios:', e instanceof Error ? e.message : e) }
    const byId = new Map<string, Json>(insights.map(i => [String(i.campaign_id), i]))
    const now = new Date().toISOString()
    const rows = camps.map(c => {
      const id = String(c.id)
      const i = byId.get(id) ?? {}
      return {
        tenant_id: tenantId, ad_account_id: adAccountNumber(act), meta_campaign_id: id, name: String(c.name ?? i.campaign_name ?? '').slice(0, 300),
        status: String(c.effective_status ?? '') || null, spend: num(i.spend), reach: Math.round(num(i.reach)), impressions: Math.round(num(i.impressions)),
        clicks: Math.round(num(i.inline_link_clicks)), codes: [...(codes.get(id) ?? [])], utm_codes: [...(utm.get(id) ?? [])],
        date_start: (i.date_start as string | undefined) ?? null, date_stop: (i.date_stop as string | undefined) ?? null, synced_at: now,
      }
    })
    if (rows.length) {
      const { error } = await admin.from('ads_meta_campaigns').upsert(rows, { onConflict: 'tenant_id,meta_campaign_id' })
      if (error) throw new Error(error.message)
    }
    // Gasto por mês (últimos 36 meses: o Meta guarda cerca de 37) para o investimento mensal do Marketing
    try {
      const until = new Date(), since = new Date(Date.UTC(until.getUTCFullYear(), until.getUTCMonth() - 35, 1))
      const iso = (d: Date) => d.toISOString().slice(0, 10)
      const monthly = await graphAll(cfg, `${act}/insights`, token, { level: 'campaign', fields: 'campaign_id,spend,reach,impressions,inline_link_clicks,date_start', time_increment: 'monthly', time_range: JSON.stringify({ since: iso(since), until: iso(until) }), limit: '500' }, 20)
      const mrows = monthly.filter(m => m.campaign_id && typeof m.date_start === 'string').map(m => {
        const d = String(m.date_start)
        return { tenant_id: tenantId, ad_account_id: adAccountNumber(act), meta_campaign_id: String(m.campaign_id), year: Number(d.slice(0, 4)), month: Number(d.slice(5, 7)),
          spend: num(m.spend), reach: Math.round(num(m.reach)), impressions: Math.round(num(m.impressions)), clicks: Math.round(num(m.inline_link_clicks)), synced_at: now }
      })
      if (mrows.length) {
        const { error } = await admin.from('ads_meta_campaign_months').upsert(mrows, { onConflict: 'tenant_id,meta_campaign_id,year,month' })
        if (error) throw new Error(error.message)
      }
    } catch (e) { console.warn('[meta-ads] gasto por mês:', e instanceof Error ? e.message : e) }
    await admin.from('ads_meta_connections').update({ last_sync_at: now, last_error: null }).eq('tenant_id', tenantId)
    return { ok: true, campaigns: rows.length }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await admin.from('ads_meta_connections').update({ last_error: msg.slice(0, 300) }).eq('tenant_id', tenantId)
    return { ok: false, error: msg }
  }
}
