'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

interface NpsEntry {
  phone: string
  instance_name: string | null
  nps_score: number
  protocol_number: string | null
  archived_at: string | null
  department: string | null
}

interface NpsSummary {
  promotores: number   // scores 5
  neutros: number      // scores 3-4
  detratores: number   // scores 1-2
  total: number
  media: number
  entries: NpsEntry[]
}

function classifyScore(score: number): 'promotor' | 'neutro' | 'detrator' {
  if (score === 5) return 'promotor'
  if (score >= 3) return 'neutro'
  return 'detrator'
}

function ScoreBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 text-sm font-medium text-gray-700 shrink-0">{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
        <div
          className={`h-4 rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-12 text-right text-sm text-gray-600 shrink-0">{count} ({pct}%)</span>
    </div>
  )
}

function StarDisplay({ score }: { score: number }) {
  return (
    <span className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <span key={i} className={i <= score ? 'text-yellow-400' : 'text-gray-200'}>★</span>
      ))}
    </span>
  )
}

export function WhatsAppNpsTab() {
  const [summary, setSummary] = useState<NpsSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterDept, setFilterDept] = useState<string>('all')
  const [filterScore, setFilterScore] = useState<string>('all')

  const loadNps = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const supabase = createClient()
      const { data, error: dbError } = await supabase
        .from('whatsapp_conversation_status')
        .select('phone, instance_name, nps_score, protocol_number, archived_at, department')
        .not('nps_score', 'is', null)
        .order('archived_at', { ascending: false })

      if (dbError) throw dbError

      const entries: NpsEntry[] = (data ?? []).filter(r => r.nps_score !== null)

      const promotores = entries.filter(e => e.nps_score === 5).length
      const neutros = entries.filter(e => e.nps_score >= 3 && e.nps_score <= 4).length
      const detratores = entries.filter(e => e.nps_score <= 2).length
      const total = entries.length
      const media = total > 0 ? entries.reduce((acc, e) => acc + e.nps_score, 0) / total : 0

      setSummary({ promotores, neutros, detratores, total, media, entries })
    } catch (e: any) {
      setError(e?.message ?? 'Erro ao carregar NPS')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadNps() }, [loadNps])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-700 border-t-transparent" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Erro ao carregar NPS: {error}
        <button onClick={loadNps} className="ml-3 underline">Tentar novamente</button>
      </div>
    )
  }

  if (!summary || summary.total === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-400">
        <span className="text-4xl mb-3">📊</span>
        <p className="text-sm">Nenhuma avaliação NPS recebida ainda.</p>
        <p className="text-xs mt-1">As avaliações aparecem aqui após finalizar atendimentos com NPS habilitado.</p>
      </div>
    )
  }

  // Departamentos únicos para filtro
  const depts = Array.from(new Set(summary.entries.map(e => e.department).filter(Boolean) as string[])).sort()

  // Filtra entradas
  const filteredEntries = summary.entries.filter(e => {
    if (filterDept !== 'all' && e.department?.toLowerCase() !== filterDept.toLowerCase()) return false
    if (filterScore !== 'all') {
      const cls = classifyScore(e.nps_score)
      if (filterScore !== cls) return false
    }
    return true
  })

  const npsScore = summary.total > 0
    ? Math.round(((summary.promotores - summary.detratores) / summary.total) * 100)
    : 0

  return (
    <div className="space-y-6">
      {/* Cards de resumo */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-gray-200 bg-white p-4 text-center shadow-sm">
          <p className="text-2xl font-bold text-gray-900">{summary.total}</p>
          <p className="text-xs text-gray-500 mt-1">Total de avaliações</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 text-center shadow-sm">
          <p className="text-2xl font-bold text-gray-900">{summary.media.toFixed(1)}</p>
          <p className="text-xs text-gray-500 mt-1">Nota média</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 text-center shadow-sm">
          <p className={`text-2xl font-bold ${npsScore >= 50 ? 'text-green-600' : npsScore >= 0 ? 'text-yellow-600' : 'text-red-600'}`}>
            {npsScore > 0 ? '+' : ''}{npsScore}
          </p>
          <p className="text-xs text-gray-500 mt-1">NPS Score</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 text-center shadow-sm">
          <p className="text-2xl font-bold text-green-600">{summary.promotores}</p>
          <p className="text-xs text-gray-500 mt-1">Promotores (★5)</p>
        </div>
      </div>

      {/* Gráfico de barras */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Distribuição de Avaliações</h3>
        <div className="space-y-3">
          <ScoreBar label="🟢 Promotores" count={summary.promotores} total={summary.total} color="bg-green-400" />
          <ScoreBar label="🟡 Neutros" count={summary.neutros} total={summary.total} color="bg-yellow-400" />
          <ScoreBar label="🔴 Detratores" count={summary.detratores} total={summary.total} color="bg-red-400" />
        </div>

        {/* Escala de notas individuais */}
        <div className="mt-5 border-t pt-4">
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Por nota</h4>
          <div className="space-y-2">
            {[5, 4, 3, 2, 1].map(score => {
              const count = summary.entries.filter(e => e.nps_score === score).length
              const pct = summary.total > 0 ? Math.round((count / summary.total) * 100) : 0
              const color = score === 5 ? 'bg-green-400' : score >= 3 ? 'bg-yellow-400' : 'bg-red-400'
              return (
                <div key={score} className="flex items-center gap-2 text-xs">
                  <span className="w-6 text-right text-gray-500 font-mono">{score}★</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div className={`h-3 rounded-full ${color}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-20 text-right text-gray-500">{count} ({pct}%)</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Tabela de respostas individuais */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <h3 className="text-sm font-semibold text-gray-700">Respostas Individuais</h3>
          <div className="flex items-center gap-2">
            {depts.length > 0 && (
              <select
                value={filterDept}
                onChange={e => setFilterDept(e.target.value)}
                className="rounded border border-gray-300 px-2 py-1 text-xs focus:border-brand-700 focus:outline-none"
              >
                <option value="all">Todos os setores</option>
                {depts.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            )}
            <select
              value={filterScore}
              onChange={e => setFilterScore(e.target.value)}
              className="rounded border border-gray-300 px-2 py-1 text-xs focus:border-brand-700 focus:outline-none"
            >
              <option value="all">Todos</option>
              <option value="promotor">🟢 Promotores</option>
              <option value="neutro">🟡 Neutros</option>
              <option value="detrator">🔴 Detratores</option>
            </select>
            <button
              onClick={loadNps}
              className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
              title="Atualizar"
            >
              ↻ Atualizar
            </button>
          </div>
        </div>

        {filteredEntries.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">Nenhuma resposta para os filtros selecionados.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-500 uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-2.5 text-left font-semibold">Telefone</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Protocolo</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Setor</th>
                  <th className="px-4 py-2.5 text-center font-semibold">Nota</th>
                  <th className="px-4 py-2.5 text-center font-semibold">Categoria</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Data</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredEntries.map((entry, idx) => {
                  const cls = classifyScore(entry.nps_score)
                  const clsBadge = cls === 'promotor'
                    ? 'bg-green-100 text-green-700'
                    : cls === 'neutro'
                    ? 'bg-yellow-100 text-yellow-700'
                    : 'bg-red-100 text-red-700'
                  const clsLabel = cls === 'promotor' ? '🟢 Promotor' : cls === 'neutro' ? '🟡 Neutro' : '🔴 Detrator'
                  const dateStr = entry.archived_at
                    ? new Date(entry.archived_at).toLocaleDateString('pt-BR', {
                        day: '2-digit', month: '2-digit', year: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })
                    : '—'

                  return (
                    <tr key={idx} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-2.5 font-mono text-gray-700">{entry.phone}</td>
                      <td className="px-4 py-2.5 text-gray-500">
                        {entry.protocol_number ? `#${entry.protocol_number}` : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-gray-600">{entry.department ?? '—'}</td>
                      <td className="px-4 py-2.5 text-center">
                        <StarDisplay score={entry.nps_score} />
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${clsBadge}`}>
                          {clsLabel}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-gray-400">{dateStr}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
