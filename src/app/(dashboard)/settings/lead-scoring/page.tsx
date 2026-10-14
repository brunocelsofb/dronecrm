import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { LeadScoringEditor } from '@/components/settings/lead-scoring-editor'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

export default async function LeadScoringPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') redirect('/settings')

  const admin = (await createScopedAdmin())
  const { data: rules } = await admin
    .from('lead_scoring_rules')
    .select('*')
    .order('points', { ascending: false })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Lead Scoring</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Defina os pesos dos critérios. O cálculo final do lead terá o teto máximo de 100 pontos.
        </p>
      </div>
      <LeadScoringEditor initialRules={rules ?? []} />
    </div>
  )
}
