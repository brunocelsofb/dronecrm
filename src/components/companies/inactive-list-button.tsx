'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { createInactiveMarketingList } from '@/lib/actions/companies-inactive'

// Cria a lista dinâmica dos inativos (do segmento filtrado) no Marketing
export function InactiveListButton({ segment }: { segment: string | null }) {
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" disabled={pending}
        onClick={() => start(async () => {
          const r = await createInactiveMarketingList(segment)
          setMsg(r.ok ? { ok: true, text: r.existed ? 'A lista já existia no Marketing.' : 'Lista criada no Marketing.' } : { ok: false, text: r.error })
        })}
        className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">
        {pending ? 'Criando…' : `Criar lista no Marketing${segment ? ` (${segment})` : ''}`}
      </button>
      {msg && (
        <span className={`text-xs ${msg.ok ? 'text-positive-700' : 'text-negative-700'}`}>
          {msg.text} {msg.ok && <Link href="/marketing?aba=listas" className="underline">Abrir listas</Link>}
        </span>
      )}
    </div>
  )
}
