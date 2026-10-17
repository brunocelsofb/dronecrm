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
import type { IntegrationRow } from '@/components/marketing/integrations-center'
import type { ListRow, SyncRow, OptoutRow } from '@/components/marketing/lists-view'
import type { InboundLead } from '@/components/marketing/marketing-leads'
import { loadListFilterOptions } from '@/lib/marketing/list-data'
import { readTools } from '@/lib/marketing/tools'

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
  const [access, data, { data: tenant }, { data: people }, { data: integrations }, { data: lists }, { data: syncs }, { data: optouts, count: optoutCount }, { data: org }, options, { data: inbound }] = await Promise.all([
    getUserAccess(),
    loadMarketing(tenantId, { year, month }, { year: nowYear, month: nowMonth }),
    db.from('tenants').select('slug').eq('id', tenantId).maybeSingle(),
    db.from('profiles').select('id, full_name').eq('tenant_id', tenantId).not('is_super_admin', 'is', true).order('full_name'),
    db.from('lead_integrations').select('id, kind, name, key, active, settings, received_count, last_received_at, last_error').order('created_at'),
    db.from('marketing_lists').select('id, name, audience, filters, updated_at').order('created_at', { ascending: false }),
    db.from('marketing_list_syncs').select('id, list_id, provider, target, status, total, sent, failed, errors, started_at').order('started_at', { ascending: false }).limit(30),
    db.from('marketing_optouts').select('id, email, source, created_at', { count: 'exact' }).order('created_at', { ascending: false }).limit(30),
    db.from('organization_settings').select('marketing_tools').eq('tenant_id', tenantId).maybeSingle(),
    loadListFilterOptions(tenantId),
    db.from('leads').select('id, name, email, phone, company_name, status, score, source, created_at, campaign_id, handed_off_at, utm_source, utm_medium, gclid, fbclid')
      .eq('entry_type', 'inbound').order('created_at', { ascending: false }).limit(500),
  ])
  // Ferramentas de e-mail: só o que a tela precisa (a chave nunca vai para o navegador)
  const t = readTools(org?.marketing_tools)
  const tools = {
    mailchimp: t.mailchimp ? { last4: t.mailchimp.last4, dc: t.mailchimp.dc, list_id: t.mailchimp.list_id ?? null, list_name: t.mailchimp.list_name ?? null, double_optin: !!t.mailchimp.double_optin } : null,
    rd_station: t.rd_station ? { last4: t.rd_station.last4, legal_basis: t.rd_station.legal_basis ?? null } : null,
  }
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? ''
  const base = host ? `${host.includes('localhost') ? 'http' : 'https'}://${host}` : ''

  return (
    <MarketingView
      year={year} month={month} nowYear={nowYear} nowMonth={nowMonth}
      tab={sp.aba === 'campanhas' || sp.aba === 'links' || sp.aba === 'guia' || sp.aba === 'integracoes' || sp.aba === 'listas' || sp.aba === 'leads' ? sp.aba : 'resultados'}
      inbound={(inbound ?? []) as InboundLead[]}
      tools={tools}
      lists={(lists ?? []) as ListRow[]}
      syncs={(syncs ?? []) as SyncRow[]}
      optouts={{ count: optoutCount ?? 0, recent: (optouts ?? []) as OptoutRow[] }}
      listOptions={options}
      integrations={(integrations ?? []) as IntegrationRow[]}
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
