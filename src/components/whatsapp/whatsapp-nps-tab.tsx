'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

// A tabela whatsapp_conversation_status usa chave composta (phone, instance_name).
// NÃO há coluna id — usamos phone como identificador único nas listas.
interface NpsEntry {
  phone: string
  instance_name: string
  nps_score: number
  nps_feedback?: string | null
  protocol_number?: string | null
  department?: string | null
  archived_at?: string | null
  updated_at?: string | null
}

interface NpsSummary {
  total: number
  average: number
  npsScore: number
  promoters: number
  passives: number
  detractors: number
  byScore: Record<number, number>
}

function classifyScore(score: number): 'promoter' | 'passive' | 'detractor' {
  if (score >= 4) return 'promoter'
  if (score === 3) return 'passive'
  return 'detractor'
}

function ScoreBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-500 w-24 shrink-0">{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-2.5 overflow-hidden">
        <div className="h-2.5 rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-xs font-medium text-gray-700 w-16 text-right">{count} ({pct}%)</span>
    </div>
  )
}

function StarDisplay({ score }: { score: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <span key={i} className={`text-base ${i <= score ? 'text-amber-400' : 'text-gray-200'}`}>★</span>
      ))}
    </div>
  )
}

export function WhatsAppNpsTab() {
  const [entries, setEntries] = useState<NpsEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterScore, setFilterScore] = useState<number | 'all'>('all')
  const [filterDept, setFilterDept] = useState<string>('all')
  const [search, setSearch] = useState('')

  const supabase = createClient()

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Sem 'id' no select — a tabela usa (phone, instance_name) como PK composta
      const { data, error: err } = await supabase
        .from('whatsapp_conversation_status')
        .select('phone, instance_name, nps_score, nps_feedback, protocol_number, department, archived_at, updated_at')
        .not('nps_score', 'is', null)
        .order('archived_at', { ascending: false })

      if (err) throw err
      setEntries((data ?? []) as NpsEntry[])
    } catch (e: any) {
      setError(e?.message ?? 'Erro ao carregar dados de NPS.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const departments = ['all', ...Array.from(new Set(entries.map(e => e.department).filter(Boolean) as string[]))]

  const filtered = entries.filter(e => {
    if (filterScore !== 'all' && e.nps_score !== filterScore) return false
    if (filterDept !== 'all' && e.department !== filterDept) return false
    if (search) {
      const s = search.toLowerCase()
      return (
        e.phone.includes(s) ||
        (e.protocol_number ?? '').toLowerCase().includes(s) ||
        (e.department ?? '').toLowerCase().includes(s) ||
        (e.nps_feedback ?? '').toLowerCase().includes(s)
      )
    }
    return true
  })

  const summary: NpsSummary = (() => {
    const scores = entries.map(e => e.nps_score)
    const total = scores.length
    if (total === 0) return { total: 0, average: 0, npsScore: 0, promoters: 0, passives: 0, detractors: 0, byScore: {} }
    const promoters = scores.filter(s => s >= 4).length
    const passives = scores.filter(s => s === 3).length
    const detractors = scores.filter(s => s <= 2).length
    const average = Math.round((scores.reduce((a, b) => a + b, 0) / total) * 10) / 10
    const npsScore = Math.round(((promoters - detractors) / total) * 100)
    const byScore: Record<number, number> = {}
    for (const s of scores) byScore[s] = (byScore[s] ?? 0) + 1
    return { total, average, npsScore, promoters, passives, detractors, byScore }
  })()

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1B556B] mx-auto mb-3" />
          <p className="text-sm text-gray-400">Carregando dados de NPS...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {error}
        <button onClick={load} className="ml-3 underline text-red-600 hover:text-red-800">Tentar novamente</button>
      </div>
    )
  }

  const npsColor = summary.npsScore >= 50 ? '#1a7c3e' : summary.npsScore >= 0 ? '#92400e' : '#b91c1c'

  return (
    <div className="space-y-5">
      {/* Cards de resumo */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total de avaliações', value: summary.total, sub: 'conversas encerradas com NPS', color: '#1B556B' },
          { label: 'Média das notas', value: summary.average || '—', sub: 'escala de 1 a 5', color: '#32AF9D' },
          { label: 'NPS Score', value: `${summary.npsScore}`, sub: summary.npsScore >= 50 ? '✓ Excelente' : summary.npsScore >= 0 ? '😐 Neutro' : '⚠️ Crítico', color: npsColor },
          { label: 'Promotores', value: summary.promoters, sub: `${summary.total > 0 ? Math.round((summary.promoters / summary.total) * 100) : 0}% do total`, color: '#1a7c3e' },
        ].map(k => (
          <div key={k.label} className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">{k.label}</p>
            <p className="text-xl font-bold" style={{ color: k.color }}>{k.value}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* Barras Promotores / Neutros / Detratores */}
      {summary.total > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
          <p className="text-sm font-medium text-gray-800 mb-2">Distribuição por categoria</p>
          <ScoreBar label="Promotores (4-5)" count={summary.promoters} total={summary.total} color="#1a7c3e" />
          <ScoreBar label="Neutros (3)" count={summary.passives} total={summary.total} color="#92400e" />
          <ScoreBar label="Detratores (1-2)" count={summary.detractors} total={summary.total} color="#b91c1c" />
        </div>
      )}

      {/* Distribuição por nota */}
      {summary.total > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-sm font-medium text-gray-800 mb-3">Distribuição por nota</p>
          <div className="grid grid-cols-5 gap-2">
            {[5, 4, 3, 2, 1].map(score => {
              const count = summary.byScore[score] ?? 0
              const pct = summary.total > 0 ? Math.round((count / summary.total) * 100) : 0
              const cat = classifyScore(score)
              const catColor = cat === 'promoter' ? '#1a7c3e' : cat === 'passive' ? '#92400e' : '#b91c1c'
              const catBg = cat === 'promoter' ? '#eaf5ee' : cat === 'passive' ? '#fff8e6' : '#fdecea'
              return (
                <div key={score} className="rounded-lg border border-gray-100 p-3 text-center" style={{ background: catBg }}>
                  <p className="text-lg font-bold" style={{ color: catColor }}>{score}</p>
                  <div className="flex justify-center my-1">
                    <StarDisplay score={score} />
                  </div>
                  <p className="text-sm font-semibold text-gray-700">{count}</p>
                  <p className="text-[10px] text-gray-400">{pct}%</p>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Filtros + tabela */}
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-gray-900 flex-1">Respostas individuais</p>

          {/* Filtro por nota */}
          <div className="flex gap-1 flex-wrap">
            {(['all', 5, 4, 3, 2, 1] as const).map(s => (
              <button
                key={s}
                onClick={() => setFilterScore(s)}
                className={`rounded-full px-2.5 py-0.5 text-xs border transition-colors ${
                  filterScore === s ? 'bg-[#1B556B] border-[#1B556B] text-white' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-400'
                }`}
              >
                {s === 'all' ? 'Todas' : `★ ${s}`}
              </button>
            ))}
          </div>

          {/* Filtro por departamento */}
          {departments.length > 1 && (
            <select
              value={filterDept}
              onChange={e => setFilterDept(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1 text-gray-600 bg-white"
            >
              {departments.map(d => (
                <option key={d} value={d}>{d === 'all' ? 'Todos os depts.' : d}</option>
              ))}
            </select>
          )}

          {/* Busca */}
          <input
            type="text"
            placeholder="Buscar por telefone, protocolo..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="text-xs border border-gray-200 rounded-lg px-2.5 py-1 text-gray-600 bg-white w-48 focus:outline-none focus:border-[#1B556B]"
          />
        </div>

        <div className="px-4 pb-2">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">Nenhuma avaliação encontrada.</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {filtered.map(entry => {
                // Chave única: combinação de phone + instance_name (sem coluna id)
                const entryKey = `${entry.phone}__${entry.instance_name}`
                const cat = classifyScore(entry.nps_score)
                const catLabel = cat === 'promoter' ? 'Promotor' : cat === 'passive' ? 'Neutro' : 'Detrator'
                const catColor = cat === 'promoter' ? '#1a7c3e' : cat === 'passive' ? '#92400e' : '#b91c1c'
                const catBg = cat === 'promoter' ? '#eaf5ee' : cat === 'passive' ? '#fff8e6' : '#fdecea'
                const date = entry.archived_at
                  ? new Date(entry.archived_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                  : '—'

                return (
                  <div key={entryKey} className="py-3">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-gray-900">{entry.phone}</span>
                          <span
                            className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                            style={{ background: catBg, color: catColor }}
                          >
                            {catLabel} — Nota {entry.nps_score}
                          </span>
                          {entry.department && (
                            <span className="rounded-full px-2 py-0.5 text-[10px] bg-blue-50 text-blue-700 font-medium">
                              {entry.department}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {entry.protocol_number ? `Protocolo ${entry.protocol_number} · ` : ''}{date}
                        </p>
                      </div>
                      <StarDisplay score={entry.nps_score} />
                    </div>
                    {entry.nps_feedback && (
                      <p className="mt-1.5 text-sm text-gray-600 italic border-l-2 border-gray-200 pl-2">
                        &ldquo;{entry.nps_feedback}&rdquo;
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="px-4 py-2 border-t border-gray-100 text-xs text-gray-400">
          {filtered.length} de {entries.length} avaliações
          <button onClick={load} className="ml-3 text-[#1B556B] hover:underline">↻ Atualizar</button>
        </div>
      </div>
    </div>
  )
}
