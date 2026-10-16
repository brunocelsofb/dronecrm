'use client'

// Campanha de um lead ou de uma oportunidade (liga o resultado ao marketing)

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { setRecordCampaign } from '@/lib/actions/marketing'

export function CampaignPicker({ kind, id, value, campaigns, disabled }: {
  kind: 'lead' | 'contract'
  id: string
  value: string | null
  campaigns: { id: string; name: string; status: string }[]
  disabled?: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [current, setCurrent] = useState(value ?? '')
  const [err, setErr] = useState<string | null>(null)
  const options = campaigns.filter(c => c.status !== 'encerrada' || c.id === value)

  return (
    <span className="inline-flex flex-col">
      <select
        aria-label="Campanha"
        value={current}
        disabled={disabled || pending}
        onChange={e => {
          const next = e.target.value
          const prev = current
          setCurrent(next); setErr(null)
          start(async () => {
            const r = await setRecordCampaign({ kind, id, campaignId: next || null })
            if (!r.ok) { setCurrent(prev); setErr(r.error) } else router.refresh()
          })
        }}
        className="max-w-full rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-brand-700 focus:outline-none"
      >
        <option value="">Sem campanha</option>
        {options.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      {err && <span className="mt-0.5 text-[11px] text-red-600">{err}</span>}
    </span>
  )
}
