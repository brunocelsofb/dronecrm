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
import { META_GRAPH_DEFAULT, adAccountNumber, codesInText, utmCodesInText, num, metaLeadFields, type LeadgenChange, type MetaFieldData } from '@/lib/ads/meta'
import { ingestLead } from '@/lib/leads/ingest'
import { runAsTenant } from '@/lib/tenant/context'

export type MetaConfig = { appId: string; secret: string; configId: string | null; version: string; verifyToken: string | null }
export function metaConfig(): MetaConfig | null {
  const appId = process.env.META_APP_ID?.trim()
  const secret = process.env.META_APP_SECRET?.trim()
  if (!appId || !secret) return null
  const v = process.env.META_GRAPH_VERSION?.trim()
  return { appId, secret, configId: process.env.META_CONFIG_ID?.trim() || null, version: v && /^v\d+\.\d+$/.test(v) ? v : META_GRAPH_DEFAULT, verifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN?.trim() || null }
}

type Json = Record<string, unknown>
class MetaError extends Error {}

async function graphGet(cfg: MetaConfig, path: string, token: string, params: Record<string, string> = {}): Promise<Json> {
  const q = new URLSearchParams({ ...params, access_token: token, appsecret_proof: createHmac('sha256', cfg.secret).update(token).digest('hex') })
  return fetchJson(`https://graph.facebook.com/${cfg.version}/${path.replace(/^\/+/, '')}?${q.toString()}`)
}
async function graphSend(cfg: MetaConfig, method: 'POST' | 'DELETE', path: string, token: string, params: Record<string, string> = {}): Promise<Json> {
  const q = new URLSearchParams({ ...params, access_token: token, appsecret_proof: createHmac('sha256', cfg.secret).update(token).digest('hex') })
  return fetchJson(`https://graph.facebook.com/${cfg.version}/${path.replace(/^\/+/, '')}?${q.toString()}`, method)
}
async function fetchJson(url: string, method: 'GET' | 'POST' | 'DELETE' = 'GET'): Promise<Json> {
  const res = await fetch(url, { method, cache: 'no-store', signal: AbortSignal.timeout(20_000) })
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
  const me = await graphGet(cfg, 'me', token, { fields: 'id,name' })
  // Contas de anúncio (gasto) e páginas (leads): cada parte pode não ter sido autorizada
  let accounts: { id: string; name: string; currency: string; active: boolean }[] = []
  try {
    accounts = (await graphAll(cfg, 'me/adaccounts', token, { fields: 'account_id,name,currency,account_status', limit: '100' }, 3))
      .map(a => ({ id: adAccountNumber(String(a.account_id ?? a.id ?? '')), name: String(a.name ?? ''), currency: String(a.currency ?? ''), active: num(a.account_status) === 1 }))
      .filter(a => a.id)
  } catch (e) { console.warn('[meta] contas de anúncio:', e instanceof Error ? e.message : e) }
  let pages: { id: string; name: string; token: string }[] = []
  try {
    pages = (await graphAll(cfg, 'me/accounts', token, { fields: 'id,name,access_token', limit: '100' }, 3))
      .map(p => ({ id: String(p.id ?? ''), name: String(p.name ?? ''), token: String(p.access_token ?? '') }))
      .filter(p => p.id && p.token)
  } catch (e) { console.warn('[meta] páginas:', e instanceof Error ? e.message : e) }
  return { token, expiresAt: expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : null, userId: String(me.id ?? ''), userName: String(me.name ?? ''), accounts, pages }
}

export async function saveMetaConnection(tenantId: string, userId: string, r: Awaited<ReturnType<typeof finishMetaLogin>>) {
  const one = r.accounts.length === 1 ? r.accounts[0] : null
  const { error } = await createAdminClient().from('ads_meta_connections').upsert({
    tenant_id: tenantId, token_enc: encryptSecret(r.token), token_expires_at: r.expiresAt, meta_user_name: r.userName, meta_user_id: r.userId || null,
    accounts: r.accounts, ad_account_id: one?.id ?? null, ad_account_name: one?.name ?? null, currency: one?.currency ?? null,
    connected_by: userId, connected_at: new Date().toISOString(), last_error: null,
  }, { onConflict: 'tenant_id' })
  if (error) throw new Error(error.message)
  await saveMetaPages(tenantId, r.pages)
}

