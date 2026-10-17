import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/auth/role'
import { redirect } from 'next/navigation'
import { CarteiraConfigManager } from '@/components/settings/carteira-config-manager'
import { resolveTenantId } from '@/lib/tenant/context'

export default async function CarteiraConfigPage() {
  const profile = await getCurrentProfile()
  if (profile?.role !== 'admin') redirect('/')
  const supabase = await createClient()

  // Seções configuráveis da carteira — armazenadas em organization_settings
  const { data: settings } = await supabase
    .from('organization_settings')
    .select('carteira_sections')
    .eq('tenant_id', await resolveTenantId())
    .maybeSingle()

  return (
    <div style={{ maxWidth: 700, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 500, color: '#1a1f36', margin: '4px 0 0' }}>Gestão da Carteira</h1>
        <p style={{ fontSize: 12, color: '#8892a4', marginTop: 3 }}>
          Configure os campos que aparecem na aba de dados da carteira nos contratos em gestão.
        </p>
      </div>
      <CarteiraConfigManager />
    </div>
  )
}
