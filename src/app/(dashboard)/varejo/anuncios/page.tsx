import Link from 'next/link'
import { redirect } from 'next/navigation'
import { hasFeature } from '@/lib/auth/access'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { getSupportSession } from '@/lib/tenant/support'
import { loadMeta } from '@/lib/ads/meta-data'
import { metaConfig } from '@/lib/ads/meta-server'
import { tokenState } from '@/lib/ads/meta'
import { MetaAdsView } from '@/components/ads/meta-ads-view'

export const dynamic = 'force-dynamic'

// Anúncios do Meta (Instagram/Facebook): conectar a conta, ver gasto/alcance/cliques e ligar às campanhas
export default async function RetailAdsPage({ searchParams }: { searchParams: Promise<{ meta?: string; meta_erro?: string }> }) {
  if (!(await hasFeature('varejo'))) redirect('/')
  const sp = await searchParams
  const support = await getSupportSession()
  const db = await createScopedAdmin()
  const [{ conn, stats }, { data: camps }] = await Promise.all([
    loadMeta(db),
    db.from('retail_campaigns').select('id, name, code, meta_campaign_ids, status').order('created_at', { ascending: false }).limit(300),
  ])
  const drone = ((camps ?? []) as { id: string; name: string; code: string; meta_campaign_ids: string[] | null; status: string }[])
  const rows = stats.map(s => {
    const auto = drone.find(d => s.codes.includes(d.code)) ?? null
    const manual = drone.find(d => (d.meta_campaign_ids ?? []).includes(s.meta_campaign_id)) ?? null
    return { ...s, auto: auto ? { id: auto.id, name: auto.name } : null, manual: manual?.id ?? null }
  })
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Link href="/varejo/configurar" className="text-sm text-brand-700 hover:underline">← Configurar loja</Link>
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Anúncios do Meta</h1>
        <p className="text-sm text-gray-600">Conecte a conta de anúncios do Instagram/Facebook: o Drone lê todo dia quanto foi gasto, o alcance e os cliques de cada campanha e soma no resultado das suas campanhas.</p>
      </div>
      <MetaAdsView
        mod="varejo" enabled={!!metaConfig()} readOnly={!!support} notice={sp.meta === 'ok' ? 'Conectado.' : null} error={sp.meta_erro ? String(sp.meta_erro).slice(0, 300) : null}
        conn={conn ? { ...conn, token: tokenState(conn.expiresAt, new Date()) } : null}
        rows={rows} campaigns={drone.map(d => ({ id: d.id, name: d.status === 'ativa' ? d.name : `${d.name} (encerrada)` }))}
      />
    </div>
  )
}
