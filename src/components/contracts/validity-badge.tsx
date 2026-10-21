import { getValidityStatus, daysUntil, VALIDITY_STYLES } from '@/lib/utils/validity'
import { formatDateOnlyBR } from '@/lib/utils/date'

export function ValidityBadge({ validUntil, runStatus }: { validUntil: string | null; runStatus?: string | null }) {
  const status = getValidityStatus(validUntil)
  if (status === 'unknown' || !validUntil) return null

  const days = daysUntil(validUntil)
  const dateStr = formatDateOnlyBR(validUntil)
  const isWon = runStatus === 'won'

  const label = isWon ? 'Vigência' : 'Validade'

  const text =
    status === 'expired'
      ? `${label}: venceu ${dateStr} · ${Math.abs(days)}d atrás`
      : `${label}: ${dateStr} · ${days}d`

  return (
    <div className="flex flex-col gap-0.5">
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${VALIDITY_STYLES[status]}`}>
        {text}
      </span>
    </div>
  )
}
