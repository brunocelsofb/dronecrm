import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { isCurrentUserAdmin } from '@/lib/auth/role'
import { getCompanySettings } from '@/lib/actions/company-settings'
import { EditCompanyForm } from '@/components/companies/edit-company-form'

export const dynamic = 'force-dynamic'

export default async function EditCompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const [{ data: company }, { data: contacts }, { data: people }, settings, isAdmin] = await Promise.all([
    supabase.from('companies').select('*').eq('id', id).maybeSingle(),
    supabase.from('contacts').select('id, name, role, email, phone, is_primary').eq('company_id', id).order('is_primary', { ascending: false }).order('name'),
    supabase.from('profiles').select('id, full_name').not('is_super_admin', 'is', true).order('full_name'),
    getCompanySettings(),
    isCurrentUserAdmin(),
  ])
  if (!company) notFound()

  return (
    <div className="max-w-4xl space-y-4">
      <Link href={`/companies/${id}`} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-brand-700">← Voltar para a empresa</Link>
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Editar empresa</h1>
        <p className="text-sm text-gray-500">{company.trade_name || company.name}</p>
      </div>
      <EditCompanyForm
        company={company}
        contacts={(contacts ?? []) as never}
        segments={settings.segments}
        people={(people ?? []).map(p => ({ id: p.id as string, name: (p.full_name as string | null) ?? '—' }))}
        isAdmin={isAdmin}
      />
    </div>
  )
}
