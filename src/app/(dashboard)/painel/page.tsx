import { loadDashboardInput } from '@/lib/revenue/dashboard-data'
import { computeDashboard } from '@/lib/revenue/dashboard-compute'
import { getCurrentProfile } from '@/lib/auth/role'
import { PainelView } from '@/components/painel/painel-view'

export const dynamic = 'force-dynamic'

export default async function PainelPage({ searchParams }: { searchParams: Promise<{ ano?: string; mes?: string; visao?: string; meses?: string }> }) {
  const sp = await searchParams
  const now = new Date(Date.now() - 3 * 60 * 60 * 1000) // Brasília
  const nowYear = now.getUTCFullYear(), nowMonth = now.getUTCMonth() + 1
  const y = Number(sp.ano), m = Number(sp.mes)
  const year = Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : nowYear
  const month = Number.isInteger(m) && m >= 1 && m <= 12 ? m : (year === nowYear ? nowMonth : 12)
  const isYear = sp.visao === 'ano'
  const pickedMonths = (sp.meses ?? '').split(',').map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 12)

  const [input, profile] = await Promise.all([loadDashboardInput(year), getCurrentProfile()])
  const d = computeDashboard(input, year, month, isYear ? 'year' : 'month', pickedMonths)

  return (
    <PainelView d={d} input={input} isAdmin={profile?.role === 'admin'} year={year} month={month} isYear={isYear} nowYear={nowYear} nowMonth={nowMonth} />
  )
}
