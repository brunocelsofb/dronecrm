import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/auth/role'
import { resolveTenantId } from '@/lib/tenant/context'
import { InboundEmailSettingsForm } from '@/components/settings/inbound-email-settings-form'
import { SettingsSubpage } from '@/components/settings/settings-subpage'

export const dynamic = 'force-dynamic'

export default async function EmailSettingsPage() {
  const profile = await getCurrentProfile()
  if (profile?.role !== 'admin') redirect('/')
  const supabase = await createClient()
  const { data: s } = await supabase.from('organization_settings').select('inbound_email_domain, mailgun_webhook_signing_key').eq('tenant_id', await resolveTenantId()).maybeSingle()
  return (
    <SettingsSubpage title="Recebimento de e-mail" description="Respostas dos clientes caindo direto na oportunidade.">
      <InboundEmailSettingsForm currentDomain={s?.inbound_email_domain ?? ''} hasSigningKey={!!s?.mailgun_webhook_signing_key} />
      <p className="text-xs text-gray-500">Para <strong>enviar</strong> e-mails, cada pessoa conecta o próprio Gmail em <Link href="/minha-conta" className="text-brand-700 hover:underline">Minha conta</Link>.</p>
    </SettingsSubpage>
  )
}
