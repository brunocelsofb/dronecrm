import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/auth/role'
import { resolveTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { OrganizationSettingsForm } from '@/components/settings/organization-settings-form'
import { SettingsSubpage } from '@/components/settings/settings-subpage'
import { TheoSettingsView } from '@/components/settings/theo-settings'
import { THEO_PROVIDERS, type TheoProvider } from '@/lib/ai/theo-catalog'
import { DEFAULT_BUDGET_USD, modelFor, monthUsage, readTheoSettings } from '@/lib/ai/theo-server'

export const dynamic = 'force-dynamic'

// Configurações → Théo (só admin): IA e chave da empresa, gasto, limite e quem usa
export default async function AssistenteSettingsPage() {
  const profile = await getCurrentProfile()
  if (profile?.role !== 'admin') redirect('/')
  const supabase = await createClient()
  const tenantId = await resolveTenantId()
  const db = await createScopedAdmin()
  const [{ data: s }, { data: team }, usage] = await Promise.all([
    supabase.from('organization_settings').select('assistant_monthly_budget_usd, theo_settings').eq('tenant_id', tenantId).maybeSingle(),
    db.from('profiles').select('id, full_name, role').order('full_name'),
    tenantId ? monthUsage(tenantId) : Promise.resolve({ total: 0, byProvider: {} as Record<string, { cost: number; calls: number }> }),
  ])
  const settings = readTheoSettings((s as { theo_settings?: unknown } | null)?.theo_settings)
  const providers = Object.fromEntries(THEO_PROVIDERS.map(p => [p.id, {
    last4: settings.keys?.[p.id]?.last4 ?? null,
    model: modelFor(settings, p.id),
    costUsd: usage.byProvider[p.id]?.cost ?? 0,
    calls: usage.byProvider[p.id]?.calls ?? 0,
  }])) as Record<TheoProvider, { last4: string | null; model: string; costUsd: number; calls: number }>
  const budget = Number(s?.assistant_monthly_budget_usd ?? DEFAULT_BUDGET_USD) || DEFAULT_BUDGET_USD
  const users = ((team ?? []) as { id: string; full_name: string | null; role: string | null }[])
    .filter(u => u.role !== 'admin').map(u => ({ id: u.id, name: u.full_name || 'Sem nome' }))

  return (
    <SettingsSubpage title="Théo — assistente de IA" description="IA e chave da empresa, gasto do mês, limite e quem usa. O que ele faz em cada licença está na tela IA.">
      <p className="mb-4 text-sm text-gray-600">
        Veja o que o Théo e os agentes fazem na sua licença em <Link href="/ia" className="font-medium text-brand-700 hover:underline">IA da empresa</Link>.
      </p>
      <TheoSettingsView active={settings.active ?? null} providers={providers} budgetUsd={budget} monthTotalUsd={usage.total}
        users={users} allowed={settings.allowed_user_ids ?? []} />
      <div className="mt-6">
        <OrganizationSettingsForm show="orcamento" currentName="" currentCompanyName="" currentCompanyCnpj="" currentLogoPath={null}
          currentHeaderText="" currentFooterText="" currentBrandColor="#1B556B" currentAssistantBudget={budget} />
      </div>
    </SettingsSubpage>
  )
}
