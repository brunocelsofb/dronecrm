import Link from 'next/link'
import { redirect } from 'next/navigation'
import { hasFeature } from '@/lib/auth/access'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { getSupportSession } from '@/lib/tenant/support'
import { loadMeta, loadMetaLeadForms } from '@/lib/ads/meta-data'
import { metaConfig } from '@/lib/ads/meta-server'
import { tokenState } from '@/lib/ads/meta'
import { MetaAdsView } from '@/components/ads/meta-ads-view'
import { MetaLeadForms } from '@/components/ads/meta-lead-forms'

export const dynamic = 'force-dynamic'

// Marketing → Anúncios do Meta: a mesma conexão da empresa; aqui liga às campanhas do Marketing
// (o gasto de cada mês entra sozinho no investimento mensal da campanha)
export default async function MarketingAdsPage({ searchParams }: { searchParams: Promise<{ meta?: string; meta_erro?: string }> }) {
  if (!(await hasFeature('marketing'))) redirect('/')
  const sp = await searchParams
  const support = await getSupportSession()
  const db = await createScopedAdmin()
  const [{ conn, stats }, { data: camps }, leadForms] = await Promise.all([
    loadMeta(db),
    db.from('marketing_campaigns').select('id, name, utm_campaign, meta_campaign_ids, status').order('created_at', { ascending: false }).limit(500),
    loadMetaLeadForms(db),
  ])
  const list = ((camps ?? []) as { id: string; name: string; utm_campaign: string | null; meta_campaign_ids: string[] | null; status: string }[])
  const rows = stats.map(s => {
    const auto = list.find(d => d.utm_campaign && s.utm_codes.includes(d.utm_campaign.toLowerCase())) ?? null
    const manual = list.find(d => (d.meta_campaign_ids ?? []).includes(s.meta_campaign_id)) ?? null
    return { ...s, auto: auto ? { id: auto.id, name: auto.name } : null, manual: manual?.id ?? null }
  })
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Link href="/marketing?aba=campanhas" className="text-sm text-brand-700 hover:underline">← Marketing</Link>
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Anúncios do Meta</h1>
        <p className="text-sm text-gray-600">Conecte o Facebook/Instagram da empresa: os leads dos formulários de cadastro dos anúncios entram direto em Leads inbound, e o Drone lê todo dia o gasto, o alcance e os cliques de cada campanha. O gasto de cada mês entra sozinho no investimento da campanha do Marketing ligada (custo por lead, CAC e ROAS).</p>
      </div>
      <MetaAdsView
        mod="marketing" enabled={!!metaConfig()} readOnly={!!support} notice={sp.meta === 'ok' ? 'Conectado.' : null} error={sp.meta_erro ? String(sp.meta_erro).slice(0, 300) : null}
        conn={conn ? { ...conn, token: tokenState(conn.expiresAt, new Date()) } : null}
        rows={rows} campaigns={list.map(d => ({ id: d.id, name: d.status === 'encerrada' ? `${d.name} (encerrada)` : d.name }))}
      />
      {conn && <MetaLeadForms {...leadForms} campaigns={list.map(d => ({ id: d.id, name: d.status === 'encerrada' ? `${d.name} (encerrada)` : d.name }))} readOnly={!!support} />}
    </div>
  )
}
