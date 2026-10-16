/**
 * Financeiro — o que foi enviado para faturamento e o que ainda falta, mês a mês.
 * Mesmos números do Painel gerencial (computeDashboard): em contrato, apurado,
 * enviado, faturado e diferença.
 */

import { loadDashboardInput } from '@/lib/revenue/dashboard-data'
import { computeDashboard } from '@/lib/revenue/dashboard-compute'
import { getCurrentProfile } from '@/lib/auth/role'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { resolveTenantId } from '@/lib/tenant/context'
import { readErpConfig } from '@/lib/erp/connectors'
import { FinanceiroView } from '@/components/financeiro/financeiro-view'

export const dynamic = 'force-dynamic'

const p_isAdmin = (role: string | null | undefined) => role === 'admin'

export default async function FinanceiroPage({ searchParams }: { searchParams: Promise<{ ano?: string; mes?: string }> }) {
  const sp = await searchParams
  const now = new Date(Date.now() - 3 * 60 * 60 * 1000) // Brasília
  const nowYear = now.getUTCFullYear(), nowMonth = now.getUTCMonth() + 1
  const y = Number(sp.ano), m = Number(sp.mes)
  const year = Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : nowYear
  const month = Number.isInteger(m) && m >= 1 && m <= 12 ? m : (year === nowYear ? nowMonth : 12)

  const tenantId = await resolveTenantId()
  const db = await createScopedAdmin(tenantId)
  const [input, profile, { data: owners }, { data: errors }, { data: org }] = await Promise.all([
    loadDashboardInput(year, tenantId),
    getCurrentProfile(),
    db.from('contracts').select('id, owner_id'),
    db.from('billing_submissions').select('id, contract_id, source_type, erp_error, sent_at').eq('year', year).eq('month', month).eq('status', 'erro').order('sent_at', { ascending: false }).limit(50),
    db.from('organization_settings').select('billing_erp').limit(1).maybeSingle(),
  ])
  const d = computeDashboard(input, year, month)
  const ownerIds = [...new Set((owners ?? []).map(o => o.owner_id).filter(Boolean))] as string[]
  const { data: people } = ownerIds.length ? await db.from('profiles').select('id, full_name').in('id', ownerIds) : { data: [] as { id: string; full_name: string | null }[] }
  const nameOf = new Map((people ?? []).map(p => [p.id, p.full_name ?? '']))
  const ownerOf: Record<string, { id: string | null; name: string }> = {}
  for (const o of owners ?? []) ownerOf[o.id] = { id: o.owner_id ?? null, name: o.owner_id ? nameOf.get(o.owner_id) ?? '' : '' }

  // Prazo do relatório de medição: dia N do mês seguinte ao de referência
  const dueYear = month === 12 ? year + 1 : year
  const dueMonth = month === 12 ? 1 : month + 1
  const dueDay = Math.min(Math.max(input.measurementDueDay || 5, 1), 28)
  const dueIso = `${dueYear}-${String(dueMonth).padStart(2, '0')}-${String(dueDay).padStart(2, '0')}`
  const todayIso = now.toISOString().slice(0, 10)
  const cfg = readErpConfig(org?.billing_erp)

  return (
    <FinanceiroView
      year={year} month={month} nowYear={nowYear} nowMonth={nowMonth}
      revenue={{
        potential: d.revenue.contractPotential, apurado: d.revenue.contractBilled, sent: d.revenue.contractSent,
        invoiced: d.revenue.contractInvoiced, gap: d.revenue.contractGap, avulsoSent: d.revenue.avulsoSent,
        avulsoInvoiced: d.revenue.avulsoInvoiced, avulsoTotal: d.revenue.avulsoTotal, flow: d.revenue.billingFlow,
        parts: d.revenue.gapParts,
      }}
      rows={d.revenue.finRows}
      owners={ownerOf}
      errors={(errors ?? []).map(e => ({ ...e, client: input.contracts.find(c => c.id === e.contract_id)?.client_name ?? '—' }))}
      me={{ id: profile?.id ?? '', isAdmin: profile?.role === 'admin' }}
      due={{ iso: dueIso, overdue: todayIso > dueIso, day: dueDay }}
      erp={{ provider: cfg.provider, flowStart: cfg.flow_start ?? null, hasReturnKey: !!cfg.webhook_secret, outUrl: p_isAdmin(profile?.role) ? (cfg.out_url ?? null) : null, hasOutSecret: !!cfg.out_secret }}
    />
  )
}
