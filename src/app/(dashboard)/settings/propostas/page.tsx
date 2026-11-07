// Configurações → Propostas: regras do fluxo e, para quem tem o Price, as seções que vêm dele.
import Link from 'next/link'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { resolveTenantId } from '@/lib/tenant/context'
import { getCurrentProfile } from '@/lib/auth/role'
import { getProposalConfig } from '@/lib/proposals/settings'
import { ProposalSettingsForm } from '@/components/settings/proposal-settings-form'
import { PriceSectionsSettings } from '@/components/settings/price-sections-settings'

export default async function ProposalSettingsPage() {
  const tenantId = await resolveTenantId()
  const db = await createScopedAdmin(tenantId)
  const [cfg, me, { data: org }] = await Promise.all([
    getProposalConfig(tenantId),
    getCurrentProfile(),
    db.from('organization_settings').select('price_sections').eq('tenant_id', tenantId).maybeSingle(),
  ])
  return (
    <div className="max-w-3xl space-y-5">
      <Link href="/settings" className="text-sm text-gray-500 hover:text-brand-700">← Configurações</Link>
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Regras da proposta</h1>
        <p className="text-sm text-gray-500">
          Como as propostas desta empresa são precificadas e aprovadas.
        </p>
      </div>
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-medium text-gray-900">Precificação</h3>
        <p className="mt-0.5 text-sm text-gray-700">
          {cfg.priceEnabled
            ? 'Pelo Price: o valor, os itens e as seções da proposta vêm da precificação do Price.'
            : 'Na montagem: o conteúdo é escrito na montagem da proposta e o valor sai dos itens lançados.'}
        </p>
        <p className="mt-1 text-xs text-gray-400">O Price é um recurso do plano.</p>
      </div>
      <ProposalSettingsForm initial={{ techApproval: cfg.techApproval }} canEdit={me?.role === 'admin'} />
      {cfg.priceEnabled && <PriceSectionsSettings initial={(org?.price_sections as string[] | null) ?? null} />}
    </div>
  )
}
