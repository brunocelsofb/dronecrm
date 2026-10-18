import { redirect } from 'next/navigation'
import { getUserAccess } from '@/lib/auth/access'
import { resolveTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { getAnthropicKeyForTenant } from '@/lib/ai/tenant-key'
import { getTenantInstanceNames } from '@/lib/whatsapp/tenant-evo'
import { readSdrSettings } from '@/lib/sdr/settings'
import { SettingsSubpage } from '@/components/settings/settings-subpage'
import { SdrSettingsForm } from '@/components/sdr/sdr-settings-form'

export const dynamic = 'force-dynamic'

export default async function SdrSettingsPage() {
  const access = await getUserAccess()
  if (!access?.isAdmin) redirect('/')
  const tenantId = await resolveTenantId()
  const db = await createScopedAdmin(tenantId)
  const [{ data: org }, { data: people }, key, instanceNames] = await Promise.all([
    db.from('organization_settings').select('sdr_settings, sdr_meta_token_enc, triage_menu_options, triage_enabled, evo_instance_aliases, company_name')
      .eq('tenant_id', tenantId).maybeSingle(),
    db.from('profiles').select('id, full_name, department, access_profile').eq('tenant_id', tenantId).not('is_super_admin', 'is', true).order('full_name'),
    getAnthropicKeyForTenant(tenantId),
    getTenantInstanceNames(tenantId),
  ])
  const settings = readSdrSettings(org?.sdr_settings)
  if (!org?.sdr_meta_token_enc) settings.meta.last4 = null
  // Números da empresa (sem os privados), com o nome dado em Conexões
  const aliases = (org?.evo_instance_aliases ?? {}) as Record<string, { label?: string; alias?: string; private?: boolean } | undefined>
  const instances = instanceNames.filter(n => aliases[n]?.private !== true).map(n => ({ name: n, label: aliases[n]?.label || aliases[n]?.alias || n }))
  const menu = ((org?.triage_menu_options ?? []) as { label: string; department: string }[])
    .filter(o => o?.department).map(o => ({ department: o.department, label: o.label }))

  return (
    <SettingsSubpage title="SDR de IA" description="Assistente virtual que atende no WhatsApp, qualifica e passa os leads para o comercial.">
      <SdrSettingsForm
        initial={settings}
        instances={instances}
        departments={menu}
        triageOn={org?.triage_enabled !== false && menu.length > 0}
        people={(people ?? []).map(p => ({ id: p.id as string, name: (p.full_name as string | null) ?? '—' }))}
        aiReady={!!key.key}
        companyName={(org?.company_name as string | null) ?? ''}
      />
    </SettingsSubpage>
  )
}
