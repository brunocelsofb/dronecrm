// Página do pedido para a cliente (pública, link com token): etapas com data e hora,
// rastreio, a conta linha por linha e o WhatsApp da loja. Mostra só o que a cliente pode ver.
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { scopeAdminClient } from '@/lib/tenant/scoped-admin'
import { getPublicBranding } from '@/lib/utils/public-branding'
import { OrderTrackingView, type TrackingOrder } from '@/components/retail/order-tracking-view'
import { readContent, readTheme } from '@/lib/retail/storefront'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Seu pedido', robots: { index: false, follow: false } }

type O = TrackingOrder & { id: string; tenant_id: string }

export default async function RetailOrderTrackingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) notFound()
  const admin = createAdminClient()
  const { data } = await admin.from('retail_orders')
    .select('id, tenant_id, number, status, created_at, subtotal, discount, loyalty_discount, shipping, total, payment_method, payment_condition, proposal_token, tracking_carrier, tracking_code, tracking_url, retail_customers(name), retail_order_items(name, color, size, qty, unit_price, total)')
    .eq('public_token', token).maybeSingle()
  if (!data) notFound()
  const o = data as unknown as O
  const db = scopeAdminClient(admin, o.tenant_id, null)
  const [branding, { data: sf }, { data: org }, { data: evs }] = await Promise.all([
    getPublicBranding(o.tenant_id),
    db.from('retail_storefronts').select('title, whatsapp, theme, content').maybeSingle(),
    db.from('organization_settings').select('company_name, name').eq('tenant_id', o.tenant_id).maybeSingle(),
    db.from('retail_order_events').select('kind, created_at').eq('order_id', o.id).eq('public', true).order('created_at'),
  ])
  const store = ((sf?.title as string | null) || branding.companyName || (org?.company_name as string | null) || (org?.name as string | null) || 'Loja').trim()
  const theme = readTheme(sf?.theme)
  const policies = readContent(sf?.content).policies.filter(p => p.text)
  const wa = sf?.whatsapp ? `https://wa.me/${String(sf.whatsapp).length <= 11 ? `55${sf.whatsapp}` : sf.whatsapp}?text=${encodeURIComponent(`Olá! Sobre o meu pedido nº ${o.number}.`)}` : null

  return <OrderTrackingView o={o} events={(evs ?? []).map(e => ({ kind: e.kind as string, created_at: e.created_at as string }))} store={store} logoUrl={branding.logoUrl} theme={theme} policies={policies} wa={wa} />
}
