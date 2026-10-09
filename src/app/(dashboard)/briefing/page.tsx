/**
 * Copiloto Estratégico — Página de Briefing
 *
 * Server Component: chama a API /api/agent/briefing internamente
 * (o CRON_SECRET nunca é exposto ao browser).
 *
 * Acesso: /briefing  (dentro do layout autenticado do dashboard)
 */

import { Suspense } from 'react'
import { headers } from 'next/headers'
import { BriefingClient } from './briefing-client'

// ─── Tipos que espelham o JSON retornado pela rota ────────────────────────────
type BriefingStats = {
  dormantOpportunities: number
  renewalCandidates:    number
  staleLeads:           number
  tokensInput:          number
  tokensOutput:         number
}

type WhatsAppResult =
  | { sent: true;  statusCode: number }
  | { sent: false; error: string }

type BriefingResponse = {
  ok:          boolean
  generatedAt: string
  stats:       BriefingStats
  briefing:    string
  whatsapp:    WhatsAppResult
  error?:      string
}

// ─── Fetch do servidor — o secret fica apenas no servidor ─────────────────────
async function fetchBriefing(): Promise<BriefingResponse | null> {
  try {
    const secret = process.env.CRON_SECRET ?? ''
    const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
      ? process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'http://localhost:3000'
      : 'http://localhost:3000'

    const res = await fetch(
      `${baseUrl}/api/agent/briefing${secret ? `?cron_secret=${secret}` : ''}`,
      {
        cache:   'no-store',
        headers: { 'x-cron-secret': secret },
      }
    )

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return { ok: false, generatedAt: new Date().toISOString(), stats: { dormantOpportunities: 0, renewalCandidates: 0, staleLeads: 0, tokensInput: 0, tokensOutput: 0 }, briefing: '', whatsapp: { sent: false, error: '' }, error: err?.error ?? `HTTP ${res.status}` }
    }

    return res.json()
  } catch (e) {
    return null
  }
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────
function BriefingSkeleton() {
  return (
    <div className="flex flex-col gap-5 animate-pulse">
      {/* Header skeleton */}
      <div className="h-9 w-72 rounded-2xl bg-gray-200" />
      <div className="h-4 w-96 rounded-xl bg-gray-100" />
      {/* KPI skeleton */}
      <div className="grid grid-cols-3 gap-4 mt-2">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-28 rounded-2xl bg-gray-100" />
        ))}
      </div>
      {/* Briefing body skeleton */}
      <div className="h-64 rounded-2xl bg-gray-100 mt-2" />
    </div>
  )
}

// ─── Componente que carrega dados e renderiza ─────────────────────────────────
async function BriefingContent() {
  const data = await fetchBriefing()
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
