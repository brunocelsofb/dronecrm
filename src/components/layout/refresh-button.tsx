'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { RefreshCw } from 'lucide-react'

export function RefreshButton({ variant = 'light' }: { variant?: 'light' | 'dark' | 'rail' }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function handleRefresh() {
    startTransition(() => {
      router.refresh()
    })
  }

  // Barra fina do menu: só o ícone (o texto fica na dica)
  if (variant === 'rail') {
    return (
      <button
        type="button"
        onClick={handleRefresh}
        disabled={isPending}
        title="Atualizar dados desta página"
        aria-label="Atualizar dados desta página"
        className="flex items-center justify-center rounded-md p-1.5 text-brand-100/70 hover:bg-white/5 hover:text-white disabled:opacity-50"
      >
        <RefreshCw size={16} className={isPending ? 'animate-spin' : ''} />
      </button>
    )
  }

  const styles =
    variant === 'dark'
      ? 'border-white/20 text-brand-100/70 hover:bg-white/5 hover:text-white'
      : 'border-gray-300 text-gray-600 hover:bg-gray-50'

  return (
    <button
      type="button"
      onClick={handleRefresh}
      disabled={isPending}
      title="Atualizar dados desta página"
      className={`flex w-full items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium disabled:opacity-50 ${styles}`}
    >
      <RefreshCw size={13} className={isPending ? 'animate-spin' : ''} />
      {isPending ? 'Atualizando...' : 'Atualizar'}
    </button>
  )
}
