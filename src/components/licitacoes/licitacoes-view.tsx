'use client'
// Tela de Licitações (PNCP): Radar (o que bateu, com decisão e análise do agente) e Monitoramentos.

import { useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ExternalLink, Sparkles, Search, Plus, Trash2, Clock } from 'lucide-react'
import { fmtBRL } from '@/lib/format'
import { UFS } from '@/lib/geo/uf'
import { MODALIDADES, STATUS_LABEL, pncpUrl, type MatchStatus, type PncpRow } from '@/lib/pncp/catalog'
import {
  saveWatcher, deleteWatcher, searchNow, setMatchStatus, assignMatch, analyzeMatch, convertMatch, type WatcherInput,
} from '@/lib/actions/licitacoes'
import { SearchTab, DetailDrawer } from './search-tab'
import { IntelTab } from './intel-tab'

export type MatchView = {
  id: string; numero_controle: string; watcher_ids: string[]; status: MatchStatus; assigned_to: string | null
  contract_id: string | null; ai_score: number | null; ai_summary: string | null; ai_at: string | null; note: string | null
  created_at: string; row: PncpRow
}
export type WatcherView = Omit<WatcherInput, 'keywords' | 'exclude'> & { id: string; keywords: string[]; exclude: string[]; last_run_at: string | null }
type Opt = { id: string; name: string }

const FILTERS: { key: 'abertas' | MatchStatus | 'todas'; label: string }[] = [
  { key: 'abertas', label: 'Para decidir' }, { key: 'participar', label: 'Vamos participar' }, { key: 'oportunidade', label: 'Viraram oportunidade' },
  { key: 'descartada', label: 'Descartadas' }, { key: 'todas', label: 'Todas' },
]
const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-700 focus:outline-none'

function daysLeft(iso: string | null, nowMs: number): number | null {
  return iso ? Math.ceil((Date.parse(iso) - nowMs) / 86_400_000) : null
}

function Deadline({ iso, nowMs }: { iso: string | null; nowMs: number }) {
  const d = daysLeft(iso, nowMs)
  if (d === null) return <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">sem prazo informado</span>
  const date = new Date(iso!).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  if (d < 0) return <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500">encerrada em {date}</span>
  const tone = d <= 3 ? 'bg-negative-100 text-negative-700' : d <= 7 ? 'bg-warn-100 text-warn-700' : 'bg-positive-100 text-positive-700'
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}><Clock className="h-3 w-3" />{d === 0 ? 'encerra hoje' : `encerra em ${d} ${d === 1 ? 'dia' : 'dias'}`} · {date}</span>
}

