/**
 * Configurações → Integrações (Admin): onde a empresa escolhe e configura as
 * ferramentas que conversam com o CRM — faturamento (ERP), anúncios, automação
 * de marketing e formulários do site. Nas abas do menu fica só o uso do dia a dia.
 */

import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { getCurrentProfile } from '@/lib/auth/role'
import { resolveTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { readErpConfig } from '@/lib/erp/connectors'
import { readTools } from '@/lib/marketing/tools'
import { IntegrationsCenter, type IntegrationRow } from '@/components/marketing/integrations-center'
import { BillingIntegrationCard } from '@/components/financeiro/billing-integration-card'
import { SettingsSubpage } from '@/components/settings/settings-subpage'

export const dynamic = 'force-dynamic'

export default async function IntegracoesSettingsPage({ searchParams }: { searchParams: Promise<{ cat?: string }> }) {
  const profile = await getCurrentProfile()
  if (profile?.role !== 'admin') redirect('/')
  const { cat } = await searchParams
  const tenantId = await resolveTenantId()
  const db = await createScopedAdmin(tenantId)
  const [{ data: org }, { data: integrations }, { data: campaigns }] = await Promise.all([
    db.from('organization_settings').select('billing_erp, marketing_tools').eq('tenant_id', tenantId).maybeSingle(),
    db.from('lead_integrations').select('id, kind, name, key, active, settings, received_count, last_received_at, last_error').order('created_at'),
    db.from('marketing_campaigns').select('id, name, status').order('name'),
  ])
  const erp = readErpConfig(org?.billing_erp)
  const t = readTools(org?.marketing_tools)
  const tools = {
    mailchimp: t.mailchimp ? { last4: t.mailchimp.last4, dc: t.mailchimp.dc, list_id: t.mailchimp.list_id ?? null, list_name: t.mailchimp.list_name ?? null, double_optin: !!t.mailchimp.double_optin } : null,
    rd_station: t.rd_station ? { last4: t.rd_station.last4, legal_basis: t.rd_station.legal_basis ?? null } : null,
  }
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? ''
  const base = host ? `${host.includes('localhost') ? 'http' : 'https'}://${host}` : ''

  return (
    <SettingsSubpage title="Integrações" description="Escolha as ferramentas que a empresa usa e configure como elas conversam com o CRM.">
        <IntegrationsCenter
          initialCat={cat}
          rows={(integrations ?? []) as IntegrationRow[]}
          campaigns={campaigns ?? []}
          baseUrl={base}
          tools={tools}
          erp={<BillingIntegrationCard erp={{ provider: erp.provider, flowStart: erp.flow_start ?? null, hasReturnKey: !!erp.webhook_secret, outUrl: erp.out_url ?? null, hasOutSecret: !!erp.out_secret }} />}
        />
    </SettingsSubpage>
  )
}
