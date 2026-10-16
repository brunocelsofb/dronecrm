/**
 * Agentes IA — Farmer (carteira) e Hunter (novos negócios), lado a lado.
 * Mostra dados de clientes direto do banco (sem chamar a IA ao abrir a tela).
 * O resumo do dia continua indo por WhatsApp pelo cron (/api/agent/briefing).
 */

import { Suspense } from 'react'
import { resolveTenantId } from '@/lib/tenant/context'
import { loadAgentsBoard } from '@/lib/agent/agents-board'
import { AgentsBoardView } from '@/components/agents/agents-board-view'

export const dynamic = 'force-dynamic'

function BoardSkeleton() {
  return (
    <div className="mx-auto flex max-w-7xl animate-pulse flex-col gap-5">
      <div className="h-10 w-72 rounded-xl bg-gray-200" />
      <div className="grid gap-5 lg:grid-cols-2">
        {[0, 1].map(c => (
          <div key={c} className="flex flex-col gap-4">
            <div className="h-28 rounded-2xl bg-gray-200" />
            {[1, 2, 3].map(i => <div key={i} className="h-40 rounded-2xl bg-gray-100" />)}
          </div>
        ))}
      </div>
    </div>
  )
}

async function Board() {
  try {
    const board = await loadAgentsBoard(await resolveTenantId())
    return <AgentsBoardView board={board} />
  } catch (err) {
    console.error('[agentes] erro ao montar a tela:', err)
    return (
      <div className="rounded-2xl border border-negative-100 bg-negative-100 p-5 text-sm text-negative-700">
        Não foi possível carregar os dados dos agentes agora. Tente atualizar a página.
      </div>
    )
  }
}

export default function BriefingPage() {
  return (
    <Suspense fallback={<BoardSkeleton />}>
      <Board />
    </Suspense>
  )
}
