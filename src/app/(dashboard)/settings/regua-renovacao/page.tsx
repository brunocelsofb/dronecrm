import { redirect } from 'next/navigation'
import { getUserAccess } from '@/lib/auth/access'
import { resolveTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { resolveRulerSettings } from '@/lib/agent/renewal-ruler'
import { SettingsSubpage } from '@/components/settings/settings-subpage'
import { RenewalRulerForm } from '@/components/settings/renewal-ruler-form'

export const dynamic = 'force-dynamic'

export default async function RenewalRulerSettingsPage() {
  const access = await getUserAccess()
  if (!access?.isAdmin) redirect('/settings')
  const tenantId = await resolveTenantId()
  const db = await createScopedAdmin(tenantId)
  const [{ data: org }, { data: areaRows }, { data: people }] = await Promise.all([
    db.from('organization_settings').select('copilot_settings, company_name').eq('tenant_id', tenantId).maybeSingle(),
    db.from('org_areas').select('id, name, lead_id, manager_id').order('name'),
    db.from('profiles').select('id, full_name'),
  ])
  const nameOf = new Map(((people ?? []) as { id: string; full_name: string | null }[]).map(p => [p.id, p.full_name ?? '—']))
  const orgAreas = ((areaRows ?? []) as { id: string; name: string; lead_id: string | null; manager_id: string | null }[])
    .map(a => ({ id: a.id, name: a.name, coordinator: (a.lead_id && nameOf.get(a.lead_id)) || '—', manager: (a.manager_id && nameOf.get(a.manager_id)) || '—' }))
  return (
    <SettingsSubpage
      title="Régua de renovação"
      description="Passos da renovação, começando junto com o &quot;preparar a renovação&quot;. Em cada passo: aviso (sino, WhatsApp e e-mail) ao coordenador e ao gerente da área, tarefa encaminhada ao coordenador; quem recebeu escreve o que fez e conclui; o consultor recebe o retorno e o próximo passo abre."
    >
      <RenewalRulerForm initial={resolveRulerSettings(org?.copilot_settings)} companyName={(org?.company_name as string | null) ?? ''} orgAreas={orgAreas} />
    </SettingsSubpage>
  )
}
