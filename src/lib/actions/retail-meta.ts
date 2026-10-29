'use server'

// ─── Varejo: link da bio e anúncios do Meta ──────────────────────────────────
import { revalidatePath } from 'next/cache'
import { hasFeature } from '@/lib/auth/access'
import { requireTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { getSupportSession } from '@/lib/tenant/support'
import { syncMetaAds } from '@/lib/retail/meta-ads-server'
import { BIO_CODE, adAccountNumber } from '@/lib/retail/meta-ads'

type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function guard(): Promise<{ tenantId: string; userId: string } | { error: string }> {
  const access = await hasFeature('varejo')
  if (!access) return { error: 'Sem acesso ao módulo Varejo.' }
  if (await getSupportSession()) return { error: 'Acesso de suporte é só leitura.' }
  return { tenantId: await requireTenantId(), userId: access.userId }
}
const refresh = () => { revalidatePath('/varejo/anuncios'); revalidatePath('/varejo/campanhas') }

// Cria (uma vez) o link fixo da bio do Instagram
export async function ensureBioCampaign(): Promise<Result<{ id: string }>> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  const db = await createScopedAdmin(g.tenantId)
  const { data: cur } = await db.from('retail_campaigns').select('id').eq('kind', 'bio').maybeSingle()
  if (cur) return { ok: true, id: cur.id as string }
  // O código "bio" pode já existir numa campanha comum: usa bio-2, bio-3…
  const { data: taken } = await db.from('retail_campaigns').select('code').like('code', `${BIO_CODE}%`)
  const used = new Set((taken ?? []).map(t => t.code as string))
  let code = BIO_CODE, n = 1
  while (used.has(code)) { n += 1; code = `${BIO_CODE}-${n}` }
  const { data, error } = await db.from('retail_campaigns').insert({ name: 'Instagram (link da bio)', code, kind: 'bio', audience: 'nenhum', audience_params: {}, message: '', investment: 0, status: 'ativa', created_by: g.userId }).select('id').single()
  if (error || !data) return { ok: false, error: error?.message ?? 'Falha ao criar o link.' }
  refresh()
  return { ok: true, id: data.id as string }
}

export async function chooseMetaAdAccount(accountId: string): Promise<Result> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  const db = await createScopedAdmin(g.tenantId)
  const { data: conn } = await db.from('retail_meta_connections').select('accounts').maybeSingle()
  if (!conn) return { ok: false, error: 'Meta não conectado.' }
  const acc = ((conn.accounts ?? []) as { id: string; name: string; currency: string }[]).find(a => a.id === adAccountNumber(accountId))
  if (!acc) return { ok: false, error: 'Conta de anúncios não encontrada.' }
  const { error } = await db.from('retail_meta_connections').update({ ad_account_id: acc.id, ad_account_name: acc.name, currency: acc.currency }).eq('tenant_id', g.tenantId)
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

// Desconectar: apaga o acesso e os números lidos do Meta (as campanhas do Drone ficam)
export async function disconnectMeta(): Promise<Result> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  const db = await createScopedAdmin(g.tenantId)
  const [a, b] = await Promise.all([
    db.from('retail_meta_campaigns').delete().eq('tenant_id', g.tenantId),
    db.from('retail_meta_connections').delete().eq('tenant_id', g.tenantId),
  ])
  if (a.error || b.error) return { ok: false, error: (a.error ?? b.error)!.message }
  refresh()
  return { ok: true }
}

// Liga (ou desliga) uma campanha do Meta a uma campanha do Drone
export async function linkMetaCampaign(metaCampaignId: string, campaignId: string | null): Promise<Result> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  if (!/^\d{1,30}$/.test(metaCampaignId) || (campaignId && !UUID.test(campaignId))) return { ok: false, error: 'Inválido.' }
  const db = await createScopedAdmin(g.tenantId)
  const { data: camps } = await db.from('retail_campaigns').select('id, meta_campaign_ids').contains('meta_campaign_ids', [metaCampaignId])
  for (const c of (camps ?? []) as { id: string; meta_campaign_ids: string[] }[]) {
    if (c.id === campaignId) continue
    await db.from('retail_campaigns').update({ meta_campaign_ids: c.meta_campaign_ids.filter(x => x !== metaCampaignId) }).eq('id', c.id)
  }
  if (campaignId) {
    const { data: c } = await db.from('retail_campaigns').select('meta_campaign_ids').eq('id', campaignId).maybeSingle()
    if (!c) return { ok: false, error: 'Campanha não encontrada.' }
    const ids = new Set((c.meta_campaign_ids ?? []) as string[]); ids.add(metaCampaignId)
    const { error } = await db.from('retail_campaigns').update({ meta_campaign_ids: [...ids] }).eq('id', campaignId)
    if (error) return { ok: false, error: error.message }
  }
  refresh(); if (campaignId) revalidatePath(`/varejo/campanhas/${campaignId}`)
  return { ok: true }
}
