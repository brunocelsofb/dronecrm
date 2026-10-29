'use client'

// Tela de erro que se recupera: arquivo de uma versão antiga (depois de uma publicação)
// recarrega a página sozinho uma vez; outros erros mostram a mensagem e os botões.
import { useEffect } from 'react'

const KEY = 'drone-recarregou'
const isStale = (e: Error) => /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed|Failed to load chunk/i.test(`${e?.name} ${e?.message}`)

export function RecoverError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const stale = isStale(error)
  useEffect(() => {
    if (!stale) return
    try {
      const last = Number(sessionStorage.getItem(KEY) ?? 0)
      if (Date.now() - last > 30_000) { sessionStorage.setItem(KEY, String(Date.now())); window.location.reload() }
    } catch { window.location.reload() }
  }, [stale])
  return (
    <div className="mx-auto mt-16 max-w-md rounded-xl border border-gray-200 bg-white p-8 text-center">
      <p className="text-base font-semibold text-gray-900">{stale ? 'O Drone foi atualizado' : 'Não conseguimos abrir esta tela'}</p>
      <p className="mt-2 text-sm text-gray-500">{stale ? 'Recarregando a página com a versão nova…' : 'Tente de novo. Se continuar, recarregue a página.'}</p>
      <div className="mt-4 flex justify-center gap-2">
        {!stale && <button type="button" onClick={() => reset()} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700">Tentar de novo</button>}
        <button type="button" onClick={() => window.location.reload()} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white">Recarregar</button>
      </div>
      {error?.digest && <p className="mt-3 text-[11px] text-gray-400">Código: {error.digest}</p>}
    </div>
  )
}
