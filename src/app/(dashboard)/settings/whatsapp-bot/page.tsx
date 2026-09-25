import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { WhatsAppBotSettingsForm } from '@/components/settings/whatsapp-bot-settings-form'

export default async function WhatsAppBotPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') redirect('/settings')

  const admin = createAdminClient()
  const { data: settings } = await admin
    .from('organization_settings')
    .select('whatsapp_is_online, whatsapp_welcome_message, whatsapp_welcome_message_online, whatsapp_reminder_message, company_name, triage_enabled, triage_menu_options')
    .eq('id', 'default')
    .maybeSingle()

  const defaultMenuOptions = [
    { key: '1', label: 'Vendas', department: 'vendas' },
    { key: '2', label: 'Financeiro', department: 'financeiro' },
    { key: '3', label: 'Técnico', department: 'tecnico' },
  ]

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Bot e Automações — WhatsApp</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Configure o status de atendimento, o Kill Switch e as opções dinâmicas do menu de triagem.
        </p>
      </div>

      <WhatsAppBotSettingsForm
        isOnline={(settings as any)?.whatsapp_is_online ?? false}
        welcomeMessage={(settings as any)?.whatsapp_welcome_message ?? ''}
        welcomeMessageOnline={(settings as any)?.whatsapp_welcome_message_online ?? ''}
        reminderMessage={(settings as any)?.whatsapp_reminder_message ?? ''}
        companyName={(settings as any)?.company_name ?? ''}
        triagemEnabled={(settings as any)?.triage_enabled ?? true}
        initialMenuOptions={(settings as any)?.triage_menu_options ?? defaultMenuOptions}
      />
    </div>
  )
}
