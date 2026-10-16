/**
 * Marketing — campanhas ligadas ao resultado: investimento → leads →
 * oportunidades → ganhos → faturado (mesma regra da meta).
 * Acesso: aba "marketing" do plano + perfil de acesso (Admin, Gestor, Marketing).
 */

import { headers } from 'next/headers'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { resolveTenantId } from '@/lib/tenant/context'
import { getUserAccess } from '@/lib/auth/access'
import { loadMarketing } from '@/lib/marketing/data'
import { MarketingView } from '@/components/marketing/marketing-view'

export const dynamic = 'force-dynamic'

export default async function MarketingPage({ searchParams }: { searchParams: Promise<{ ano?: string; mes?: string; aba?: string }> }) {
  const sp = await searchParams
  const now = new Date(Date.now() - 3 * 3600_000) // Brasília
  const nowYear = now.getUTCFullYear(), nowMonth = now.getUTCMonth() + 1
  const y = Number(sp.ano), m = Number(sp.mes)
  const year = Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : nowYear
  const month = sp.mes === 'ano' ? null : Number.isInteger(m) && m >= 1 && m <= 12 ? m : (year === nowYear ? nowMonth : null)

  const tenantId = await resolveTenantId()
  const db = await createScopedAdmin(tenantId)
  const [access, data, { data: tenant }, { data: people }] = await Promise.all([
    getUserAccess(),
    loadMarketing(tenantId, { year, month }, { year: nowYear, month: nowMonth }),
    db.from('tenants').select('slug').eq('id', tenantId).maybeSingle(),
    db.from('profiles').select('id, full_name').eq('tenant_id', tenantId).not('is_super_admin', 'is', true).order('full_name'),
  ])
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? ''
  const base = host ? `${host.includes('localhost') ? 'http' : 'https'}://${host}` : ''

  return (
    <MarketingView
      year={year} month={month} nowYear={nowYear} nowMonth={nowMonth}
      tab={sp.aba === 'campanhas' || sp.aba === 'links' || sp.aba === 'guia' ? sp.aba : 'resultados'}
      campaigns={data.campaigns}
      costs={data.costs}
      report={data.report}
      people={(people ?? []).map(p => ({ id: p.id, name: p.full_name ?? '' }))}
      baseUrl={base}
      slug={(tenant as { slug?: string | null } | null)?.slug ?? null}
      canSeeContracts={!!access?.features.includes('contracts')}
    />
  )
}
