import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/auth/role'
import { redirect } from 'next/navigation'
import { LostReasonsManager } from '@/components/settings/lost-reasons-manager'

export default async function MotivosPerda() {
  const profile = await getCurrentProfile()
  if (profile?.role !== 'admin') redirect('/')
  const supabase = await createClient()
  const { data: reasons } = await supabase.from('lost_reasons').select('*').order('display_order')
  return (
    <div style={{ maxWidth: 600, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 500, color: '#1a1f36', margin: '4px 0 0' }}>Motivos de Perda</h1>
        <p style={{ fontSize: 12, color: '#8892a4', marginTop: 3 }}>
          Aparecem ao marcar uma oportunidade como Perdida — usados no dashboard de gestão à vista.
        </p>
      </div>
      <LostReasonsManager initialReasons={reasons ?? []} />
    </div>
  )
}
