import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { CopilotRenewalTemplatesForm } from '@/components/settings/copilot-renewal-templates-form'
import { resolveRenewalTemplates, resolveRenewalEmailSubject, resolveRenewalConfirmationSubject, resolveCommercialEmail } from '@/lib/agent/renewal-templates'
import { resolveInternalSettings } from '@/lib/agent/internal-settings'
import { CopilotInternalForm } from '@/components/settings/copilot-internal-form'
import Link from 'next/link'
import { resolveTenantId } from '@/lib/tenant/context'
import { getAnthropicKeyForTenant } from '@/lib/ai/tenant-key'
import { CopilotActivationCard } from '@/components/settings/copilot-activation-card'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

export default async function CopilotSettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams
  const isInternal = tab === 'interno'
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') redirect('/settings')

  const admin = (await createScopedAdmin())
  const currentTenantId = await resolveTenantId()
  const { data: settings } = await admin
    .from('organization_settings')
    .select('company_name, copilot_settings, tenant_id, evo_instance_aliases')
    .eq('tenant_id', currentTenantId)
    .maybeSingle()
  const keyInfo = await getAnthropicKeyForTenant(currentTenantId)
  const cs = (settings?.copilot_settings ?? {}) as Record<string, unknown>
  const aliasMap = (settings?.evo_instance_aliases ?? {}) as Record<string, unknown>
  const instanceOptions = Object.entries(aliasMap).map(([name, v]) => ({
    name,
    label: typeof v === 'string' ? v : ((v as { label?: string })?.label ?? name),
  }))
  // Razão social da conta (tenant) — é o que assina os e-mails
  const { data: tenant } = settings?.tenant_id
    ? await admin.from('tenants').select('name').eq('id', settings.tenant_id).maybeSingle()
    : { data: null }
  const companyName = tenant?.name ?? settings?.company_name ?? ''
  const { data: users } = await admin
    .from('profiles').select('id, full_name').eq('tenant_id', settings?.tenant_id ?? '').order('full_name')
  const internal = resolveInternalSettings(settings?.copilot_settings)

  const copilot = (settings?.copilot_settings ?? {}) as {
    renewal_templates?: unknown; renewal_email_subject?: unknown; renewal_confirmation_subject?: unknown; commercial_email?: unknown
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Agentes IA (Farmer e Hunter)</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Textos e regras do assistente que acompanha renovações, briefing e alertas.
        </p>
      </div>

      <CopilotActivationCard
        keyStatus={{ source: keyInfo.source, last4: keyInfo.last4 }}
        manager={{
          whatsapp: typeof cs.manager_whatsapp === 'string' ? cs.manager_whatsapp : '',
          instance: typeof cs.manager_instance === 'string' ? cs.manager_instance : '',
          email: typeof cs.manager_email === 'string' ? cs.manager_email : '',
          briefingEnabled: cs.briefing_enabled !== false,
          businessContext: typeof cs.business_context === 'string' ? cs.business_context : '',
        }}
        instances={instanceOptions}
      />

      <div className="flex gap-1 border-b border-gray-200" role="tablist">
        {[
          { key: 'externo', label: 'Externo (cliente)', href: '/settings/copiloto' },
          { key: 'interno', label: 'Interno (time Orbis)', href: '/settings/copiloto?tab=interno' },
        ].map(t => {
          const on = (t.key === 'interno') === isInternal
          return (
            <Link
              key={t.key}
              href={t.href}
              role="tab"
              aria-selected={on}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${on ? 'border-[#1B556B] text-[#1B556B]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            >
              {t.label}
            </Link>
          )
        })}
      </div>

      {isInternal ? (
        <CopilotInternalForm
          initial={internal}
          companyName={companyName}
          users={(users ?? []).map(u => ({ id: u.id as string, name: (u.full_name as string | null) ?? '(sem nome)' }))}
        />
      ) : (
        <CopilotRenewalTemplatesForm
          initial={resolveRenewalTemplates(copilot.renewal_templates)}
          initialSubject={resolveRenewalEmailSubject(copilot.renewal_email_subject)}
          initialConfirmationSubject={resolveRenewalConfirmationSubject(copilot.renewal_confirmation_subject)}
          initialCommercialEmail={resolveCommercialEmail(copilot.commercial_email)}
          initialExtraCc={internal.extraCcEmails.join(', ')}
          companyName={companyName}
        />
      )}
    </div>
  )
}
