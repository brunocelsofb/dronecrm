import Link from 'next/link'
import { fmtPct } from '@/lib/format'
import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/auth/role'
import { GoalEditForm } from '@/components/dashboard/goal-edit-form'
import { BillingTrendChart } from '@/components/dashboard/billing-trend-chart'
import { Target } from 'lucide-react'

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]
const MONTH_SHORT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

function fmt(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
}

// A meta é focada exclusivamente na Gestão de Contratos (receita
// recorrente já confirmada/faturada) — nunca no valor especulativo do
// funil de vendas. É por isso que essa seção só existe quando o funil
// selecionado é do tipo "gestao_contratos".
export async function GoalVsBillingSection({
  selectedPipeline,
  month,
  year,
}: {
  selectedPipeline: string | undefined
  month: number
  year: number
}) {
  const supabase = await createClient()
  const currentProfile = await getCurrentProfile()

  // Últimos 6 meses (incluindo o selecionado) pra montar o gráfico de
  // tendência — gerado como lista de {year, month} pra buscar tudo de
  // uma vez em duas consultas (não uma por mês).
  const months: { year: number; month: number }[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(year, month - 1 - i, 1)
    months.push({ year: d.getFullYear(), month: d.getMonth() + 1 })
  }

  const [{ data: goals }, { data: billing }, { data: currentMonthRecords }] = await Promise.all([
    supabase.from('monthly_goals').select('year, month, target_value'),
    supabase.from('billing_records').select('year, month, amount'),
    supabase
      .from('billing_records')
      .select('id, contract_id, amount, notes, file_name, confirmed_at')
      .eq('year', year)
      .eq('month', month)
      .order('confirmed_at', { ascending: false }),
  ])

  const contractIds = [...new Set((currentMonthRecords ?? []).map((r) => r.contract_id))]
  const { data: contractsForRecords } = contractIds.length
    ? await supabase.from('contracts').select('id, client_name, process_number, billing_type').in('id', contractIds)
    : { data: [] as { id: string; client_name: string; process_number: string; billing_type: string }[] }
  const contractByIdForRecords = new Map((contractsForRecords ?? []).map((c) => [c.id, c]))

  const goalByKey = new Map((goals ?? []).map((g) => [`${g.year}-${g.month}`, g.target_value]))
  const billingByKey = new Map<string, number>()
  for (const b of billing ?? []) {
    const key = `${b.year}-${b.month}`
    billingByKey.set(key, (billingByKey.get(key) ?? 0) + Number(b.amount))
  }

  const trendData = months.map(({ year: y, month: m }) => ({
    label: `${MONTH_SHORT[m - 1]}/${String(y).slice(2)}`,
    meta: goalByKey.get(`${y}-${m}`) ?? 0,
    faturado: billingByKey.get(`${y}-${m}`) ?? 0,
  }))

  const currentTarget = goalByKey.get(`${year}-${month}`) ?? 0
  const currentBilled = billingByKey.get(`${year}-${month}`) ?? 0
  const pct = currentTarget > 0 ? (currentBilled / currentTarget) * 100 : null

  const prevDate = new Date(year, month - 2, 1)
  const nextDate = new Date(year, month, 1)

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-brand-100">
            <Target size={17} strokeWidth={1.75} className="text-brand-700" />
          </div>
          <div>
            <h2 className="text-sm font-medium text-foreground">Meta vs Faturamento</h2>
            <p className="text-xs text-gray-400">Receita recorrente confirmada — Gestão de Contratos</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/?pipeline=${selectedPipeline}&goalMonth=${prevDate.getMonth() + 1}&goalYear=${prevDate.getFullYear()}`}
            className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
          >
            ← {MONTH_SHORT[prevDate.getMonth()]}
          </Link>
          <span className="text-sm font-medium text-gray-700">{MONTH_NAMES[month - 1]}/{year}</span>
          <Link
            href={`/?pipeline=${selectedPipeline}&goalMonth=${nextDate.getMonth() + 1}&goalYear=${nextDate.getFullYear()}`}
            className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
          >
            {MONTH_SHORT[nextDate.getMonth()]} →
          </Link>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-4">
        <div>
          <p className="text-xs text-gray-500">Meta do mês</p>
          <p className="text-2xl font-semibold text-gray-900">{fmt(currentTarget)}</p>
          {currentProfile?.role === 'admin' && (
            <div className="mt-1">
              <GoalEditForm year={year} month={month} currentTarget={currentTarget} />
            </div>
          )}
        </div>
        <div>
          <p className="text-xs text-gray-500">Faturado confirmado</p>
          <p className="text-2xl font-semibold text-brand-700">{fmt(currentBilled)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Atingimento</p>
          <p className={`text-2xl font-semibold ${pct === null ? 'text-gray-300' : pct >= 100 ? 'text-positive-700' : pct >= 70 ? 'text-yellow-700' : 'text-negative-700'}`}>
            {fmtPct(pct)}
          </p>
        </div>
      </div>

      {currentTarget > 0 && (
        <div className="mt-3">
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className={`h-full rounded-full ${pct !== null && pct >= 100 ? 'bg-positive-600' : pct !== null && pct >= 70 ? 'bg-yellow-500' : 'bg-negative-500'}`}
              style={{ width: `${Math.min(pct ?? 0, 100)}%` }}
            />
          </div>
        </div>
      )}

      <div className="mt-6">
        <p className="mb-2 text-xs font-medium text-gray-500">Últimos 6 meses</p>
        <BillingTrendChart data={trendData} />
      </div>

      <div className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-medium text-gray-500">
            Contratos confirmados em {MONTH_NAMES[month - 1]}/{year} ({currentMonthRecords?.length ?? 0})
          </p>
          {currentMonthRecords && currentMonthRecords.length > 0 && (
            <a
              href={`/api/export/billing-report?year=${year}&month=${month}`}
              className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              📊 Exportar Excel (pro Financeiro)
            </a>
          )}
        </div>
        <div className="space-y-1.5">
          {currentMonthRecords?.map((r) => {
            const contract = contractByIdForRecords.get(r.contract_id)
            return (
              <Link
                key={r.id}
                href={contract ? `/contracts/${r.contract_id}` : '#'}
                className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm hover:bg-gray-50"
              >
                <div>
                  <span className="font-medium text-gray-900">{contract?.client_name ?? 'Contrato removido'}</span>
                  {contract && <span className="ml-2 font-mono text-xs text-gray-400">{contract.process_number}</span>}
                  {contract?.billing_type === 'metered' && (
                    <span className="ml-2 rounded-full bg-yellow-100 px-1.5 py-0.5 text-[10px] font-medium text-yellow-800">Sob medição</span>
                  )}
                  {r.file_name && <span className="ml-2 text-xs text-brand-700">📎 {r.file_name}</span>}
                </div>
                <span className="font-medium text-gray-700">{fmt(Number(r.amount))}</span>
              </Link>
            )
          })}
          {(!currentMonthRecords || currentMonthRecords.length === 0) && (
            <p className="rounded-lg border border-dashed border-gray-200 px-3 py-6 text-center text-sm text-gray-400">
              Nenhum contrato com faturamento confirmado neste mês ainda.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
