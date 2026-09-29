import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { WhatsAppSettingsForm } from '@/components/settings/whatsapp-settings-form'
import { WhatsAppInstancesPanel } from '@/components/settings/whatsapp-instances-panel'

export default async function WhatsAppConexoesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') redirect('/settings')

  const admin = createAdminClient()
  const { data: settings } = await admin.from('organization_settings')
    .select('evo_server_url, evo_api_key, evo_instance_name, evo_instance_aliases').eq('id', 'default').maybeSingle()

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
      />
      <WhatsAppInstancesPanel instanceAliases={(settings as any)?.evo_instance_aliases ?? {}} />
    </div>
  )
}
