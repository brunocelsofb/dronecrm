import Link from 'next/link'
import { redirect } from 'next/navigation'
import { hasFeature } from '@/lib/auth/access'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { getSupportSession } from '@/lib/tenant/support'
import { AUDIENCES, campaignResult, type Audience } from '@/lib/retail/campaigns'
import { loadCampaignOrders } from '@/lib/retail/campaigns-data'
import { fmtBRL, fmtNum1 } from '@/lib/format'
import { SectionTabs, CUSTOMER_TABS } from '@/components/retail/section-tabs'
import { CampaignNew } from '@/components/retail/campaign-new'

export const dynamic = 'force-dynamic'

// Campanhas da loja: lista com o resultado de cada uma e "Nova campanha"
export default async function RetailCampaignsPage() {
  if (!(await hasFeature('varejo'))) redirect('/')
  const support = await getSupportSession()
  const db = await createScopedAdmin()
  const [{ data: camps }, { data: sends }, { data: cats }] = await Promise.all([
    db.from('retail_campaigns').select('id, name, code, audience, investment, status, created_at').order('created_at', { ascending: false }).limit(200),
    db.from('retail_campaign_sends').select('campaign_id, status').limit(50000),
    db.from('retail_products').select('category').limit(10000),
  ])
  const list = (camps ?? []) as { id: string; name: string; code: string; audience: Audience; investment: number; status: string; created_at: string }[]
  const orders = await loadCampaignOrders(db, list.map(c => c.id))
  const sent = new Map<string, number>()
  for (const s of (sends ?? []) as { campaign_id: string; status: string }[]) if (s.status === 'enviada') sent.set(s.campaign_id, (sent.get(s.campaign_id) ?? 0) + 1)
  const categories = [...new Set(((cats ?? []) as { category: string | null }[]).map(c => c.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <SectionTabs tabs={CUSTOMER_TABS} active="/varejo/campanhas" />
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Campanhas</h1>
        <p className="text-sm text-gray-600">Escolha o público, o Drone prepara a mensagem de cada cliente e você revisa e envia. Cada campanha tem um link próprio da vitrine: o que for vendido por ele (ou para quem recebeu a mensagem nos 7 dias antes) entra no resultado.</p>
      </div>
      {!support && <CampaignNew categories={categories} />}
      {list.length === 0 ? <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">Nenhuma campanha ainda. Comece pelas aniversariantes do mês.</p> : (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
          {list.map(c => {
            const r = campaignResult(orders[c.id] ?? [], Number(c.investment))
            return (
              <li key={c.id}>
                <Link href={`/varejo/campanhas/${c.id}`} className="flex flex-wrap items-center gap-3 p-3 hover:bg-gray-50">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900">{c.name} {c.status === 'encerrada' && <span className="ml-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">encerrada</span>}</p>
                    <p className="text-xs text-gray-500">{AUDIENCES.find(a => a.id === c.audience)?.label} · {sent.get(c.id) ?? 0} mensagem(ns) enviada(s)</p>
                  </div>
                  <div className="text-right text-xs text-gray-700">
                    <p><strong className="text-sm text-gray-900">{fmtBRL(r.sold)}</strong> vendido · {r.paid} pedido(s) pago(s)</p>
                    <p className="text-gray-500">{r.roas !== null ? `retorno ${fmtNum1(r.roas)} vezes` : 'sem investimento lançado'}</p>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
