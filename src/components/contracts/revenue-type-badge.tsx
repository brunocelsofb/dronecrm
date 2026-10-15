// Selo do tipo de receita do contrato: Recorrente (azul) ou Medição (laranja)

export function RevenueTypeBadge({ billingType, size = 'md' }: { billingType: string | null | undefined; size?: 'sm' | 'md' }) {
  const metered = billingType === 'metered'
  const cls = size === 'sm' ? 'px-1.5 py-px text-[10px]' : 'px-2.5 py-0.5 text-[11px]'
  return (
    <span
      title={metered ? 'Receita por medição: conta o valor medido e validado de cada mês' : 'Receita recorrente: entra automática todo mês pelo valor do contrato'}
      className={`inline-flex items-center gap-1 rounded-full font-medium ${cls} ${metered ? 'bg-orange-100 text-orange-800' : 'bg-blue-100 text-blue-800'}`}
    >
      {metered ? '📏 Medição' : '↻ Recorrente'}
    </span>
  )
}
