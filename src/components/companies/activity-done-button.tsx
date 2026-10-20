'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateActivityStatus } from '@/lib/actions/activities'

export function ActivityDoneButton({ id, done }: { id: string; done: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <button type="button" disabled={pending} onClick={() => start(async () => { await updateActivityStatus(id, done ? 'planned' : 'done'); router.refresh() })}
      className="text-[11px] font-medium text-brand-700 hover:underline disabled:opacity-50">
      {done ? 'Reabrir' : 'Concluir'}
    </button>
  )
}
