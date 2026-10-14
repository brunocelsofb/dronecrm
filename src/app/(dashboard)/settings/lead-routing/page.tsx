import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { LeadRoutingEditor } from '@/components/settings/lead-routing-editor'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

export default async function LeadRoutingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') redirect('/settings')

  const admin = (await createScopedAdmin())
  const [{ data: rules }, { data: pipelines }, { data: stages }, { data: users }] = await Promise.all([
    admin.from('lead_routing_rules').select('*').order('priority'),
    admin.from('pipelines').select('id, name').order('name'),
    admin.from('stages').select('id, name, pipeline_id').order('order_index'),
    admin.from('profiles').select('id, full_name, role').order('full_name'),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Roteamento de Leads</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Defina regras para encaminhar leads automaticamente para o funil e etapa corretos com base em condições configuráveis.
        </p>
      </div>
      <LeadRoutingEditor
        initialRules={(rules ?? []) as any}
        pipelines={pipelines ?? []}
        stages={stages ?? []}
        users={users ?? []}
      />
    </div>
  )
}
