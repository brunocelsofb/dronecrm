'use client'
// Licitações · Pesquisar: busca por palavra direto no PNCP (qualquer período) + painel lateral com itens,
// arquivos do edital, análise do agente e "Adicionar ao funil".

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Search, ExternalLink, X, FileText, Sparkles, Clock, Bell, Trophy } from 'lucide-react'
import { fmtBRL, fmtPct } from '@/lib/format'
import { UFS } from '@/lib/geo/uf'
import { MODALIDADES, STATUS_LABEL, SEARCH_SITUACOES, pncpUrl, type MatchStatus, type PncpRow, type SearchSituacao } from '@/lib/pncp/catalog'
import {
  searchContratacoes, getContratacaoDetail, saveToRadar, analyzeNumero, convertNumero, getResultado,
  type SearchHit, type DetailItem, type DetailFile,
} from '@/lib/actions/licitacoes'
import { OUTCOME_LABEL, type Resultado, type Outcome } from '@/lib/pncp/results'
import { SupplierDrawer } from './supplier-profile'

type Opt = { id: string; name: string }
const RECENT_KEY = 'licitacoes:recentes'

function readRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[] } catch { return [] }
}
function pushRecent(q: string) {
  try {
    const list = [q, ...readRecent().filter(x => x !== q)].slice(0, 6)
    localStorage.setItem(RECENT_KEY, JSON.stringify(list))
  } catch { /* sem armazenamento: segue */ }
}

