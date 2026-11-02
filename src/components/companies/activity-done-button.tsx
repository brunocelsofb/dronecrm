'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useHandoffDone } from '@/components/activities/handoff-note-modal'

export function ActivityDoneButton({ id, done }: { id: string; done: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const handoff = useHandoffDone(() => router.refresh())
  return (
    <>
      {handoff.modal}
      <button type="button" disabled={pending} onClick={() => start(async () => { if (await handoff.toggle(id, done ? 'planned' : 'done')) router.refresh() })}
        className="text-[11px] font-medium text-brand-700 hover:underline disabled:opacity-50">
        {done ? 'Reabrir' : 'Concluir'}
      </button>
    </>
  )
}
