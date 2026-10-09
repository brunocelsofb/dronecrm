'use client'

/**
 * BriefingClient — Client Component
 * Recebe os dados do Server Component e renderiza o dashboard do Copiloto.
 * O botão "Gerar Agora" faz reload do Server Component via router.refresh().
 */

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  RefreshCw,
  AlertTriangle,
  Clock,
  TrendingUp,
  Users,
  CheckCircle2,
  XCircle,
  MessageSquare,
  Zap,
  BarChart3,
  Calendar,
} from 'lucide-react'

// ─── Tipos (espelham os da page.tsx) ─────────────────────────────────────────
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
} | null

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(iso: string) {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'long',
      timeStyle: 'short',
      timeZone: 'America/Sao_Paulo',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

// Converte o texto do briefing (4 seções com emoji) em parágrafos estruturados
function parseBriefing(text: string): { icon: string; title: string; body: string }[] {
  const sectionMarkers = [
    { emoji: '🚨', title: 'TOP 3 AÇÕES URGENTES' },
    { emoji: '💰', title: 'MAIOR OPORTUNIDADE DA SEMANA' },
    { emoji: '⚠️', title: 'SINAL DE ALERTA' },
    { emoji: '📊', title: 'SAÚDE DO PIPELINE' },
  ]

  const sections: { icon: string; title: string; body: string }[] = []

  // Divide por linhas que começam com um dos emojis conhecidos
  const lines = text.split('\n')
  let current: { icon: string; title: string; lines: string[] } | null = null

  for (const line of lines) {
    const marker = sectionMarkers.find(m => line.includes(m.emoji))
    if (marker) {
      if (current) sections.push({ icon: current.icon, title: current.title, body: current.lines.join('\n').trim() })
      current = { icon: marker.emoji, title: marker.title, lines: [] }
    } else if (current) {
      current.lines.push(line)
    }
  }
  if (current) sections.push({ icon: current.icon, title: current.title, body: current.lines.join('\n').trim() })

  // Se o parser não encontrou secções (formato diferente), devolve o texto inteiro
  if (sections.length === 0) {
    return [{ icon: '📋', title: 'Briefing Completo', body: text }]
  }
  return sections
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ElementType
  label: string
  value: number | string
  sub?: string
  accent: string
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-white border border-gray-100 shadow-sm p-5 flex flex-col gap-3">
      <div
        className="flex h-10 w-10 items-center justify-center rounded-xl"
        style={{ background: accent + '18' }}
      >
        <Icon size={20} style={{ color: accent }} strokeWidth={1.75} />
      </div>
      <div>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
        <p className="text-sm font-medium text-gray-700 mt-0.5">{label}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
      <div
        className="absolute bottom-0 right-0 h-20 w-20 rounded-full opacity-5"
        style={{ background: accent, transform: 'translate(25%, 25%)' }}
      />
    </div>
  )
}

// ─── Section Card ─────────────────────────────────────────────────────────────
function SectionCard({
  icon,
  title,
  body,
  accentColor,
}: {
  icon: string
  title: string
  body: string
  accentColor: string
}) {
  // Divide por parágrafos não-vazios
  const paragraphs = body.split('\n').filter(l => l.trim().length > 0)

  return (
    <div className="rounded-2xl bg-white border border-gray-100 shadow-sm overflow-hidden">
      <div
        className="flex items-center gap-3 px-5 py-3.5 border-b border-gray-100"
        style={{ background: accentColor + '08' }}
      >
        <span className="text-xl leading-none">{icon}</span>
        <h3 className="text-sm font-semibold tracking-wide" style={{ color: accentColor }}>
          {title}
        </h3>
      </div>
      <div className="px-5 py-4 flex flex-col gap-2">
        {paragraphs.map((p, i) => (
          <p key={i} className="text-sm text-gray-700 leading-relaxed">
            {p}
          </p>
        ))}
        {paragraphs.length === 0 && (
          <p className="text-sm text-gray-400 italic">Sem informações para esta secção.</p>
        )}
      </div>
    </div>
  )
}

const SECTION_COLORS = ['#1B556B', '#E98C5F', '#524E9C', '#32AF9D']

