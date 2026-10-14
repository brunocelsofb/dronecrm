import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { ImplementationTemplatesEditor } from '@/components/implementation/implementation-templates-editor'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

export default async function ImplementationTemplatesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') redirect('/settings')

  const admin = (await createScopedAdmin())
  const { data: templates } = await admin
    .from('implementation_templates')
    .select('*, implementation_template_tasks(*)')
    .order('name')

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Modelos de Implantação</h1>
        <p className="mt-0.5 text-sm text-gray-500">Crie e edite os templates de cronograma usados ao iniciar uma implantação.</p>
      </div>
      <ImplementationTemplatesEditor initialTemplates={templates ?? []} />
    </div>
  )
}
