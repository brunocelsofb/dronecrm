import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/auth/role'
import { redirect } from 'next/navigation'
import { AbcConfigForm } from '@/components/settings/abc-config-form'

export default async function CurvaAbcPage() {
  const profile = await getCurrentProfile()
  if (profile?.role !== 'admin') redirect('/')
  const supabase = await createClient()
  const { data: configs } = await supabase.from('abc_config').select('*').order('nature')

  const clinica    = configs?.find(c => c.nature === 'eng_clinica')
  const hospitalar = configs?.find(c => c.nature === 'eng_hospitalar')

  return (
    <div style={{ maxWidth: 700, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 500, color: '#1a1f36', margin: '4px 0 0' }}>Curva ABC — Regras de Cálculo</h1>
        <p style={{ fontSize: 12, color: '#8892a4', marginTop: 3 }}>
          Configure os intervalos de faturamento e os thresholds A/B/C por tipo de negócio.
          Fórmula: <strong>Conta = (Faturamento × 0,5) + (Visibilidade × 0,3) + (Fidelidade × 0,2)</strong>
        </p>
      </div>
      <AbcConfigForm
        clinica={clinica ?? { billing_tier1_max: 20000, billing_tier2_max: 60000, curve_a_min: 2.40, curve_b_min: 1.60 }}
        hospitalar={hospitalar ?? { billing_tier1_max: 50000, billing_tier2_max: 150000, curve_a_min: 2.40, curve_b_min: 1.60 }}
      />
    </div>
  )
}
