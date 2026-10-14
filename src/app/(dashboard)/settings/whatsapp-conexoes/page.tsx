import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { WhatsAppSettingsForm } from '@/components/settings/whatsapp-settings-form'
import { WhatsAppInstancesPanel } from '@/components/settings/whatsapp-instances-panel'
import { resolveTenantId } from '@/lib/tenant/context'
import { getWhatsAppLimit, getTenantInstanceNames } from '@/lib/whatsapp/tenant-evo'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

export default async function WhatsAppConexoesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') redirect('/settings')

  const admin = (await createScopedAdmin())
  const tenantId = await resolveTenantId()
  const { data: settings } = await admin.from('organization_settings')
    .select('evo_server_url, evo_api_key, evo_instance_name, evo_instance_aliases').eq('tenant_id', tenantId).maybeSingle()
  const usesPlatformServer = !(settings?.evo_server_url && settings?.evo_api_key)
  const [limit, ownedNames] = await Promise.all([getWhatsAppLimit(tenantId), getTenantInstanceNames(tenantId)])

  // Consultores e o e-mail conectado de cada um (remetente dos avisos de renovação)
  const [{ data: profilesList }, { data: emailAccounts }] = await Promise.all([
    admin.from('profiles').select('id, full_name').eq('tenant_id', tenantId).order('full_name'),
    admin.from('email_accounts').select('user_id, email').eq('tenant_id', tenantId),
  ])
  const emailByUser = new Map((emailAccounts ?? []).map((e: { user_id: string; email: string }) => [e.user_id, e.email]))
  const owners = (profilesList ?? []).map((p: { id: string; full_name: string | null }) => ({
    id: p.id, full_name: p.full_name ?? '', email: emailByUser.get(p.id) ?? null,
  }))

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Conexões — Evolution API</h1>
        <p className="mt-0.5 text-sm text-gray-500">Gerencie as instâncias conectadas, QR Code e aliases dos números.</p>
      </div>
      <WhatsAppSettingsForm
        isConnected={!!(settings as any)?.evo_instance_name}
        currentServerUrl={(settings as any)?.evo_server_url ?? null}
        currentInstanceName={(settings as any)?.evo_instance_name ?? null}
        usesPlatformServer={usesPlatformServer}
        limitInfo={`Seu plano permite ${limit} WhatsApp(s); em uso: ${ownedNames.length}.`}
      />
      <WhatsAppInstancesPanel instanceAliases={(settings as any)?.evo_instance_aliases ?? {}} users={owners} />
    </div>
  )
}
