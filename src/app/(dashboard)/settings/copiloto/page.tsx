import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { CopilotRenewalTemplatesForm } from '@/components/settings/copilot-renewal-templates-form'
import { resolveRenewalTemplates } from '@/lib/agent/renewal-templates'

export default async function CopilotSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') redirect('/settings')

  const { data: settings } = await createAdminClient()
    .from('organization_settings')
    .select('company_name, copilot_settings')
    .eq('id', 'default')
    .maybeSingle()

  const copilot = (settings?.copilot_settings ?? {}) as { renewal_templates?: unknown }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Copiloto IA</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Textos e regras do assistente que acompanha renovações, briefing e alertas.
        </p>
      </div>

      <CopilotRenewalTemplatesForm
        initial={resolveRenewalTemplates(copilot.renewal_templates)}
        companyName={settings?.company_name ?? ''}
      />
    </div>
  )
}
