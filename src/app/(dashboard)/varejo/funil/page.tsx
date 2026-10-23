import Link from 'next/link'
import { redirect } from 'next/navigation'
import { hasFeature } from '@/lib/auth/access'
import { requireTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { getSupportSession } from '@/lib/tenant/support'
import { appBaseUrl } from '@/lib/whatsapp/webhook-token'
import { whatsappLink } from '@/lib/retail/customers'
import { isProposal } from '@/lib/retail/proposal'
import { columnOf, followUp, nudgeMessage, readFunnel, readFunnelLayout, stageOf, type FunnelOrder } from '@/lib/retail/funnel'
import { FunnelBoard, type FunnelCard } from '@/components/retail/funnel-board'

export const dynamic = 'force-dynamic'

type Row = FunnelOrder & {
  id: string; number: number; total: number; payment_link: string | null; proposal_token: string | null; proposal: unknown
  nudge_count: number; lost_reason: string | null
  retail_customers: { name: string; phone: string | null } | null
  retail_order_items: { name: string }[]
}

const COLS = 'id, number, status, total, created_at, stage_at, proposal_sent_at, proposal_accepted_at, last_nudge_at, nudge_count, lost_reason, custom_stage, custom_stage_at, payment_link, proposal_token, proposal, retail_customers(name, phone), retail_order_items(name)'

export default async function RetailFunnelPage() {
  const access = await hasFeature('varejo')
  if (!access) redirect('/')
  const tenantId = await requireTenantId()
  const db = await createScopedAdmin(tenantId)
  const now = new Date()
  const days = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString()

  const [{ data: org }, open, paid, delivered, lost, support] = await Promise.all([
    db.from('organization_settings').select('company_name, name, retail_settings').eq('tenant_id', tenantId).maybeSingle(),
    db.from('retail_orders').select(COLS).in('status', ['carrinho', 'enviado_atendimento', 'aguardando_pagamento']).order('stage_at', { ascending: true }).limit(500),
    db.from('retail_orders').select(COLS).eq('status', 'pago').order('stage_at', { ascending: true }).limit(200),
    db.from('retail_orders').select(COLS).in('status', ['enviado', 'entregue']).gte('stage_at', days(30)).order('stage_at', { ascending: false }).limit(200),
    db.from('retail_orders').select(COLS).eq('status', 'cancelado').gte('stage_at', days(90)).order('stage_at', { ascending: false }).limit(500),
    getSupportSession(),
  ])
  const funnelRaw = (org?.retail_settings as Record<string, unknown> | null)?.funnel
  const settings = readFunnel(funnelRaw)
  const layout = readFunnelLayout(funnelRaw)
  const store = ((org?.company_name as string | null) || (org?.name as string | null) || 'loja').trim()
  const base = appBaseUrl()

  const rows = [open, paid, delivered, lost].flatMap(r => (r.data ?? []) as unknown as Row[])
  const lostSince30 = days(30)
  const cards: FunnelCard[] = rows.map(o => {
    const f = followUp(o, settings, now, layout)
    const prop = isProposal(o.proposal) ? o.proposal : null
    const text = nudgeMessage(f.stage, {
      store, customer: o.retail_customers?.name ?? null, number: o.number, items: o.retail_order_items.map(i => i.name),
      proposalUrl: o.proposal_token ? `${base}/loja/proposta/${o.proposal_token}` : null,
      validUntil: prop?.valid_until ?? null, paymentLink: o.payment_link,
    })
    return {
      id: o.id, number: o.number, status: o.status, stage: stageOf(o), total: Number(o.total),
      customer: o.retail_customers?.name ?? null, items: o.retail_order_items.map(i => i.name),
      column: columnOf(o, layout), hoursInStage: f.hoursInColumn, overdue: f.overdue, suggestLost: f.suggestLost,
      nudgeCount: Number(o.nudge_count ?? 0), lastNudgeHours: o.last_nudge_at ? (now.getTime() - Date.parse(o.last_nudge_at)) / 3_600_000 : null,
      whatsappUrl: text ? whatsappLink(o.retail_customers?.phone, text) : null,
      lostReason: o.lost_reason,
      // Perdido: a coluna mostra 30 dias; o resumo de motivos usa 90
      hidden: f.stage === 'perdido' && (o.stage_at ?? o.created_at) < lostSince30,
    }
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Funil da loja</h1>
          <p className="mt-1 text-sm text-gray-500">Cada pedido anda do carrinho até a entrega. Laranja = parado há mais tempo que o combinado: mande o lembrete.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/varejo/pedidos" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Lista de pedidos</Link>
          <Link href="/varejo/pedidos/novo" className="rounded-lg bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800">Novo pedido</Link>
        </div>
      </div>
      <FunnelBoard cards={cards} settings={settings} layout={layout} canEdit={!support} isAdmin={!!access.isAdmin && !support} />
    </div>
  )
}
