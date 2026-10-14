import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ReportsList } from './reports-list'
import { resolveTenantId } from '@/lib/tenant/context'

// Relatórios mensais de implantação preparados pelo Copiloto (sem contrato):
// revisar e enviar ao time técnico.
export default async function CopilotReportsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const admin = createAdminClient()
  const [{ data: rows }, { data: me }] = await Promise.all([
    admin.from('activities')
      .select('id, title, content, status, activity_date, assigned_to, metadata, created_at')
      .eq('metadata->>kind', 'internal_impl_report')
      .eq('tenant_id', await resolveTenantId())
      .order('created_at', { ascending: false })
      .limit(24),
    admin.from('profiles').select('role').eq('id', user.id).maybeSingle(),
  ])

  return (
    <div className="max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Relatórios de implantação</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Consolidado mensal das fases de implantação, preparado pelo Copiloto IA para revisar e enviar ao time técnico.
        </p>
      </div>
      <ReportsList rows={(rows ?? []) as never[]} isAdmin={me?.role === 'admin'} />
    </div>
  )
}
