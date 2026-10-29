'use server'

// ─── Anúncios do Meta: conexão da empresa (Varejo e Marketing) ───────────────
import { revalidatePath } from 'next/cache'
import { hasFeature } from '@/lib/auth/access'
import { requireTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { getSupportSession } from '@/lib/tenant/support'
import { syncMetaAds } from '@/lib/ads/meta-server'
import { adAccountNumber, type AdsModule } from '@/lib/ads/meta'

type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function guard(): Promise<{ tenantId: string; userId: string } | { error: string }> {
  const access = (await hasFeature('varejo')) ?? (await hasFeature('marketing'))
  if (!access) return { error: 'Sem acesso aos anúncios.' }
  if (await getSupportSession()) return { error: 'Acesso de suporte é só leitura.' }
  return { tenantId: await requireTenantId(), userId: access.userId }
}
const refresh = () => { for (const p of ['/varejo/anuncios', '/varejo/campanhas', '/marketing/anuncios', '/marketing']) revalidatePath(p) }

export async function chooseMetaAdAccount(accountId: string): Promise<Result> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  const db = await createScopedAdmin(g.tenantId)
  const { data: conn } = await db.from('ads_meta_connections').select('accounts').maybeSingle()
  if (!conn) return { ok: false, error: 'Meta não conectado.' }
  const acc = ((conn.accounts ?? []) as { id: string; name: string; currency: string }[]).find(a => a.id === adAccountNumber(accountId))
  if (!acc) return { ok: false, error: 'Conta de anúncios não encontrada.' }
  const { error } = await db.from('ads_meta_connections').update({ ad_account_id: acc.id, ad_account_name: acc.name, currency: acc.currency }).eq('tenant_id', g.tenantId)
  if (error) return { ok: false, error: error.message }
  const r = await syncMetaAds(g.tenantId)
  refresh()
  return r.ok ? { ok: true } : { ok: false, error: `Conta escolhida, mas a leitura falhou: ${r.error}` }
}

export async function syncMetaNow(): Promise<Result<{ campaigns: number }>> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  const r = await syncMetaAds(g.tenantId)
  refresh()
  return r.ok ? { ok: true, campaigns: r.campaigns } : { ok: false, error: r.error }
}

// Desconectar: apaga o acesso e os números lidos do Meta (as campanhas do Drone ficam).
// Vale para a empresa toda (Varejo e Marketing usam a mesma conexão).
export async function disconnectMeta(): Promise<Result> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  const db = await createScopedAdmin(g.tenantId)
  const [a, b, c] = await Promise.all([
    db.from('ads_meta_campaigns').delete().eq('tenant_id', g.tenantId),
    db.from('ads_meta_campaign_months').delete().eq('tenant_id', g.tenantId),
    db.from('ads_meta_connections').delete().eq('tenant_id', g.tenantId),
  ])
  if (a.error || b.error || c.error) return { ok: false, error: (a.error ?? b.error ?? c.error)!.message }
  refresh()
  return { ok: true }
}

// Liga (ou desliga) uma campanha do Meta a uma campanha do Drone (loja ou Marketing)
export async function linkMetaCampaign(metaCampaignId: string, mod: AdsModule, campaignId: string | null): Promise<Result> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  if (!/^\d{1,30}$/.test(metaCampaignId) || (campaignId && !UUID.test(campaignId)) || (mod !== 'varejo' && mod !== 'marketing')) return { ok: false, error: 'Inválido.' }
  if (!(await hasFeature(mod))) return { ok: false, error: 'Sem acesso a este módulo.' }
  const table = mod === 'varejo' ? 'retail_campaigns' : 'marketing_campaigns'
  const db = await createScopedAdmin(g.tenantId)
  const { data: camps } = await db.from(table).select('id, meta_campaign_ids').contains('meta_campaign_ids', [metaCampaignId])
  for (const c of (camps ?? []) as { id: string; meta_campaign_ids: string[] }[]) {
    if (c.id === campaignId) continue
    await db.from(table).update({ meta_campaign_ids: c.meta_campaign_ids.filter(x => x !== metaCampaignId) }).eq('id', c.id)
  }
  if (campaignId) {
    const { data: c } = await db.from(table).select('meta_campaign_ids').eq('id', campaignId).maybeSingle()
    if (!c) return { ok: false, error: 'Campanha não encontrada.' }
    const ids = new Set((c.meta_campaign_ids ?? []) as string[]); ids.add(metaCampaignId)
    const { error } = await db.from(table).update({ meta_campaign_ids: [...ids] }).eq('id', campaignId)
    if (error) return { ok: false, error: error.message }
  }
  refresh(); if (campaignId && mod === 'varejo') revalidatePath(`/varejo/campanhas/${campaignId}`)
  return { ok: true }
}
