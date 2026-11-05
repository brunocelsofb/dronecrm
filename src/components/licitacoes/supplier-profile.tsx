'use client'
// Perfil de um fornecedor pelo CNPJ (concorrente ou a própria empresa): contratos assinados no PNCP,
// quanto somam, em que estados e com quais órgãos.

import { useEffect, useState } from 'react'
import { X, ExternalLink, Bookmark, ShieldCheck, ShieldAlert, Users, Trophy } from 'lucide-react'
import { fmtBRL } from '@/lib/format'
import { getSupplierProfile, saveCompetitor, getSupplierExtras, getSupplierItemsWon, getBidHistory } from '@/lib/actions/licitacoes'
import { SANCAO_LABEL, type SupplierContract, type Sancao, type Cadastro } from '@/lib/pncp/results'

type Summary = { contratos: number; valor: number; nome: string | null; ufs: { uf: string; n: number; valor: number }[]; orgaos: { nome: string; uf: string | null; n: number; valor: number }[] }

export function fmtCnpjView(v: string) {
  const d = v.replace(/\D/g, '')
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : v
}

export function SupplierProfileBody({ cnpj, name, canSave, onSaved }: { cnpj: string; name?: string | null; canSave?: boolean; onSaved?: () => void }) {
  const [s, setS] = useState<Summary | null>(null)
  const [items, setItems] = useState<SupplierContract[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    getSupplierProfile(cnpj).then(r => {
      if (!alive) return
      if (r.ok) { setS(r.summary); setItems(r.items) } else setErr(r.error)
    })
    return () => { alive = false }
  }, [cnpj])

  const title = s?.nome ?? name ?? fmtCnpjView(cnpj)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-gray-900">{title}</p>
          <p className="text-xs text-gray-500">CNPJ {fmtCnpjView(cnpj)}</p>
        </div>
        {canSave && (
          <button type="button" onClick={async () => { const r = await saveCompetitor({ cnpj, name: title }); setSaved(r.ok ? 'Guardado nos concorrentes.' : (r.error ?? 'Não foi possível.')); if (r.ok) onSaved?.() }}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"><Bookmark className="h-3.5 w-3.5" />Acompanhar este concorrente</button>
        )}
      </div>
      {saved && <p role="status" className="text-xs text-positive-700">{saved}</p>}
      <Extras cnpj={cnpj} />
      <AgainstUs cnpj={cnpj} />
      <ItemsWon cnpj={cnpj} />
      {!s && !err && <p className="text-sm text-gray-500">Buscando os contratos no PNCP…</p>}
      {err && <p className="text-sm text-negative-700">{err}</p>}
      {s && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-gray-200 p-3"><p className="text-[11px] text-gray-500">Contratos no PNCP</p><p className="text-lg font-semibold text-gray-900">{s.contratos.toLocaleString('pt-BR')}</p></div>
            <div className="rounded-xl border border-gray-200 p-3"><p className="text-[11px] text-gray-500">Valor somado</p><p className="text-lg font-semibold text-gray-900">{fmtBRL(s.valor)}</p></div>
          </div>
          {s.contratos === 0 && <p className="text-xs text-gray-500">Nenhum contrato deste CNPJ publicado no PNCP.</p>}
          {s.ufs.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-gray-700">Onde ganha</p>
              <div className="flex flex-wrap gap-1.5">{s.ufs.map(u => <span key={u.uf} className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-700">{u.uf} · {u.n} · {fmtBRL(u.valor)}</span>)}</div>
            </div>
          )}
          {s.orgaos.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-gray-700">Principais órgãos</p>
              <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 text-xs">
                {s.orgaos.map(o => <li key={o.nome} className="flex justify-between gap-2 px-3 py-1.5"><span className="min-w-0 truncate text-gray-800">{o.nome}{o.uf ? ` / ${o.uf}` : ''}</span><span className="shrink-0 text-gray-600">{o.n} · {fmtBRL(o.valor)}</span></li>)}
              </ul>
            </div>
          )}
          {items.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-gray-700">Contratos mais recentes</p>
              <ul className="space-y-1.5">
                {items.slice(0, 30).map((c, i) => (
                  <li key={`${c.numero_controle ?? i}`} className="rounded-lg border border-gray-100 px-3 py-2 text-xs">
                    <p className="font-medium text-gray-800">{c.orgao_nome ?? '—'}{c.uf ? ` / ${c.uf}` : ''} · {fmtBRL(c.valor)}</p>
                    <p className="line-clamp-2 text-gray-600">{c.objeto ?? c.titulo}</p>
                    <p className="text-gray-400">
                      {c.assinatura ? `assinado em ${new Date(c.assinatura).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}` : ''}
                      {c.url && <a href={c.url} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-0.5 text-brand-700 hover:underline"><ExternalLink className="h-3 w-3" />PNCP</a>}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-[11px] text-gray-400">Fonte: contratos publicados no PNCP. Participações sem vitória não são publicadas pelo PNCP.</p>
        </>
      )}
    </div>
  )
}

export function SupplierDrawer({ cnpj, name, onClose }: { cnpj: string; name?: string | null; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-black/30" role="dialog" aria-modal="true" aria-label="Perfil do fornecedor" onClick={onClose}>
      <div className="h-full w-full max-w-xl overflow-y-auto bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex justify-end"><button type="button" onClick={onClose} aria-label="Fechar" className="rounded p-1 text-gray-500 hover:bg-gray-100"><X className="h-5 w-5" /></button></div>
        <SupplierProfileBody cnpj={cnpj} name={name} canSave />
      </div>
    </div>
  )
}

// Sanções (TCU) + cadastro na Receita com o quadro societário
const brDay = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10).split('-').reverse().join('/') : v ?? '—')
function Extras({ cnpj }: { cnpj: string }) {
  const [x, setX] = useState<{ cadastro: Cadastro | null; sancoes: { itens: Sancao[]; lidoEm: string } | null } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let alive = true
    getSupplierExtras(cnpj).then(r => { if (!alive) return; if (r.ok) setX({ cadastro: r.cadastro, sancoes: r.sancoes }); else setErr(r.error) })
    return () => { alive = false }
  }, [cnpj])
  const retry = async () => {
    setBusy(true); setErr(null)
    const r = await getSupplierExtras(cnpj)
    setBusy(false)
    if (r.ok) setX({ cadastro: r.cadastro ?? x?.cadastro ?? null, sancoes: r.sancoes ?? x?.sancoes ?? null }); else setErr(r.error)
  }
  const retryBtn = <button type="button" disabled={busy} onClick={retry} className="mt-1 rounded border border-gray-300 px-2 py-0.5 text-[11px] text-gray-700 hover:bg-gray-50 disabled:opacity-50">{busy ? 'Consultando…' : 'Tentar de novo'}</button>
  if (err) return <div><p className="text-xs text-negative-700">{err}</p>{retryBtn}</div>
  if (!x) return <p className="text-xs text-gray-500">Consultando sanções e quadro societário…</p>
  const consta = (x.sancoes?.itens ?? []).filter(s => s.situacao === 'CONSTA' || (s.situacao !== 'NADA_CONSTA' && s.situacao !== 'SISTEMA_INDISPONIVEL'))
  const c = x.cadastro
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className={`rounded-xl border p-3 ${consta.length ? 'border-negative-600 bg-negative-100' : 'border-gray-200'}`}>
        <p className="mb-1 inline-flex items-center gap-1 text-xs font-semibold text-gray-800">
          {consta.length ? <ShieldAlert className="h-4 w-4 text-negative-700" /> : <ShieldCheck className="h-4 w-4 text-positive-700" />}Sanções e penalidades
        </p>
        {!x.sancoes ? <div><p className="text-xs text-gray-500">A consulta do TCU não respondeu agora.</p>{retryBtn}</div> : (
          <ul className="space-y-1 text-xs">
            {x.sancoes.itens.map(s => (
              <li key={s.tipo} className="flex justify-between gap-2">
                <span className="min-w-0 text-gray-700">{s.descricao} <span className="text-gray-400">({s.emissor})</span>
                  {s.observacao && <span className="block text-negative-700">{s.observacao}</span>}</span>
                <span className={`shrink-0 font-medium ${s.situacao === 'NADA_CONSTA' ? 'text-positive-700' : s.situacao === 'SISTEMA_INDISPONIVEL' ? 'text-gray-400' : 'text-negative-700'}`}>
                  {s.link && s.situacao !== 'NADA_CONSTA' ? <a href={s.link} target="_blank" rel="noreferrer" className="hover:underline">{SANCAO_LABEL[s.situacao] ?? s.situacao}</a> : (SANCAO_LABEL[s.situacao] ?? s.situacao)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 text-[10px] text-gray-400">Fonte: consulta consolidada do TCU (inidôneos TCU, CEIS, CNEP, improbidade CNJ){x.sancoes ? ` · ${new Date(x.sancoes.lidoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}` : ''}.</p>
      </div>
      <div className="rounded-xl border border-gray-200 p-3">
        <p className="mb-1 inline-flex items-center gap-1 text-xs font-semibold text-gray-800"><Users className="h-4 w-4 text-brand-700" />Cadastro e quadro societário</p>
        {!c ? <div><p className="text-xs text-gray-500">A consulta da Receita não respondeu agora.</p>{retryBtn}</div> : (
          <div className="space-y-1 text-xs text-gray-700">
            <p className="font-medium text-gray-900">{c.razao}{c.fantasia ? <span className="font-normal text-gray-500"> · {c.fantasia}</span> : null}</p>
            <p>Situação: <b className={/ativa/i.test(c.situacao ?? '') ? 'text-positive-700' : 'text-negative-700'}>{c.situacao ?? '—'}</b> · desde {brDay(c.abertura)}{c.porte ? ` · ${c.porte}` : ''}</p>
            <p>Capital social: {fmtBRL(c.capital)}{c.cidade ? ` · ${c.cidade}/${c.uf ?? ''}` : ''}</p>
            {c.cnae && <p className="text-gray-500">{c.cnae}</p>}
            {c.socios.length ? (
              <ul className="mt-1 divide-y divide-gray-100 rounded-lg border border-gray-100">
                {c.socios.map((s, i) => <li key={`${s.nome}-${i}`} className="px-2 py-1"><b className="font-medium text-gray-900">{s.nome}</b><span className="block text-gray-500">{s.qualificacao ?? '—'}{s.desde ? ` · desde ${brDay(s.desde)}` : ''}{s.faixa ? ` · ${s.faixa}` : ''}</span></li>)}
              </ul>
            ) : <p className="text-gray-500">Quadro societário não informado na Receita.</p>}
          </div>
        )}
        <p className="mt-1 text-[10px] text-gray-400">Fonte: Receita Federal (via BrasilAPI ou ReceitaWS).</p>
      </div>
    </div>
  )
}

// Itens ganhos nos últimos 12 meses (Compras.gov), agrupados por licitação
type Won = Extract<Awaited<ReturnType<typeof getSupplierItemsWon>>, { ok: true }>
function ItemsWon({ cnpj }: { cnpj: string }) {
  const [w, setW] = useState<Won | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let alive = true
    getSupplierItemsWon(cnpj).then(r => { if (!alive) return; if (r.ok) setW(r); else setErr(r.error) })
    return () => { alive = false }
  }, [cnpj])
  const retry = async () => { setBusy(true); setErr(null); const r = await getSupplierItemsWon(cnpj); setBusy(false); if (r.ok) setW(r); else setErr(r.error) }
  return (
    <div className="rounded-xl border border-gray-200 p-3">
      <p className="mb-1 inline-flex items-center gap-1 text-xs font-semibold text-gray-800"><Trophy className="h-4 w-4 text-brand-700" />Itens ganhos nos últimos 12 meses</p>
      {err && <div><p className="text-xs text-gray-500">{err}</p><button type="button" disabled={busy} onClick={retry} className="mt-1 rounded border border-gray-300 px-2 py-0.5 text-[11px] text-gray-700 hover:bg-gray-50 disabled:opacity-50">{busy ? 'Consultando…' : 'Tentar de novo'}</button></div>}
      {!w && !err && <p className="text-xs text-gray-500">Consultando os resultados no Compras.gov…</p>}
      {w && (w.licitacoes === 0 ? <p className="text-xs text-gray-500">Nenhum item ganho nos últimos 12 meses (licitações da Lei 14.133 com resultado publicado).</p> : (
        <>
          <p className="text-xs text-gray-700"><b>{w.itens.toLocaleString('pt-BR')}</b> item(ns) em <b>{w.licitacoes.toLocaleString('pt-BR')}</b> licitação(ões) · {fmtBRL(w.valor)} homologado</p>
          <ul className="mt-2 space-y-1.5">
            {w.compras.map(c => (
              <li key={c.numero_controle} className="rounded-lg border border-gray-100 px-3 py-2 text-xs">
                <p className="font-medium text-gray-800">{c.orgao_nome ?? `Órgão CNPJ ${fmtCnpjView(c.orgao_cnpj ?? '')}`}{c.uf ? ` / ${c.uf}` : ''} · {fmtBRL(c.valor)}</p>
                {c.objeto && <p className="line-clamp-2 text-gray-600">{c.objeto}</p>}
                <p className="text-gray-400">
                  {c.itens} item(ns){c.data ? ` · resultado em ${c.data.split('-').reverse().join('/')}` : ''}
                  {c.url && <a href={c.url} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-0.5 text-brand-700 hover:underline"><ExternalLink className="h-3 w-3" />PNCP</a>}
                </p>
              </li>
            ))}
          </ul>
          {w.licitacoes > w.compras.length && <p className="mt-1 text-[11px] text-gray-500">Mostrando as {w.compras.length} mais recentes.</p>}
        </>
      ))}
      <p className="mt-1 text-[10px] text-gray-400">Fonte: Compras.gov (dados abertos), resultados por item da Lei 14.133. Mostra só o que a empresa venceu.</p>
    </div>
  )
}

// Disputas contra nós registradas pela equipe (só aparece se houver)
type Hist = Extract<Awaited<ReturnType<typeof getBidHistory>>, { ok: true }>
function AgainstUs({ cnpj }: { cnpj: string }) {
  const [h, setH] = useState<Hist | null>(null)
  useEffect(() => {
    let alive = true
    getBidHistory(cnpj).then(r => { if (alive && r.ok) setH(r) })
    return () => { alive = false }
  }, [cnpj])
  if (!h || h.disputas === 0) return null
  const venceuNos = h.rows.filter(r => r.us && r.position !== null && r.us.position !== null && r.position < r.us.position).length
  return (
    <div className="rounded-xl border border-gray-200 p-3">
      <p className="mb-1 text-xs font-semibold text-gray-800">Contra nós (registrado pela equipe)</p>
      <p className="text-xs text-gray-700">{h.disputas} disputa(s) · venceu {h.vitorias} · ficou à nossa frente em {venceuNos}</p>
      <ul className="mt-2 space-y-1 text-xs">
        {h.rows.slice(0, 20).map((r, i) => (
          <li key={`${r.match_id}-${i}`} className="rounded-lg border border-gray-100 px-3 py-1.5">
            <p className="text-gray-800">{r.orgao_nome ?? '—'}{r.uf ? ` / ${r.uf}` : ''}</p>
            {r.objeto && <p className="line-clamp-1 text-gray-500">{r.objeto}</p>}
            <p className="text-gray-600">Ele: {r.position ? `${r.position}º` : '—'}{r.value !== null ? ` · ${fmtBRL(r.value)}` : ''}{r.won ? ' · venceu' : ''}
              {r.us ? <> · Nós: {r.us.position ? `${r.us.position}º` : '—'}{r.us.value !== null ? ` · ${fmtBRL(r.us.value)}` : ''}</> : null}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}