// ─── Leads dos formulários (Lead Ads) ────────────────────────────────────────
// Guarda as páginas (acesso da página criptografado), assina o aviso "leadgen" de cada uma
// para o app da plataforma e lê os formulários. Formulário novo já entra ligado (leads chegam
// sem configurar nada); a empresa pode desligar ou escolher a campanha do Marketing.
export async function saveMetaPages(tenantId: string, pages: { id: string; name: string; token: string }[]) {
  const cfg = metaConfig()
  if (!cfg) return
  const admin = createAdminClient()
  for (const p of pages) {
    let subscribed = false, lastError: string | null = null
    try {
      await graphSend(cfg, 'POST', `${p.id}/subscribed_apps`, p.token, { subscribed_fields: 'leadgen' })
      subscribed = true
    } catch (e) { lastError = (e instanceof Error ? e.message : String(e)).slice(0, 300) }
    await admin.from('ads_meta_pages').upsert({
      tenant_id: tenantId, page_id: p.id, name: p.name.slice(0, 200), token_enc: encryptSecret(p.token), subscribed,
      subscribed_at: subscribed ? new Date().toISOString() : null, last_error: lastError, updated_at: new Date().toISOString(),
    }, { onConflict: 'tenant_id,page_id' })
  }
  await refreshMetaForms(tenantId)
}

export async function refreshMetaForms(tenantId: string): Promise<{ ok: true; forms: number } | { ok: false; error: string }> {
  const cfg = metaConfig()
  if (!cfg) return { ok: false, error: 'Conexão com o Meta ainda não liberada na plataforma.' }
  const admin = createAdminClient()
  const { data: pages } = await admin.from('ads_meta_pages').select('page_id, token_enc').eq('tenant_id', tenantId)
  let total = 0
  const errors: string[] = []
  for (const p of (pages ?? []) as { page_id: string; token_enc: string }[]) {
    try {
      const forms = await graphAll(cfg, `${p.page_id}/leadgen_forms`, decryptSecret(p.token_enc), { fields: 'id,name,status', limit: '100' }, 5)
      const { data: known } = await admin.from('ads_meta_lead_forms').select('form_id').eq('tenant_id', tenantId).eq('page_id', p.page_id)
      const have = new Set(((known ?? []) as { form_id: string }[]).map(k => k.form_id))
      const now = new Date().toISOString()
      for (const f of forms) {
        const id = String(f.id ?? '')
        if (!id) continue
        total++
        const base = { name: String(f.name ?? '').slice(0, 200), status: String(f.status ?? '') || null, updated_at: now }
        if (have.has(id)) await admin.from('ads_meta_lead_forms').update(base).eq('tenant_id', tenantId).eq('form_id', id)
        else await admin.from('ads_meta_lead_forms').insert({ tenant_id: tenantId, page_id: p.page_id, form_id: id, active: true, ...base })
      }
    } catch (e) { errors.push((e instanceof Error ? e.message : String(e)).slice(0, 200)) }
  }
  return errors.length && !total ? { ok: false, error: errors[0] } : { ok: true, forms: total }
}

// Desliga o aviso de leads das páginas (ao desconectar). Melhor esforço: falha não impede desconectar.
export async function unsubscribeMetaPages(tenantId: string) {
  const cfg = metaConfig()
  if (!cfg) return
  const { data: pages } = await createAdminClient().from('ads_meta_pages').select('page_id, token_enc').eq('tenant_id', tenantId)
  for (const p of (pages ?? []) as { page_id: string; token_enc: string }[]) {
    try { await graphSend(cfg, 'DELETE', `${p.page_id}/subscribed_apps`, decryptSecret(p.token_enc)) } catch { /* segue */ }
  }
}