export function Countdown({ iso, nowMs }: { iso: string | null; nowMs: number }) {
  if (!iso) return <span className="text-[11px] text-gray-500">sem prazo informado</span>
  const ms = Date.parse(iso) - nowMs
  const date = new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  if (ms < 0) return <span className="text-[11px] text-gray-500">encerrada em {date}</span>
  const d = Math.floor(ms / 86_400_000), h = Math.floor((ms % 86_400_000) / 3_600_000)
  const tone = d < 1 ? 'bg-negative-100 text-negative-700' : d <= 3 ? 'bg-warn-100 text-warn-700' : 'bg-gray-100 text-gray-600'
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-xs text-gray-700">
      <Clock className="h-3.5 w-3.5 text-gray-400" /><b className="tabular-nums">{date}</b>
      <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${tone}`}>em {d ? `${d}d ` : ''}{h}h</span>
    </span>
  )
}

function sitLabel(sit: SearchSituacao, n: number) {
  if (sit === 'abertas') return n === 1 ? ' aberta' : ' abertas'
  if (sit === 'encerradas') return n === 1 ? ' encerrada' : ' encerradas'
  return ''
}

export function SearchTab({ isAdmin, pipelines, nowMs, onCreateAlert }: { isAdmin: boolean; pipelines: Opt[]; nowMs: number; onCreateAlert: (q: string) => void }) {
  const [q, setQ] = useState('')
  const [uf, setUf] = useState('')
  const [mod, setMod] = useState('')
  const [sit, setSit] = useState<SearchSituacao>('abertas')
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')
  const [page, setPage] = useState(1)
  const [res, setRes] = useState<{ rows: SearchHit[]; total: number; pages: number; live: boolean } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [recent, setRecent] = useState<string[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function run(p = 1, text = q) {
    setPage(p)
    start(async () => {
      setErr(null)
      const r = await searchContratacoes({ q: text, uf: uf || null, modalidade: mod ? Number(mod) : null, situacao: sit, de: de || null, ate: ate || null, page: p })
      if (!r.ok) { setErr(r.error); return }
      setRes(r)
      if (text.trim()) { pushRecent(text.trim()); setRecent(readRecent()) }
    })
  }
  // Primeira abertura: as abertas mais recentes
  useEffect(() => {
    start(async () => {
      const r = await searchContratacoes({ q: '', page: 1 })
      if (r.ok) setRes(r); else setErr(r.error)
      setRecent(readRecent())
    })
  }, [])

  return (
    <div className="space-y-3">
      <form onSubmit={e => { e.preventDefault(); run(1) }} className="flex flex-wrap items-center gap-2">
        <span className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          <input value={q} onChange={e => setQ(e.target.value)} onFocus={() => setRecent(readRecent())} placeholder="Encontrar: manutenção equipamentos médicos, engenharia clínica…" aria-label="Pesquisar licitações"
            className="w-full rounded-xl border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm focus:border-brand-700 focus:outline-none" />
        </span>
        <select value={uf} onChange={e => setUf(e.target.value)} aria-label="Estado" className="rounded-xl border border-gray-300 bg-white px-2 py-2 text-sm">
          <option value="">Todos os estados</option>
          {UFS.map(u => <option key={u.uf} value={u.uf}>{u.uf} · {u.name}</option>)}
        </select>
        <select value={mod} onChange={e => setMod(e.target.value)} aria-label="Modalidade" className="rounded-xl border border-gray-300 bg-white px-2 py-2 text-sm">
          <option value="">Todas as modalidades</option>
          {MODALIDADES.filter(m => m.busca).map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
        </select>
        <select value={sit} onChange={e => setSit(e.target.value as SearchSituacao)} aria-label="Situação" className="rounded-xl border border-gray-300 bg-white px-2 py-2 text-sm">
          {SEARCH_SITUACOES.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}
        </select>
        <span className="flex items-center gap-1 text-xs text-gray-600">publicadas de
          <input type="date" value={de} onChange={e => setDe(e.target.value)} aria-label="Publicadas a partir de" className="rounded-xl border border-gray-300 bg-white px-2 py-1.5 text-sm" />
          até
          <input type="date" value={ate} onChange={e => setAte(e.target.value)} aria-label="Publicadas até" className="rounded-xl border border-gray-300 bg-white px-2 py-1.5 text-sm" />
          {(de || ate) && <button type="button" onClick={() => { setDe(''); setAte('') }} aria-label="Limpar período" className="rounded p-1 text-gray-400 hover:text-gray-700"><X className="h-3.5 w-3.5" /></button>}
        </span>
        <button type="submit" disabled={pending} className="rounded-xl bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-60">{pending ? 'Buscando…' : 'Buscar'}</button>
      </form>

      {recent.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
          <span>Recentes:</span>
          {recent.map(r => <button key={r} type="button" onClick={() => { setQ(r); run(1, r) }} className="rounded-full bg-gray-100 px-2.5 py-0.5 text-gray-700 hover:bg-gray-200">{r}</button>)}
        </div>
      )}

      {err && <p className="text-sm text-negative-700">{err}</p>}
      {res && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
          <span><b className="text-gray-800">{res.total.toLocaleString('pt-BR')}</b> {res.total === 1 ? 'licitação' : 'licitações'}{sitLabel(sit, res.total)}{q.trim() ? ` com "${q.trim()}"` : ''} no PNCP
            {!res.live && <span className="ml-1 text-warn-700">· o PNCP não respondeu agora; mostrando só o que o CRM já tinha baixado</span>}
          </span>
          {isAdmin && q.trim() && <button type="button" onClick={() => onCreateAlert(q.trim())} className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline"><Bell className="h-3.5 w-3.5" />Criar alerta com esta busca</button>}
        </div>
      )}

      {res && res.rows.length === 0 && (
        <p className="rounded-xl border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">
          Nada encontrado no PNCP. Tente menos palavras (todas precisam aparecer), use &ldquo;aspas&rdquo; para a frase exata, mude a situação ou tire os filtros.
        </p>
      )}

      <ul className="space-y-2">
        {res?.rows.map(r => (
          <li key={r.numero_controle}>
            <button type="button" onClick={() => setOpen(r.numero_controle)} className="w-full rounded-xl border border-gray-200 bg-white p-4 text-left hover:border-brand-700">
              <p className="text-sm font-semibold text-brand-700">{r.modalidade_nome ?? 'Licitação'} · {r.orgao_nome ?? '—'} / {r.uf ?? '—'}</p>
              <p className="mt-1 line-clamp-2 text-sm text-gray-800">{r.objeto ?? '—'}</p>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                <Countdown iso={r.data_encerramento} nowMs={nowMs} />
                <span className="text-xs text-gray-600">{r.valor_estimado && r.valor_estimado > 0 ? fmtBRL(r.valor_estimado) : 'valor não informado'}</span>
                <span className="text-xs text-gray-500">{r.municipio ?? ''}</span>
                {r.ai_score !== null && <span className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-semibold text-accent-purple"><Sparkles className="h-3 w-3" />{r.ai_score}/100</span>}
                {r.match_status && <span className="rounded-full bg-positive-100 px-2 py-0.5 text-[11px] font-medium text-positive-700">{STATUS_LABEL[r.match_status]}</span>}
              </div>
            </button>
          </li>
        ))}
      </ul>

      {res && res.pages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <button type="button" disabled={page <= 1 || pending} onClick={() => run(page - 1)} className="rounded-lg border border-gray-300 px-3 py-1.5 disabled:opacity-40">‹ Anterior</button>
          <span className="text-gray-500">página {page} de {res.pages}</span>
          <button type="button" disabled={page >= res.pages || pending} onClick={() => run(page + 1)} className="rounded-lg border border-gray-300 px-3 py-1.5 disabled:opacity-40">Próxima ›</button>
        </div>
      )}

      {open && <DetailDrawer numero={open} pipelines={pipelines} nowMs={nowMs} onClose={() => { setOpen(null); run(page) }} />}
    </div>
  )
}

// ── Painel lateral ───────────────────────────────────────────────────────────
type Detail = { row: PncpRow; items: DetailItem[]; files: DetailFile[]; itemsTotal: number; match: { id: string; status: MatchStatus; ai_score: number | null; ai_summary: string | null; contract_id: string | null } | null; warn?: string }

export function DetailDrawer({ numero, pipelines, nowMs, onClose }: { numero: string; pipelines: Opt[]; nowMs: number; onClose: () => void }) {
  const router = useRouter()
  const [d, setD] = useState<Detail | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [pipe, setPipe] = useState(pipelines[0]?.id ?? '')
  const [itemQ, setItemQ] = useState('')
  const [pending, start] = useTransition()

  const load = () => getContratacaoDetail(numero).then(r => { if (r.ok) setD(r); else setErr(r.error) })
  useEffect(() => { load() }, [numero]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [onClose])

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) => start(async () => {
    setErr(null); setMsg(null)
    const r = await fn()
    if (!r.ok) setErr(r.error ?? 'Não foi possível.')
    else { setMsg(ok); await load() }
  })

  const r = d?.row
  const link = r ? pncpUrl(r) : null
  const items = (d?.items ?? []).filter(i => !itemQ.trim() || i.descricao.toLowerCase().includes(itemQ.trim().toLowerCase()))
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" role="dialog" aria-modal="true" aria-label="Detalhe da licitação" onClick={onClose}>
      <div className="flex h-full w-full max-w-2xl flex-col overflow-y-auto bg-white shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center justify-between border-b border-gray-100 bg-white px-5 py-3">
          <span className="text-[11px] text-gray-400">PNCP {numero}</span>
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded p-1 text-gray-500 hover:bg-gray-100"><X className="h-5 w-5" /></button>
        </div>
        {!d && !err && <p className="p-6 text-sm text-gray-500">Carregando itens e arquivos do PNCP…</p>}
        {err && <p className="px-5 pt-4 text-sm text-negative-700">{err}</p>}
        {r && (
          <div className="space-y-4 p-5">
            <div className="space-y-1 text-center">
              <p className="text-sm text-gray-600">{r.modalidade_nome ?? 'Licitação'}{r.srp ? ' · registro de preços' : ''}</p>
              <p className="text-sm font-semibold text-gray-900">{r.unidade_nome ?? r.orgao_nome} — {r.municipio ?? ''}/{r.uf ?? ''}</p>
              <p className="text-xs text-gray-500">{r.orgao_nome}{r.orgao_cnpj ? ` · CNPJ ${r.orgao_cnpj}` : ''}</p>
            </div>
            <p className="text-sm font-medium uppercase leading-relaxed text-gray-900">{r.objeto}</p>
            {r.info_complementar && <p className="whitespace-pre-wrap text-xs text-gray-600">{r.info_complementar}</p>}
            <div className="flex flex-wrap items-center justify-center gap-3">
              <span className="rounded-full bg-brand-100 px-3 py-1 text-xs font-semibold text-brand-700">Valor estimado: {r.valor_estimado && r.valor_estimado > 0 ? fmtBRL(r.valor_estimado) : 'não informado'}</span>
              <Countdown iso={r.data_encerramento} nowMs={nowMs} />
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {r.link_origem && /^https?:\/\//.test(r.link_origem) && <a href={r.link_origem} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-50"><ExternalLink className="h-4 w-4" />Acessar</a>}
              {link && <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-50"><ExternalLink className="h-4 w-4" />Ver no PNCP</a>}
            </div>

            {/* Decisão */}
            <div className="space-y-2 rounded-xl border border-gray-200 p-4">
              {d.match?.contract_id ? (
                <a href={`/contracts/${d.match.contract_id}`} className="block text-center text-sm font-semibold text-brand-700 hover:underline">Já está no funil · abrir a oportunidade ›</a>
              ) : (
                <>
                  <p className="text-center text-xs text-gray-500">Para seguir esta licitação, coloque no funil ou guarde no radar.</p>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    {pipelines.length > 1 && (
                      <select value={pipe} onChange={e => setPipe(e.target.value)} aria-label="Funil" className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
                        {pipelines.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    )}
                    <button type="button" disabled={pending || !pipe} onClick={() => start(async () => { setErr(null); const x = await convertNumero(numero, pipe); if (!x.ok) setErr(x.error); else router.push(`/contracts/${x.contractId}`) })}
                      className="rounded-lg bg-positive-600 px-4 py-2 text-sm font-semibold text-white hover:bg-positive-700 disabled:opacity-60">Adicionar ao funil</button>
                    <button type="button" disabled={pending} onClick={() => act(() => saveToRadar(numero, 'participar'), 'Marcada "Vamos participar": o lembrete do prazo está ligado.')} className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">Vamos participar</button>
                    {!d.match && <button type="button" disabled={pending} onClick={() => act(() => saveToRadar(numero), 'Guardada no radar.')} className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">Guardar no radar</button>}
                  </div>
                  {d.match && <p className="text-center text-[11px] text-gray-500">No radar: {STATUS_LABEL[d.match.status]}</p>}
                </>
              )}
            </div>

            <ResultPanel numero={numero} closed={!!r.data_encerramento && Date.parse(r.data_encerramento) < nowMs} />

            {/* Agente */}
            <div className="rounded-xl border border-gray-200 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="inline-flex items-center gap-1 text-sm font-semibold text-gray-900"><Sparkles className="h-4 w-4 text-accent-purple" />Análise do agente</p>
                {d.match?.ai_score !== null && d.match?.ai_score !== undefined
                  ? <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-semibold text-accent-purple">{d.match.ai_score}/100</span>
                  : <button type="button" disabled={pending} onClick={() => act(() => analyzeNumero(numero), 'Análise pronta.')} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-accent-purple hover:bg-gray-50">{pending ? 'Analisando…' : 'Analisar o objeto com IA'}</button>}
              </div>
              {d.match?.ai_summary
                ? <p className="mt-2 whitespace-pre-wrap text-xs text-gray-700">{d.match.ai_summary}</p>
                : <p className="mt-1 text-xs text-gray-500">O agente lê o objeto e os dados da licitação, dá uma nota de aderência ao que a empresa vende e aponta o que exige atenção.</p>}
            </div>
            {msg && <p role="status" className="text-center text-xs text-positive-700">{msg}</p>}

            {/* Arquivos */}
            <div>
              <p className="mb-1 text-sm font-semibold text-gray-900">Arquivos do edital</p>
              {d.files.length
                ? <ul className="space-y-1">{d.files.map(f => (
                    <li key={f.url}><a href={f.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-brand-700 hover:underline"><FileText className="h-4 w-4" />{f.titulo}{f.tipo ? <span className="text-xs text-gray-400"> · {f.tipo}</span> : null}</a></li>
                  ))}</ul>
                : <p className="text-xs text-gray-500">{d.warn ?? 'Nenhum arquivo publicado no PNCP.'}</p>}
            </div>

            {/* Itens */}
            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-gray-900">Itens ({d.itemsTotal || d.items.length})</p>
                {d.items.length > 5 && <input value={itemQ} onChange={e => setItemQ(e.target.value)} placeholder="Pesquisar itens" className="w-48 rounded-lg border border-gray-300 px-2 py-1 text-xs" />}
              </div>
              {items.length ? (
                <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
                  {items.map(i => (
                    <li key={i.numero} className="flex gap-3 px-3 py-2 text-sm">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-gray-100 text-xs font-semibold text-gray-600">{i.numero}</span>
                      <span className="min-w-0">
                        <span className="block text-gray-800">{i.descricao}</span>
                        <span className="text-xs text-gray-500">Qtd. {i.quantidade ?? '—'} {i.unidade ?? ''}{i.valorTotal ? ` · ${fmtBRL(i.valorTotal)}` : ''}{i.tipo ? ` · ${i.tipo}` : ''}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-xs text-gray-500">{d.warn ?? 'Sem itens publicados.'}</p>}
              {d.itemsTotal > d.items.length && <p className="mt-1 text-[11px] text-gray-500">Mostrando {d.items.length} de {d.itemsTotal}. A lista completa está no PNCP.</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Resultado: situação de cada item, vencedor e valor homologado ─────────────
const OUTCOME_TONE: Record<Outcome, string> = {
  aguardando: 'bg-gray-100 text-gray-700', ganhou: 'bg-positive-100 text-positive-700', perdeu: 'bg-warn-100 text-warn-700',
  sem_vencedor: 'bg-gray-100 text-gray-600', cancelada: 'bg-negative-100 text-negative-700',
}
function ResultPanel({ numero, closed }: { numero: string; closed: boolean }) {
  const [r, setR] = useState<{ res: Resultado; status: Outcome; wonValue: number; ownSet: boolean } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sup, setSup] = useState<{ ni: string; nome: string } | null>(null)
  const load = async () => {
    setBusy(true); setErr(null)
    const x = await getResultado(numero)
    setBusy(false)
    if (x.ok) setR(x); else setErr(x.error)
  }
  useEffect(() => {
    if (!closed) return
    let alive = true
    getResultado(numero).then(x => { if (!alive) return; if (x.ok) setR(x); else setErr(x.error) })
    return () => { alive = false }
  }, [numero, closed])

  const desconto = r && r.res.estimadoTotal > 0 && r.res.homologadoTotal > 0 ? (1 - r.res.homologadoTotal / r.res.estimadoTotal) * 100 : null
  return (
    <div className="rounded-xl border border-gray-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="inline-flex items-center gap-1 text-sm font-semibold text-gray-900"><Trophy className="h-4 w-4 text-brand-700" />Resultado</p>
        {r ? <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${OUTCOME_TONE[r.status]}`}>{r.status === 'ganhou' ? `Ganhamos ${fmtBRL(r.wonValue)}` : OUTCOME_LABEL[r.status]}</span>
          : <button type="button" disabled={busy} onClick={load} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">{busy ? 'Buscando…' : 'Ver resultado no PNCP'}</button>}
      </div>
      {(busy || closed) && !r && !err && <p className="mt-2 text-xs text-gray-500">Lendo os itens e os vencedores no PNCP…</p>}
      {err && <p className="mt-2 text-xs text-negative-700">{err}</p>}
      {r && (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-gray-600">
            Estimado {fmtBRL(r.res.estimadoTotal)} · homologado {r.res.homologadoTotal > 0 ? fmtBRL(r.res.homologadoTotal) : '—'}
            {desconto !== null && <> · desconto {fmtPct(desconto)}</>} · {r.res.comResultado} de {r.res.itensTotal} item(ns) com vencedor
          </p>
          {!r.ownSet && <p className="text-[11px] text-gray-500">Para o CRM saber quando vocês ganham, o administrador cadastra os CNPJs da empresa em Licitações → Inteligência.</p>}
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
            {r.res.itens.slice(0, 60).map(i => (
              <li key={i.numero} className="px-3 py-2 text-xs">
                <p className="text-gray-800"><b>Item {i.numero}</b> · {i.situacao}{i.estimado ? ` · estimado ${fmtBRL(i.estimado)}` : ''}</p>
                <p className="line-clamp-1 text-gray-500">{i.descricao}</p>
                {i.vencedores.map(v => (
                  <p key={v.ni} className="mt-0.5 text-gray-700">
                    Vencedor: <button type="button" onClick={() => setSup({ ni: v.ni, nome: v.nome })} className="font-medium text-brand-700 hover:underline">{v.nome}</button>
                    {v.porte ? <span className="text-gray-400"> ({v.porte})</span> : null} · {fmtBRL(v.valorTotal)}{v.valorUnitario ? ` (${fmtBRL(v.valorUnitario)} un.)` : ''}
                  </p>
                ))}
              </li>
            ))}
          </ul>
          {r.res.itensTotal > r.res.itens.length && <p className="text-[11px] text-gray-500">Mostrando {r.res.itens.length} de {r.res.itensTotal} itens.</p>}
          <p className="text-[11px] text-gray-400">O PNCP publica o vencedor de cada item; quem participou e não ganhou não é publicado.</p>
        </div>
      )}
      {!r && !busy && !err && !closed && <p className="mt-1 text-xs text-gray-500">Ainda recebendo propostas. Depois da sessão, o vencedor e o valor aparecem aqui.</p>}
      {sup && <SupplierDrawer cnpj={sup.ni} name={sup.nome} onClose={() => setSup(null)} />}
    </div>
  )
}
