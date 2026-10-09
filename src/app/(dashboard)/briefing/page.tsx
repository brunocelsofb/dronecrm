/**
 * Copiloto Estratégico — Página de Briefing
 *
 * Server Component: chama generateBriefing() DIRECTAMENTE (sem fetch HTTP).
 * Fetch HTTP com URL relativa falha no SSR da Vercel — por isso importamos
 * a lógica de negócio directamente de src/lib/agent/briefing-core.ts.
 *
 * O CRON_SECRET e ANTHROPIC_API_KEY nunca são expostos ao browser.
 */

import { Suspense } from 'react'
import { generateBriefing, type BriefingResult, type BriefingError } from '@/lib/agent/briefing-core'
import { BriefingClient } from './briefing-client'

// ─── Loading skeleton ─────────────────────────────────────────────────────────
function BriefingSkeleton() {
  return (
    <div className="flex flex-col gap-5 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-2">
          <div className="h-8 w-64 rounded-2xl bg-gray-200" />
          <div className="h-4 w-80 rounded-xl bg-gray-100" />
        </div>
        <div className="h-10 w-32 rounded-2xl bg-gray-200" />
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="h-28 rounded-2xl bg-gray-100" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="h-40 rounded-2xl bg-gray-100" />
        ))}
      </div>
    </div>
  )
}

// ─── Server Component que executa a lógica ───────────────────────────────────
// sendViaWhatsApp: false na visualização — o utilizador só envia pelo cron.
async function BriefingContent() {
  let data: BriefingResult | BriefingError

  try {
    data = await generateBriefing({ sendViaWhatsApp: false })
  } catch (err) {
    // Serializa o erro completo — incluindo campos da Anthropic SDK
    let msg: string
    if (err instanceof Error) {
      const e = err as Error & { status?: number; error?: { message?: string } }
      const parts = [`${e.constructor?.name ?? 'Error'}: ${e.message}`]
      if (e.status)          parts.push(`HTTP ${e.status}`)
      if (e.error?.message)  parts.push(`api: ${e.error.message}`)
      msg = parts.join(' | ')
    } else {
      try { msg = JSON.stringify(err) } catch { msg = String(err) }
    }
    console.error('[briefing page] erro inesperado no Server Component:', err)
    data = { ok: false, error: `Erro inesperado: ${msg}` }
  }

  return <BriefingClient data={data} />
}

// ─── Page export ──────────────────────────────────────────────────────────────
export default function BriefingPage() {
  return (
    <Suspense fallback={<BriefingSkeleton />}>
      <BriefingContent />
    </Suspense>
  )
}