// Um lead novo avisado pelo Meta: para cada empresa que conectou aquela página, busca as respostas
// com o acesso da página e cria o lead no CRM (uma vez só por leadgen_id).
export async function processLeadgen(change: LeadgenChange): Promise<{ tenantId: string; status: string; error?: string }[]> {
  const cfg = metaConfig()
  if (!cfg) return []
  const admin = createAdminClient()
  const { data: pages } = await admin.from('ads_meta_pages').select('tenant_id, token_enc').eq('page_id', change.page_id)
  const out: { tenantId: string; status: string; error?: string }[] = []
  for (const pg of (pages ?? []) as { tenant_id: string; token_enc: string }[]) {
    const tenantId = pg.tenant_id
    const r = await runAsTenant(tenantId, async () => {
      // Trava de duplicidade: o Meta pode reenviar o mesmo aviso
      const { data: ev, error: evErr } = await admin.from('ads_meta_lead_events')
        .insert({ tenant_id: tenantId, leadgen_id: change.leadgen_id, page_id: change.page_id, form_id: change.form_id, status: 'recebido' }).select('id').single()
      if (evErr || !ev) return { tenantId, status: 'repetido' }
      const done = async (status: string, extra: Record<string, unknown> = {}) => { await admin.from('ads_meta_lead_events').update({ status, ...extra }).eq('id', ev.id); return { tenantId, status, error: extra.error as string | undefined } }
      try {
        const token = decryptSecret(pg.token_enc)
        const lead = await graphGet(cfg, change.leadgen_id, token, { fields: 'created_time,field_data,ad_id,ad_name,campaign_id,campaign_name,form_id,is_organic' })
        const formId = String(lead.form_id ?? change.form_id ?? '')
        let { data: form } = await admin.from('ads_meta_lead_forms').select('id, name, active, campaign_id, leads_count').eq('tenant_id', tenantId).eq('form_id', formId).maybeSingle()
        if (!form && formId) {
          // Formulário criado depois da conexão: registra já ligado
          let name = ''
          try { name = String((await graphGet(cfg, formId, token, { fields: 'name' })).name ?? '') } catch { /* sem nome */ }
          const ins = await admin.from('ads_meta_lead_forms').insert({ tenant_id: tenantId, page_id: change.page_id, form_id: formId, name, active: true }).select('id, name, active, campaign_id, leads_count').single()
          form = ins.data
        }
        if (form && !form.active) return done('ignorado')
        // Campanha do Marketing: a ligada à campanha do anúncio no Meta; senão a escolhida no formulário
        let campaignId: string | null = null
        const metaCampaign = lead.campaign_id ? String(lead.campaign_id) : null
        if (metaCampaign) {
          const { data: mk } = await admin.from('marketing_campaigns').select('id').eq('tenant_id', tenantId).contains('meta_campaign_ids', [metaCampaign]).limit(1).maybeSingle()
          campaignId = (mk?.id as string | undefined) ?? null
          if (!campaignId) {
            const { data: st } = await admin.from('ads_meta_campaigns').select('utm_codes').eq('tenant_id', tenantId).eq('meta_campaign_id', metaCampaign).maybeSingle()
            const codes = ((st?.utm_codes ?? []) as string[])
            if (codes.length) {
              const { data: byCode } = await admin.from('marketing_campaigns').select('id').eq('tenant_id', tenantId).in('utm_campaign', codes).limit(1).maybeSingle()
              campaignId = (byCode?.id as string | undefined) ?? null
            }
          }
        }
        if (!campaignId) campaignId = (form?.campaign_id as string | null) ?? null
        const f = metaLeadFields((lead.field_data ?? []) as MetaFieldData)
        const res = await ingestLead({
          tenantId, name: f.name, email: f.email, phone: f.phone, company_name: f.company_name, cnpj: f.cnpj, message: f.message,
          source: 'anuncio', tracking: { utm_source: 'meta', utm_medium: 'lead_ads', ...(lead.ad_name ? { utm_content: String(lead.ad_name).slice(0, 200) } : {}) },
          campaignId, conversion: `formulário ${form?.name || formId} (Meta)`, dedupe: true,
        })
        if (res.error) return done('erro', { error: res.error.slice(0, 300) })
        if (form) await admin.from('ads_meta_lead_forms').update({ leads_count: Number(form.leads_count ?? 0) + 1, last_lead_at: new Date().toISOString() }).eq('id', form.id)
        return done(res.duplicate ? 'duplicado' : 'criado', { lead_id: res.leadId ?? null })
      } catch (e) {
        return done('erro', { error: (e instanceof Error ? e.message : String(e)).slice(0, 300) })
      }
    })
    out.push(r)
  }
  return out
}

// Pedido de exclusão vindo do Meta (a pessoa removeu o app no Facebook): apaga as conexões feitas
// por ela e tudo o que o Drone leu do Meta nessas empresas. Leads já criados no CRM são da empresa
// cliente (controladora) e seguem as regras dela.
export async function deleteMetaDataForUser(metaUserId: string): Promise<number> {
  const admin = createAdminClient()
  const { data: conns } = await admin.from('ads_meta_connections').select('tenant_id').eq('meta_user_id', metaUserId)
  const tenants = ((conns ?? []) as { tenant_id: string }[]).map(c => c.tenant_id)
  for (const t of tenants) {
    for (const table of ['ads_meta_campaign_months', 'ads_meta_campaigns', 'ads_meta_lead_forms', 'ads_meta_pages', 'ads_meta_connections']) {
      await admin.from(table).delete().eq('tenant_id', t)
    }
  }
  return tenants.length
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