function Score({ v }: { v: number }) {
  const tone = v >= 70 ? 'bg-positive-100 text-positive-700' : v >= 40 ? 'bg-warn-100 text-warn-700' : 'bg-gray-100 text-gray-600'
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`} title="Aderência ao que a empresa vende, na análise do agente"><Sparkles className="h-3 w-3" />{v}/100</span>
}

export function LicitacoesView({ isAdmin, matches, watchers, people, areas, pipelines, nowMs }: {
  isAdmin: boolean; matches: MatchView[]; watchers: WatcherView[]; people: Opt[]; areas: Opt[]; pipelines: Opt[]; nowMs: number
}) {
  const [tab, setTab] = useState<'pesquisar' | 'radar' | 'monitoramentos' | 'inteligencia'>('pesquisar')
  const [prefill, setPrefill] = useState<string | null>(null)
  const TABS = [
    { key: 'pesquisar' as const, label: 'Pesquisar' },
    { key: 'radar' as const, label: `Meus alertas (${matches.filter(m => m.status === 'nova' || m.status === 'analisando').length})` },
    { key: 'monitoramentos' as const, label: `Monitoramentos (${watchers.length})` },
    { key: 'inteligencia' as const, label: 'Inteligência' },
  ]
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Licitações</h1>
        <p className="text-sm text-gray-500">Contratações públicas abertas do PNCP. Pesquise, abra o edital, peça a análise do agente e coloque no funil.</p>
      </div>
      <nav className="flex gap-1 border-b border-gray-200" aria-label="Seções">
        {TABS.map(t => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)} aria-current={tab === t.key ? 'page' : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === t.key ? 'border-brand-700 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
            {t.label}
          </button>
        ))}
      </nav>
      {tab === 'pesquisar' && <SearchTab isAdmin={isAdmin} pipelines={pipelines} nowMs={nowMs} onCreateAlert={q => { setPrefill(q); setTab('monitoramentos') }} />}
      {tab === 'radar' && <Radar matches={matches} watchers={watchers} people={people} pipelines={pipelines} nowMs={nowMs} onSetup={() => setTab('monitoramentos')} />}
      {tab === 'inteligencia' && <IntelTab isAdmin={isAdmin} people={people} pipelines={pipelines} nowMs={nowMs} />}
      {tab === 'monitoramentos' && <Watchers isAdmin={isAdmin} watchers={watchers} people={people} areas={areas} prefill={prefill} onPrefillUsed={() => setPrefill(null)} />}
    </div>
  )
}

// ── Radar ────────────────────────────────────────────────────────────────────
function Radar({ matches, watchers, people, pipelines, nowMs, onSetup }: { matches: MatchView[]; watchers: WatcherView[]; people: Opt[]; pipelines: Opt[]; nowMs: number; onSetup: () => void }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('abertas')
  const [q, setQ] = useState('')
  const [uf, setUf] = useState('')
  const wName = useMemo(() => new Map(watchers.map(w => [w.id, w.name])), [watchers])
  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    return matches
      .filter(m => filter === 'todas' ? true : filter === 'abertas' ? (m.status === 'nova' || m.status === 'analisando') : m.status === filter)
      .filter(m => !uf || m.row.uf === uf)
      .filter(m => !t || `${m.row.objeto ?? ''} ${m.row.orgao_nome ?? ''} ${m.row.municipio ?? ''}`.toLowerCase().includes(t))
      .sort((a, b) => {
        const da = daysLeft(a.row.data_encerramento, nowMs), dbb = daysLeft(b.row.data_encerramento, nowMs)
        const ka = da === null || da < 0 ? 9999 : da, kb = dbb === null || dbb < 0 ? 9999 : dbb
        return ka - kb || (b.ai_score ?? -1) - (a.ai_score ?? -1)
      })
  }, [matches, filter, q, uf, nowMs])
  const ufsHere = [...new Set(matches.map(m => m.row.uf).filter((x): x is string => !!x))].sort()

  if (!watchers.length) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center">
        <p className="text-sm font-medium text-gray-800">Nenhum alerta ainda</p>
        <p className="mt-1 text-sm text-gray-500">Um monitoramento avisa sozinho, duas vezes por dia, quando sair licitação com as palavras que você escolher. Você também pode pesquisar na hora na aba Pesquisar.</p>
        <button type="button" onClick={onSetup} className="mt-3 rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800">Criar monitoramento</button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map(f => (
          <button key={f.key} type="button" onClick={() => setFilter(f.key)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${filter === f.key ? 'bg-brand-700 text-white' : 'bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50'}`}>
            {f.label} ({matches.filter(m => f.key === 'todas' ? true : f.key === 'abertas' ? (m.status === 'nova' || m.status === 'analisando') : m.status === f.key).length})
          </button>
        ))}
        <span className="ml-auto flex items-center gap-2">
          <select value={uf} onChange={e => setUf(e.target.value)} aria-label="Estado" className="rounded-lg border border-gray-300 px-2 py-1 text-xs">
            <option value="">Todos os estados</option>
            {ufsHere.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
          <span className="relative">
            <Search className="pointer-events-none absolute left-2 top-1.5 h-3.5 w-3.5 text-gray-400" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar no objeto ou órgão" aria-label="Buscar"
              className="w-56 rounded-lg border border-gray-300 py-1 pl-7 pr-2 text-xs focus:border-brand-700 focus:outline-none" />
          </span>
        </span>
      </div>
      {list.length === 0
        ? <p className="rounded-xl border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">Nada por aqui. As publicações chegam às 8h e às 17h; um administrador pode usar &quot;Buscar agora&quot; em Monitoramentos.</p>
        : <ul className="space-y-3">{list.map(m => <MatchCard key={m.id} m={m} wName={wName} people={people} pipelines={pipelines} nowMs={nowMs} />)}</ul>}
    </div>
  )
}

