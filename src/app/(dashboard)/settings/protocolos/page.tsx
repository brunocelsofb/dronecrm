import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/auth/role'
import { resolveTenantId } from '@/lib/tenant/context'
import { NumberingSettingsForm } from '@/components/settings/numbering-settings-form'
import { SettingsSubpage } from '@/components/settings/settings-subpage'

export const dynamic = 'force-dynamic'

export default async function ProtocolosSettingsPage() {
  const profile = await getCurrentProfile()
  if (profile?.role !== 'admin') redirect('/')
  const supabase = await createClient()
  const { data: s } = await supabase.from('organization_settings').select('ticket_number_prefix, proposal_number_prefix').eq('tenant_id', await resolveTenantId()).maybeSingle()
  return (
    <SettingsSubpage title="Numeração de chamados e propostas" description="Prefixo e próximo número dos protocolos de atendimento e das propostas.">
      <NumberingSettingsForm currentTicketPrefix={s?.ticket_number_prefix ?? 'TK'} currentProposalPrefix={s?.proposal_number_prefix ?? 'P'} />
      <p className="text-xs text-gray-500">A numeração das oportunidades fica em <Link href="/settings/numeracao" className="text-brand-700 hover:underline">Numeração de oportunidades</Link>.</p>
    </SettingsSubpage>
  )
}
