import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/auth/role'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { GoalsYearForm } from '@/components/settings/goals-year-form'

export default async function MetasPage({ searchParams }: { searchParams: Promise<{ ano?: string }> }) {
  const profile = await getCurrentProfile()
  if (profile?.role !== 'admin') redirect('/settings')

  const sp = await searchParams
  const thisYear = new Date().getFullYear()
  const y = Number(sp.ano)
  const year = Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : thisYear

  const admin = await createScopedAdmin()
  const [{ data: goals }, { data: org }] = await Promise.all([
    admin.from('monthly_goals').select('month, target_value').eq('year', year),
    admin.from('organization_settings').select('measurement_due_day').limit(1).maybeSingle(),
  ])
  const initial: (number | null)[] = Array.from({ length: 12 }, (_, i) => {
    const g = (goals ?? []).find(r => r.month === i + 1)
    const v = g ? Number(g.target_value) : null
    return v && v > 0 ? v : null
  })

  return (
    <div style={{ maxWidth: 820, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <Link href="/settings" style={{ fontSize: 12, color: '#8892a4', textDecoration: 'none' }}>← Configurações</Link>
        <h1 style={{ fontSize: 20, fontWeight: 500, color: '#1a1f36', margin: '4px 0 0' }}>Metas de receita</h1>
        <p style={{ fontSize: 12, color: '#8892a4', marginTop: 3 }}>
          Meta total da empresa, mês a mês. O Painel gerencial compara cada mês com a receita realizada (recorrente + medição + avulso).
        </p>
      </div>
      <GoalsYearForm key={year} year={year} initial={initial} dueDay={Number(org?.measurement_due_day ?? 5)} />
    </div>
  )
}