function MatchCard({ m, wName, people, pipelines, nowMs }: { m: MatchView; wName: Map<string, string>; people: Opt[]; pipelines: Opt[]; nowMs: number }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  const [more, setMore] = useState(false)
  const [pipe, setPipe] = useState(pipelines[0]?.id ?? '')
  const [detail, setDetail] = useState(false)
  const r = m.row
  const link = pncpUrl(r)
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) => start(async () => {
    setErr(null)
    const res = await fn()
    if (!res.ok) setErr(res.error ?? 'Não foi possível.')
    else router.refresh()
  })
  const long = (r.objeto ?? '').length > 260
  return (
    <li className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-gray-500">{r.orgao_nome ?? '—'} · {r.municipio ?? '—'}/{r.uf ?? '—'}</p>
          <p className="text-[11px] text-gray-400">{r.modalidade_nome ?? '—'}{r.srp ? ' · registro de preços' : ''} · monitoramento: {m.watcher_ids.map(id => wName.get(id) ?? 'removido').join(', ')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {m.ai_score !== null && <Score v={m.ai_score} />}
          <Deadline iso={r.data_encerramento} nowMs={nowMs} />
          {m.status !== 'nova' && <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-medium text-brand-700">{STATUS_LABEL[m.status]}</span>}
        </div>
      </div>
      <p className={`mt-2 text-sm text-gray-900 ${!more && long ? 'line-clamp-3' : ''}`}>{r.objeto ?? '—'}</p>
      {long && <button type="button" onClick={() => setMore(v => !v)} className="text-[11px] text-brand-700 hover:underline">{more ? 'mostrar menos' : 'ler tudo'}</button>}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
        <span>Valor estimado: <b className="tabular-nums text-gray-900">{r.valor_estimado && r.valor_estimado > 0 ? fmtBRL(r.valor_estimado) : 'não informado'}</b></span>
        <button type="button" onClick={() => setDetail(true)} className="font-medium text-brand-700 hover:underline">Itens e arquivos do edital</button>
        {link && <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-700 hover:underline">Ver no PNCP<ExternalLink className="h-3 w-3" /></a>}
        {r.link_origem && /^https?:\/\//.test(r.link_origem) && <a href={r.link_origem} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-700 hover:underline">Sistema de origem<ExternalLink className="h-3 w-3" /></a>}
      </div>
      {m.ai_summary && <p className="mt-2 whitespace-pre-wrap rounded-lg bg-brand-100/60 px-3 py-2 text-xs text-gray-700"><b className="text-accent-purple">Análise do agente:</b> {m.ai_summary}</p>}

      {m.status === 'oportunidade' && m.contract_id ? (
        <Link href={`/contracts/${m.contract_id}`} className="mt-3 inline-block text-xs font-medium text-brand-700 hover:underline">Abrir a oportunidade ›</Link>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
          {pipelines.length > 1 && (
            <select value={pipe} onChange={e => setPipe(e.target.value)} aria-label="Funil" className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs">
              {pipelines.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <button type="button" disabled={pending || !pipe} onClick={() => act(async () => { const res = await convertMatch(m.id, pipe); if (res.ok) router.push(`/contracts/${res.contractId}`); return res })}
            className="rounded-lg bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50">Virar oportunidade</button>
          {m.status !== 'participar' && <button type="button" disabled={pending} onClick={() => act(() => setMatchStatus(m.id, 'participar'))} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">Vamos participar</button>}
          {m.status === 'nova' && <button type="button" disabled={pending} onClick={() => act(() => setMatchStatus(m.id, 'analisando'))} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">Em análise</button>}
          {m.ai_score === null && <button type="button" disabled={pending} onClick={() => act(() => analyzeMatch(m.id))} className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-accent-purple hover:bg-gray-50"><Sparkles className="h-3.5 w-3.5" />Analisar com IA</button>}
          <select value={m.assigned_to ?? ''} disabled={pending} onChange={e => act(() => assignMatch(m.id, e.target.value || null))} aria-label="Responsável" className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs">
            <option value="">sem responsável</option>
            {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {m.status !== 'descartada'
            ? <button type="button" disabled={pending} onClick={() => act(() => setMatchStatus(m.id, 'descartada'))} className="ml-auto text-xs text-gray-400 hover:text-negative-700">descartar</button>
            : <button type="button" disabled={pending} onClick={() => act(() => setMatchStatus(m.id, 'nova'))} className="ml-auto text-xs text-gray-400 hover:text-brand-700">voltar para decidir</button>}
        </div>
      )}
      {pending && <p className="mt-1 text-[11px] text-gray-400">Salvando…</p>}
      {detail && <DetailDrawer numero={m.numero_controle} pipelines={pipelines} nowMs={nowMs} onClose={() => { setDetail(false); router.refresh() }} />}
      {err && <p className="mt-1 text-xs text-negative-700">{err}</p>}
    </li>
  )
}

// ── Monitoramentos ───────────────────────────────────────────────────────────
const EMPTY: WatcherInput = {
  name: '', keywords: '', exclude: '', ufs: [], modalidades: [], min_value: null, max_value: null,
  recipient_ids: [], area_ids: [], channels: { sino: true, whatsapp: true, email: false }, ai_analysis: true, remind_days: 3, enabled: true,
}

function Watchers({ isAdmin, watchers, people, areas, prefill, onPrefillUsed }: { isAdmin: boolean; watchers: WatcherView[]; people: Opt[]; areas: Opt[]; prefill?: string | null; onPrefillUsed?: () => void }) {
  const router = useRouter()
  const [editing, setEditing] = useState<WatcherInput | null>(prefill && isAdmin ? { ...EMPTY, name: prefill.slice(0, 80), keywords: prefill } : null)
  useEffect(() => { if (prefill) onPrefillUsed?.() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const pName = new Map(people.map(p => [p.id, p.name]))
  const aName = new Map(areas.map(a => [a.id, a.name]))

  async function runNow() {
    setBusy(true); setMsg(null)
    const r = await searchNow()
    setBusy(false)
    setMsg(r.ok
      ? 'Busca iniciada no PNCP. Ela roda em segundo plano (alguns minutos) e você recebe um aviso no sino quando terminar; depois é só abrir "Meus alertas".'
      : r.error)
  }

  if (editing) return <WatcherForm initial={editing} people={people} areas={areas} onDone={() => { setEditing(null); router.refresh() }} onCancel={() => setEditing(null)} />

  return (
    <div className="space-y-3">
      {isAdmin && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setEditing({ ...EMPTY })} className="inline-flex items-center gap-1 rounded-lg bg-brand-700 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-800"><Plus className="h-4 w-4" />Novo monitoramento</button>
          {watchers.length > 0 && <button type="button" disabled={busy} onClick={runNow} className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60">{busy ? 'Iniciando…' : 'Buscar agora (últimos 7 dias)'}</button>}
          {msg && <p role="status" className="w-full text-sm text-gray-700">{msg}</p>}
        </div>
      )}
      {!isAdmin && <p className="text-xs text-gray-500">Os monitoramentos são criados pelo administrador da empresa.</p>}
      {watchers.length === 0
        ? <p className="rounded-xl border border-dashed border-gray-300 bg-white p-6 text-sm text-gray-500">Nenhum monitoramento. Crie um dizendo as palavras do objeto que interessam (ex.: &quot;engenharia clínica&quot;, &quot;manutenção de equipamentos médico-hospitalares&quot;).</p>
        : (
          <ul className="space-y-2">
            {watchers.map(w => (
              <li key={w.id} className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900">{w.name} {!w.enabled && <span className="ml-1 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">desligado</span>}</p>
                    <p className="mt-0.5 text-xs text-gray-600">Procura: {w.keywords.join(' · ')}{w.exclude.length ? ` · sem: ${w.exclude.join(', ')}` : ''}</p>
                    <p className="text-xs text-gray-500">
                      {w.ufs.length ? w.ufs.join(', ') : 'todo o Brasil'} · {w.modalidades.length ? w.modalidades.map(id => MODALIDADES.find(x => x.id === id)?.nome).join(', ') : 'todas as modalidades'}
                      {w.min_value !== null || w.max_value !== null ? ` · ${w.min_value !== null ? `a partir de ${fmtBRL(w.min_value)}` : ''}${w.max_value !== null ? ` até ${fmtBRL(w.max_value)}` : ''}` : ''}
                    </p>
                    <p className="text-xs text-gray-500">Avisa: {[...w.recipient_ids.map(id => pName.get(id) ?? '—'), ...w.area_ids.map(id => `área ${aName.get(id) ?? '—'}`)].join(', ') || '—'}
                      {' '}({[w.channels.sino && 'sino', w.channels.whatsapp && 'WhatsApp', w.channels.email && 'e-mail'].filter(Boolean).join(', ')})
                      {w.ai_analysis ? ' · 🤖 agente analisa o objeto' : ''} · lembrete do prazo {w.remind_days} dia(s) antes</p>
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => setEditing({ ...w, keywords: w.keywords.join('\n'), exclude: w.exclude.join('\n') })} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">Editar</button>
                      <button type="button" aria-label="Excluir monitoramento" onClick={async () => { const r = await deleteWatcher(w.id); if (!r.ok) setMsg(r.error); router.refresh() }} className="rounded-lg p-1.5 text-gray-400 hover:bg-negative-100 hover:text-negative-700"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
    </div>
  )
}

function WatcherForm({ initial, people, areas, onDone, onCancel }: { initial: WatcherInput; people: Opt[]; areas: Opt[]; onDone: () => void; onCancel: () => void }) {
  const [w, setW] = useState<WatcherInput>(initial)
  const [err, setErr] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const set = (p: Partial<WatcherInput>) => { setErr(null); setW(x => ({ ...x, ...p })) }
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v])
  return (
    <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-5">
      <p className="text-sm font-semibold text-gray-900">{initial.id ? 'Editar monitoramento' : 'Novo monitoramento'}</p>
      <label className="block text-xs font-medium text-gray-700">Nome
        <input className={input} value={w.name} maxLength={80} onChange={e => set({ name: e.target.value })} placeholder="Ex.: Engenharia clínica — Sudeste" />
      </label>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block text-xs font-medium text-gray-700">Procurar no objeto (uma linha por assunto; basta uma linha bater — todas as palavras da linha, em qualquer ordem; frase exata entre aspas)
          <textarea className={`${input} min-h-[110px]`} value={String(w.keywords)} onChange={e => set({ keywords: e.target.value })}
            placeholder={'engenharia clínica\nmanutenção equipamentos médicos\nmanutenção equipamentos hospitalares\ncalibração equipamentos médicos'} />
        </label>
        <label className="block text-xs font-medium text-gray-700">Descartar se tiver (opcional)
          <textarea className={`${input} min-h-[110px]`} value={String(w.exclude)} onChange={e => set({ exclude: e.target.value })} placeholder={'odontológico\nveterinário'} />
        </label>
      </div>
      <fieldset>
        <legend className="mb-1 text-xs font-medium text-gray-700">Estados <span className="font-normal text-gray-500">(nenhum marcado = todo o Brasil)</span></legend>
        <div className="flex flex-wrap gap-1">
          {UFS.map(u => (
            <button key={u.uf} type="button" title={u.name} onClick={() => set({ ufs: toggle(w.ufs, u.uf) })}
              className={`rounded px-2 py-1 text-xs font-medium ${w.ufs.includes(u.uf) ? 'bg-brand-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>{u.uf}</button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-1 text-xs font-medium text-gray-700">Modalidades <span className="font-normal text-gray-500">(nenhuma marcada = todas)</span></legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {MODALIDADES.filter(m => m.busca).map(m => (
            <label key={m.id} className="flex items-center gap-1 text-xs text-gray-700">
              <input type="checkbox" checked={w.modalidades.includes(m.id)} onChange={() => set({ modalidades: toggle(w.modalidades, m.id) })} />{m.nome}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-xs font-medium text-gray-700">Valor estimado a partir de (R$)
          <input type="number" min={0} className={input} value={w.min_value ?? ''} onChange={e => set({ min_value: e.target.value === '' ? null : Number(e.target.value) })} />
        </label>
        <label className="block text-xs font-medium text-gray-700">Até (R$)
          <input type="number" min={0} className={input} value={w.max_value ?? ''} onChange={e => set({ max_value: e.target.value === '' ? null : Number(e.target.value) })} />
        </label>
        <label className="block text-xs font-medium text-gray-700">Lembrar o prazo de proposta (dias antes)
          <input type="number" min={0} max={30} className={input} value={w.remind_days} onChange={e => set({ remind_days: Number(e.target.value) })} />
        </label>
      </div>
      <p className="text-[11px] text-gray-500">Licitação com valor sigiloso ou não informado não é descartada pela faixa de valor.</p>
      <fieldset>
        <legend className="mb-1 text-xs font-medium text-gray-700">Quem recebe o aviso das novas</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {people.map(p => <label key={p.id} className="flex items-center gap-1 text-xs text-gray-700"><input type="checkbox" checked={w.recipient_ids.includes(p.id)} onChange={() => set({ recipient_ids: toggle(w.recipient_ids, p.id) })} />{p.name}</label>)}
        </div>
        {areas.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {areas.map(a => <label key={a.id} className="flex items-center gap-1 text-xs text-gray-700"><input type="checkbox" checked={w.area_ids.includes(a.id)} onChange={() => set({ area_ids: toggle(w.area_ids, a.id) })} />área {a.name} (coordenador e gerente)</label>)}
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-x-4 text-xs text-gray-700">
          {(['sino', 'whatsapp', 'email'] as const).map(c => (
            <label key={c} className="flex items-center gap-1"><input type="checkbox" checked={w.channels[c]} onChange={() => set({ channels: { ...w.channels, [c]: !w.channels[c] } })} />{c === 'sino' ? 'Sino' : c === 'whatsapp' ? 'WhatsApp' : 'E-mail'}</label>
          ))}
        </div>
      </fieldset>
      <label className="flex items-start gap-2 text-sm text-gray-700">
        <input type="checkbox" className="mt-0.5" checked={w.ai_analysis} onChange={() => set({ ai_analysis: !w.ai_analysis })} />
        <span><b>🤖 O agente de IA analisa o objeto</b><br /><span className="text-xs text-gray-500">Dá uma nota de aderência ao que a empresa vende e os pontos de atenção. Usa a IA da empresa (até 15 por rodada); sem IA, as licitações chegam sem análise.</span></span>
      </label>
      <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={w.enabled} onChange={() => set({ enabled: !w.enabled })} />Ligado</label>
      {err && <p className="text-sm text-negative-700">{err}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={pending} onClick={() => start(async () => { const r = await saveWatcher(w); if (!r.ok) setErr(r.error); else onDone() })}
          className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50">{pending ? 'Salvando…' : 'Salvar'}</button>
        <button type="button" onClick={onCancel} className="px-3 text-sm text-gray-500 hover:text-gray-800">Cancelar</button>
      </div>
    </div>
  )
}
