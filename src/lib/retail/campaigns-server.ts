// Campanha do pedido: o link da campanha (?c=codigo) vence; senão, a última campanha cuja
// mensagem a cliente recebeu nos últimos 7 dias (pedido feito conversando com a atendente).
import { ATTRIBUTION_DAYS, isCampaignCode } from '@/lib/retail/campaigns'

// Cliente do banco já filtrado pela empresa (createScopedAdmin ou scopeAdminClient)
type Db = { from: (t: string) => any } // eslint-disable-line @typescript-eslint/no-explicit-any

export async function resolveOrderCampaign(db: Db, opts: { code?: unknown; customerId?: string | null }): Promise<string | null> {
  if (isCampaignCode(opts.code)) {
    const { data } = await db.from('retail_campaigns').select('id').eq('code', opts.code).eq('status', 'ativa').maybeSingle()
    if (data?.id) return data.id as string
  }
  if (opts.customerId) {
    const since = new Date(Date.now() - ATTRIBUTION_DAYS * 86_400_000).toISOString()
    const { data } = await db.from('retail_campaign_sends').select('campaign_id').eq('customer_id', opts.customerId).eq('status', 'enviada')
      .gte('sent_at', since).order('sent_at', { ascending: false }).limit(1)
    if (data?.[0]?.campaign_id) return data[0].campaign_id as string
  }
  return null
}