// ─── Main Client Component ────────────────────────────────────────────────────
export function BriefingClient({ data }: { data: BriefingResponse }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleRefresh() {
    setLoading(true)
    router.refresh()
    // Dá tempo ao Server Component de re-executar
    await new Promise(r => setTimeout(r, 3000))
    setLoading(false)
  }

  // ─── Estado de erro / sem dados ────────────────────────────────────────────
  if (!data || !data.ok) {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#1B556B]">Copiloto Estratégico</h1>
            <p className="text-sm text-gray-500 mt-1">Análise inteligente do teu CRM</p>
          </div>
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="flex items-center gap-2 rounded-2xl bg-[#1B556B] px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-[#174a5c] disabled:opacity-60 transition-colors"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            {loading ? 'A gerar...' : 'Gerar Agora'}
          </button>
        </div>
        <div className="rounded-2xl border border-red-100 bg-red-50 px-5 py-4 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-red-700">Não foi possível carregar o briefing</p>
            <p className="text-xs text-red-500 mt-1">
              {data?.error ?? 'Erro ao conectar com a API. Verifica as variáveis de ambiente no Vercel.'}
            </p>
          </div>
        </div>
      </div>
    )
  }

  const { stats, briefing, whatsapp, generatedAt } = data
  const sections = parseBriefing(briefing)

  return (
    <div className="flex flex-col gap-6">
      {/* ─── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1B556B]">Copiloto Estratégico</h1>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-gray-400">
            <span className="flex items-center gap-1">
              <Clock size={12} />
              Gerado em {fmt(generatedAt)}
            </span>
            <span className="flex items-center gap-1">
              <Zap size={12} />
              {stats.tokensInput + stats.tokensOutput} tokens
            </span>
            {/* Status WhatsApp */}
            {whatsapp.sent ? (
              <span className="flex items-center gap-1 text-[#32AF9D]">
                <CheckCircle2 size={12} />
                WhatsApp enviado
              </span>
            ) : (
              <span className="flex items-center gap-1 text-gray-300">
                <MessageSquare size={12} />
                WhatsApp não configurado
              </span>
            )}
          </div>
        </div>
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="mt-3 sm:mt-0 flex items-center gap-2 self-start rounded-2xl bg-[#1B556B] px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-[#174a5c] disabled:opacity-60 transition-colors"
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          {loading ? 'A gerar...' : 'Gerar Agora'}
        </button>
      </div>

      {/* ─── KPI Cards ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard
          icon={TrendingUp}
          label="Oportunidades Dormentes"
          value={stats.dormantOpportunities}
          sub="sem actividade ≥ 14 dias"
          accent="#E98C5F"
        />
        <KpiCard
          icon={Calendar}
          label="Contratos a Renovar"
          value={stats.renewalCandidates}
          sub="vencem em 90 dias"
          accent="#1B556B"
        />
        <KpiCard
          icon={Users}
          label="Leads Estagnados"
          value={stats.staleLeads}
          sub="sem evolução ≥ 30 dias"
          accent="#524E9C"
        />
        <KpiCard
          icon={BarChart3}
          label="Em Risco Total"
          value={stats.dormantOpportunities + stats.renewalCandidates + stats.staleLeads}
          sub="oportunidades + renovações + leads"
          accent="#32AF9D"
        />
      </div>

      {/* ─── Briefing sections ───────────────────────────────────────────────── */}
      {sections.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {sections.map((s, i) => (
            <SectionCard
              key={i}
              icon={s.icon}
              title={s.title}
              body={s.body}
              accentColor={SECTION_COLORS[i % SECTION_COLORS.length]}
            />
          ))}
        </div>
      )}

      {/* ─── Raw briefing (fallback / detalhes) ─────────────────────────────── */}
      <details className="group rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        <summary className="flex cursor-pointer items-center gap-2 px-5 py-3.5 text-sm font-medium text-gray-500 hover:text-gray-700 select-none list-none [&::-webkit-details-marker]:hidden">
          <span className="flex-1">Ver briefing completo (texto bruto)</span>
          <span className="text-xs text-gray-300 group-open:hidden">▼</span>
          <span className="text-xs text-gray-300 hidden group-open:inline">▲</span>
        </summary>
        <div className="border-t border-gray-100 px-5 py-4">
          <pre className="whitespace-pre-wrap text-xs text-gray-600 leading-relaxed font-mono">
            {briefing}
          </pre>
        </div>
      </details>

      {/* ─── WhatsApp error detail (se falhou) ──────────────────────────────── */}
      {!whatsapp.sent && 'error' in whatsapp && whatsapp.error && (
        <div className="rounded-2xl border border-amber-100 bg-amber-50 px-5 py-4 flex items-start gap-3">
          <XCircle size={16} className="text-amber-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-semibold text-amber-700">WhatsApp não enviado</p>
            <p className="text-xs text-amber-600 mt-0.5">{whatsapp.error}</p>
          </div>
        </div>
      )}
    </div>
  )
}
