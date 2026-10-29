import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { hasFeature } from '@/lib/auth/access'
import { requireTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { getSupportSession } from '@/lib/tenant/support'
import { campaignLink, campaignResult, readParams, selectAudience, type Audience } from '@/lib/retail/campaigns'
import { loadCampaignCustomers, loadCampaignOrders, storefrontLinkBase } from '@/lib/retail/campaigns-data'
import { SectionTabs, CUSTOMER_TABS } from '@/components/retail/section-tabs'
import { CampaignDetail } from '@/components/retail/campaign-detail'
import { loadMeta } from '@/lib/ads/meta-data'
import { linkedMeta, sumMeta } from '@/lib/ads/meta'
import { metaConfig } from '@/lib/ads/meta-server'

export const dynamic = 'force-dynamic'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function RetailCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await hasFeature('varejo'))) redirect('/')
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const tenantId = await requireTenantId()
  const db = await createScopedAdmin(tenantId)
  const support = await getSupportSession()
  const [{ data: c }, { data: sends }, { data: org }, link, customers] = await Promise.all([
    db.from('retail_campaigns').select('id, name, code, kind, meta_campaign_ids, audience, audience_params, message, investment, status, created_at').eq('id', id).maybeSingle(),
    db.from('retail_campaign_sends').select('customer_id, status, channel, sent_at').eq('campaign_id', id).limit(20000),
    db.from('organization_settings').select('company_name, name, evo_instance_name, evo_instance_aliases').eq('tenant_id', tenantId).maybeSingle(),
    storefrontLinkBase(db),
    loadCampaignCustomers(db),
  ])
  if (!c) notFound()
  const audience = c.audience as Audience
  const people = selectAudience(customers, audience, readParams(c.audience_params), new Date())
  const sendMap = Object.fromEntries(((sends ?? []) as { customer_id: string; status: string; channel: string | null; sent_at: string }[]).map(s => [s.customer_id, { status: s.status, channel: s.channel, sent_at: s.sent_at }]))
  // Quem já recebeu e saiu do público (ex.: fez aniversário) continua na lista
  const extra = customers.filter(x => sendMap[x.id] && !people.some(p => p.id === x.id))
  const orders = (await loadCampaignOrders(db, [id]))[id] ?? []
  const meta = await loadMeta(db)
  const mine = linkedMeta(meta.stats, { code: c.code as string, meta_campaign_ids: (c.meta_campaign_ids ?? []) as string[] })
  const metaSum = sumMeta(mine)
  const result = campaignResult(orders, Number(c.investment) + metaSum.spend)
  type Alias = string | { label?: string; private?: boolean }
  const aliases = (org?.evo_instance_aliases ?? {}) as Record<string, Alias>
  const instances = Object.entries(aliases).filter(([, v]) => !(typeof v === 'object' && v?.private)).map(([name, v]) => ({ name, label: typeof v === 'string' ? v : v?.label ?? name }))
  if (org?.evo_instance_name && !instances.some(i => i.name === org.evo_instance_name)) instances.unshift({ name: org.evo_instance_name as string, label: org.evo_instance_name as string })
  const url = link.domain ? `https://${link.domain}/?c=${encodeURIComponent(c.code as string)}` : campaignLink(link.base, link.slug, c.code as string)
  const store = (link.store || (org?.company_name as string | null) || (org?.name as string | null) || 'a loja').trim()
  const optinMissing = customers.filter(x => !x.optin).length
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <SectionTabs tabs={CUSTOMER_TABS} active="/varejo/campanhas" />
      <Link href="/varejo/campanhas" className="text-sm text-brand-700 hover:underline">← Campanhas</Link>
      <CampaignDetail
        campaign={{ id: c.id as string, name: c.name as string, code: c.code as string, audience, params: readParams(c.audience_params), message: (c.message as string | null) ?? '', investment: Number(c.investment), status: c.status as string, kind: (c.kind as string) ?? 'campanha' }}
        meta={{ enabled: !!metaConfig(), connected: !!meta.conn?.adAccountId, names: mine.map(m => m.name), spend: metaSum.spend, reach: metaSum.reach, clicks: metaSum.clicks }}
        people={[...people, ...extra].map(p => ({ id: p.id, name: p.name, phone: p.phone, birth_date: p.birth_date, last_purchase: p.last_purchase }))}
        sends={sendMap} result={result} link={url} store={store} instances={instances} readOnly={!!support} optinMissing={optinMissing}
      />
    </div>
  )
}
