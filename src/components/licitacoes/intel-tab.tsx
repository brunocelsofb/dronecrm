'use client'
// Licitações · Inteligência: o caminho das licitações da empresa (alerta → participação → funil →
// resultado), valores, quem ganha de nós, nossos contratos no PNCP, concorrentes por CNPJ e a
// configuração do acompanhamento (CNPJs da empresa, quem recebe, por qual canal).

import { useEffect, useMemo, useState } from 'react'
import { Trash2, Search, RefreshCw } from 'lucide-react'
import { fmtBRL, fmtRatio } from '@/lib/format'
import { getIntel, saveIntelSettings, deleteCompetitor, trackNow, setMatchOutcome, getBidRivals, type IntelRow } from '@/lib/actions/licitacoes'
import { OUTCOME_LABEL, type Outcome } from '@/lib/pncp/results'
import { DetailDrawer } from './search-tab'
import { SupplierDrawer, SupplierProfileBody, fmtCnpjView } from './supplier-profile'

type Opt = { id: string; name: string }
type Intel = Extract<Awaited<ReturnType<typeof getIntel>>, { ok: true }>

const PARTICIPA = new Set(['participar', 'oportunidade'])
const isFunil = (m: IntelRow) => m.status === 'oportunidade' || !!m.contract_id
const outcomeOf = (m: IntelRow): Outcome => (m.result_status as Outcome | null) ?? 'aguardando'

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <p className="text-[11px] text-gray-500">{label}</p>
      <p className="text-lg font-semibold text-gray-900">{value}</p>
      {hint && <p className="text-[11px] text-gray-400">{hint}</p>}
    </div>
  )
}

export function IntelTab({ isAdmin, people, pipelines, nowMs }: { isAdmin: boolean; people: Opt[]; pipelines: Opt[]; nowMs: number }) {
  const [d, setD] = useState<Intel | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [filter, setFilter] = useState<'todas' | Outcome>('todas')
  const [open, setOpen] = useState<string | null>(null)
  const [sup, setSup] = useState<{ ni: string; nome: string | null } | null>(null)
  const load = () => getIntel().then(r => { if (r.ok) setD(r); else setErr(r.error) })
  useEffect(() => { load() }, [])

  const s = useMemo(() => {
    const list = d?.list ?? []
    const part = list.filter(m => PARTICIPA.has(m.status))
    const ganhou = part.filter(m => outcomeOf(m) === 'ganhou')
    const perdeu = part.filter(m => outcomeOf(m) === 'perdeu')
    const sum = (xs: IntelRow[], f: (m: IntelRow) => number | null) => xs.reduce((a, m) => a + (f(m) ?? 0), 0)
    // Quem ganhou de nós (nas que perdemos)
    const rivals = new Map<string, { ni: string; nome: string; n: number }>()
    for (const m of perdeu) for (const w of m.winners) {
      const [ni, ...rest] = w.split('|'); const nome = rest.join('|') || ni
      const x = rivals.get(ni) ?? { ni, nome, n: 0 }; x.n++; rivals.set(ni, x)
    }
    const byUf = new Map<string, { uf: string; part: number; won: number; valor: number }>()
    for (const m of part) {
      const u = m.uf ?? '—'
      const x = byUf.get(u) ?? { uf: u, part: 0, won: 0, valor: 0 }
      x.part++; if (outcomeOf(m) === 'ganhou') { x.won++; x.valor += m.won_value ?? 0 }
      byUf.set(u, x)
    }
    return {
      alertas: list.length,
      analise: list.filter(m => m.status === 'analisando' || m.status === 'nova').length,
      descartadas: list.filter(m => m.status === 'descartada').length,
      part, funil: list.filter(isFunil).length, ganhou, perdeu,
      aguardando: part.filter(m => outcomeOf(m) === 'aguardando').length,
      estimadoPart: sum(part, m => m.valor_estimado), ganhoValor: sum(ganhou, m => m.won_value),
      rivals: [...rivals.values()].sort((a, b) => b.n - a.n).slice(0, 10),
      ufs: [...byUf.values()].sort((a, b) => b.part - a.part),
    }
  }, [d])

  if (err) return <p className="text-sm text-negative-700">{err}</p>
  if (!d) return <p className="text-sm text-gray-500">Carregando a inteligência…</p>

  const rows = s.part.filter(m => filter === 'todas' || outcomeOf(m) === filter)
  const steps = [
    { label: 'Alertas e buscas guardadas', n: s.alertas },
    { label: 'Decidimos participar', n: s.part.length },
    { label: 'Foram para o funil', n: s.funil },
    { label: 'Ganhamos', n: s.ganhou.length },
  ]
  const max = Math.max(1, ...steps.map(x => x.n))

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Licitações no radar" value={s.alertas.toLocaleString('pt-BR')} hint={`${s.analise} em análise · ${s.descartadas} descartadas`} />
        <Kpi label="Participamos" value={s.part.length.toLocaleString('pt-BR')} hint={`${s.aguardando} aguardando resultado`} />
        <Kpi label="Foram para o funil" value={s.funil.toLocaleString('pt-BR')} />
        <Kpi label="Ganhamos" value={s.ganhou.length.toLocaleString('pt-BR')} hint={`${s.perdeu.length} não ganhamos`} />
        <Kpi label="Taxa de vitória" value={fmtRatio(s.ganhou.length, s.ganhou.length + s.perdeu.length)} hint="ganhas ÷ com resultado" />
        <Kpi label="Valor ganho" value={fmtBRL(s.ganhoValor)} hint={`estimado disputado ${fmtBRL(s.estimadoPart)}`} />
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <p className="mb-2 text-sm font-semibold text-gray-900">Caminho das licitações</p>
        <ul className="space-y-1.5">
          {steps.map(x => (
            <li key={x.label} className="flex items-center gap-3 text-xs">
              <span className="w-48 shrink-0 text-gray-600">{x.label}</span>
              <span className="h-4 flex-1 rounded bg-gray-100"><span className="block h-4 rounded bg-brand-700" style={{ width: `${(x.n / max) * 100}%` }} /></span>
              <span className="w-24 shrink-0 text-right tabular-nums text-gray-800">{x.n} · {fmtRatio(x.n, s.alertas)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-gray-900">Licitações que disputamos</p>
          <div className="flex flex-wrap gap-1">
            {(['todas', 'aguardando', 'ganhou', 'perdeu', 'sem_vencedor', 'cancelada'] as const).map(k => (
              <button key={k} type="button" onClick={() => setFilter(k)} aria-pressed={filter === k}
                className={`rounded-full px-2.5 py-0.5 text-[11px] ${filter === k ? 'bg-brand-700 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>{k === 'todas' ? 'Todas' : OUTCOME_LABEL[k]}</button>
            ))}
          </div>
        </div>
        {rows.length === 0
          ? <p className="text-xs text-gray-500">Nada aqui ainda. Marque &ldquo;Vamos participar&rdquo; ou coloque no funil a partir da pesquisa ou dos alertas; depois da sessão, o CRM acompanha o resultado no PNCP.</p>
          : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-xs">
                <thead className="text-gray-500"><tr><th className="py-1.5 pr-2 font-medium">Órgão</th><th className="pr-2 font-medium">Objeto</th><th className="pr-2 font-medium">Estimado</th><th className="pr-2 font-medium">Situação no PNCP / novidade</th><th className="pr-2 font-medium">Resultado</th><th className="pr-2 font-medium">Vencedor / homologado</th><th className="font-medium">Funil</th></tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map(m => {
                    const o = outcomeOf(m)
                    const w = m.winners[0]?.split('|')
                    return (
                      <tr key={m.id} className="align-top">
                        <td className="py-2 pr-2 text-gray-800">{m.orgao_nome ?? '—'} / {m.uf ?? '—'}</td>
                        <td className="max-w-xs pr-2"><button type="button" onClick={() => setOpen(m.numero_controle)} className="line-clamp-2 text-left text-brand-700 hover:underline">{m.objeto ?? '—'}</button></td>
                        <td className="pr-2 tabular-nums">{fmtBRL(m.valor_estimado)}</td>
                        <td className="max-w-[16rem] pr-2">
                          <span className={/suspens|revogad|anulad/i.test(m.situacao ?? '') ? 'font-semibold text-negative-700' : 'text-gray-700'}>{m.situacao ?? '—'}</span>
                          {m.last_change && <span className="mt-0.5 block text-gray-500">{new Date(m.last_change.at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}: {m.last_change.lines[0]}{m.last_change.lines.length > 1 ? ` (+${m.last_change.lines.length - 1})` : ''}</span>}
                          <span className="block text-[10px] text-gray-400">{m.tracked_at ? `conferido ${new Date(m.tracked_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : 'ainda não conferido'}</span>
                        </td>
                        <td className="pr-2">
                          {o === 'ganhou' ? <span className="font-semibold text-positive-700">Ganhamos{m.won_value ? ` ${fmtBRL(m.won_value)}` : ''}</span> : <span className={o === 'cancelada' ? 'font-semibold text-negative-700' : 'text-gray-700'}>{OUTCOME_LABEL[o]}</span>}
                          <select value="" aria-label="Marcar resultado" onChange={async e => { const v = e.target.value as Outcome; if (!v) return; const r = await setMatchOutcome(m.id, v); if (r.ok) load(); else setErr(r.error ?? 'Não foi possível.') }}
                            className="mt-1 block rounded border border-gray-200 px-1 py-0.5 text-[11px] text-gray-600">
                            <option value="">marcar…</option>
                            {(Object.keys(OUTCOME_LABEL) as Outcome[]).filter(k => k !== o).map(k => <option key={k} value={k}>{k === 'aguardando' ? 'Voltar para o automático' : OUTCOME_LABEL[k]}</option>)}
                          </select>
                        </td>
                        <td className="pr-2">
                          {w ? <button type="button" onClick={() => setSup({ ni: w[0], nome: w.slice(1).join('|') })} className="text-brand-700 hover:underline">{w.slice(1).join('|') || fmtCnpjView(w[0])}</button> : <span className="text-gray-400">—</span>}
                          {m.winners.length > 1 && <span className="text-gray-400"> +{m.winners.length - 1}</span>}
                          {m.homologado_value ? <span className="block text-gray-500">{fmtBRL(m.homologado_value)}</span> : null}
                        </td>
                        <td>{m.contract_id ? <a href={`/contracts/${m.contract_id}`} className="text-brand-700 hover:underline">abrir ›</a> : <span className="text-gray-400">—</span>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="mb-2 text-sm font-semibold text-gray-900">Quem mais ganhou de nós</p>
          {s.rivals.length === 0 ? <p className="text-xs text-gray-500">Aparece quando sair o resultado das licitações que vocês disputaram e não ganharam.</p> : (
            <ul className="divide-y divide-gray-100 text-xs">
              {s.rivals.map(r => <li key={r.ni} className="flex justify-between gap-2 py-1.5"><button type="button" onClick={() => setSup({ ni: r.ni, nome: r.nome })} className="min-w-0 truncate text-left text-brand-700 hover:underline">{r.nome}</button><span className="shrink-0 text-gray-600">{r.n} vez(es)</span></li>)}
            </ul>
          )}
        </section>
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="mb-2 text-sm font-semibold text-gray-900">Por estado</p>
          {s.ufs.length === 0 ? <p className="text-xs text-gray-500">Sem participações ainda.</p> : (
            <ul className="divide-y divide-gray-100 text-xs">
              {s.ufs.map(u => <li key={u.uf} className="flex justify-between gap-2 py-1.5"><span className="text-gray-800">{u.uf}</span><span className="text-gray-600">{u.part} disputada(s) · {u.won} ganha(s) · {fmtBRL(u.valor)}</span></li>)}
            </ul>
          )}
        </section>
      </div>

      <BidRivals onOpen={(ni, nome) => setSup({ ni, nome })} />
      <OwnContracts cnpjs={d.settings.own_cnpjs} />
      <Competitors list={d.competitors} onChange={load} onOpen={(ni, nome) => setSup({ ni, nome })} />
      {isAdmin && <IntelSettings people={people} settings={d.settings} onSaved={load} />}

      {open && <DetailDrawer numero={open} pipelines={pipelines} nowMs={nowMs} onClose={() => { setOpen(null); load() }} />}
      {sup && <SupplierDrawer cnpj={sup.ni} name={sup.nome} onClose={() => { setSup(null); load() }} />}
    </div>
  )
}

function OwnContracts({ cnpjs }: { cnpjs: string[] }) {
  const [sel, setSel] = useState(cnpjs[0] ?? '')
  const [show, setShow] = useState(false)
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-gray-900">Nossos contratos no PNCP</p>
        {cnpjs.length > 1 && (
          <select value={sel} onChange={e => setSel(e.target.value)} aria-label="CNPJ da empresa" className="rounded-lg border border-gray-300 px-2 py-1 text-xs">
            {cnpjs.map(c => <option key={c} value={c}>{fmtCnpjView(c)}</option>)}
          </select>
        )}
      </div>
      {!cnpjs.length
        ? <p className="text-xs text-gray-500">Cadastre os CNPJs da empresa na configuração abaixo (administrador) para ver tudo que vocês ganharam no PNCP, inclusive o que não passou pelo CRM.</p>
        : show ? <SupplierProfileBody key={sel} cnpj={sel} />
          : <button type="button" onClick={() => setShow(true)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">Buscar nossos contratos no PNCP</button>}
    </section>
  )
}

function Competitors({ list, onChange, onOpen }: { list: Intel['competitors']; onChange: () => void; onOpen: (ni: string, nome: string | null) => void }) {
  const [cnpj, setCnpj] = useState('')
  const [look, setLook] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="mb-1 text-sm font-semibold text-gray-900">Concorrentes</p>
      <p className="mb-2 text-xs text-gray-500">Digite o CNPJ para ver os contratos que a empresa ganhou no PNCP: quanto, onde e com quais órgãos.</p>
      <form onSubmit={e => { e.preventDefault(); const d = cnpj.replace(/\D/g, ''); if (d.length !== 14) { setErr('Informe um CNPJ com 14 números.'); return } setErr(null); setLook(d) }} className="flex flex-wrap gap-2">
        <input value={cnpj} onChange={e => setCnpj(e.target.value)} placeholder="00.000.000/0000-00" aria-label="CNPJ do concorrente" className="w-56 rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
        <button type="submit" className="inline-flex items-center gap-1 rounded-lg bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800"><Search className="h-4 w-4" />Analisar</button>
      </form>
      {err && <p className="mt-1 text-xs text-negative-700">{err}</p>}
      {look && <div className="mt-3 rounded-xl border border-gray-100 p-3"><SupplierProfileBody key={look} cnpj={look} canSave onSaved={onChange} /></div>}
      {list.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-xs font-semibold text-gray-700">Acompanhados</p>
          <ul className="divide-y divide-gray-100 text-xs">
            {list.map(c => (
              <li key={c.id} className="flex items-center justify-between gap-2 py-1.5">
                <button type="button" onClick={() => onOpen(c.cnpj, c.name)} className="min-w-0 truncate text-left text-brand-700 hover:underline">{c.name ?? fmtCnpjView(c.cnpj)} <span className="text-gray-400">· {fmtCnpjView(c.cnpj)}</span></button>
                <button type="button" aria-label="Remover concorrente" onClick={async () => { const r = await deleteCompetitor(c.id); if (r.ok) onChange() }} className="rounded p-1 text-gray-400 hover:text-negative-700"><Trash2 className="h-3.5 w-3.5" /></button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-2 text-[11px] text-gray-400">O PNCP publica quem ganhou; participações sem vitória e lances não são publicados.</p>
    </section>
  )
}

function IntelSettings({ people, settings, onSaved }: { people: Opt[]; settings: Intel['settings']; onSaved: () => void }) {
  const [cnpjs, setCnpjs] = useState(settings.own_cnpjs.map(fmtCnpjView).join('\n'))
  const [ids, setIds] = useState<string[]>(settings.recipient_ids)
  const [ch, setCh] = useState({ sino: settings.channels.sino !== false, email: settings.channels.email !== false, whatsapp: settings.channels.whatsapp === true })
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-sm font-semibold text-gray-900">Acompanhamento das licitações que disputamos</p>
      <p className="mb-3 text-xs text-gray-500">Duas vezes ao dia (e logo que vocês decidem disputar) o CRM confere no PNCP as licitações marcadas &ldquo;Vamos participar&rdquo; ou que foram para o funil: suspensão, revogação, mudança de prazo, arquivo novo no edital (retificação, esclarecimento) e, depois da sessão, situação de cada item, vencedor e valor. Quando muda, avisa as pessoas abaixo e o responsável pela licitação.</p>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block text-xs text-gray-700">CNPJs da empresa (um por linha; matriz e filiais)
          <textarea value={cnpjs} onChange={e => setCnpjs(e.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm" placeholder="00.000.000/0001-00" />
        </label>
        <div className="space-y-2 text-xs text-gray-700">
          <p>Quem recebe</p>
          <div className="max-h-32 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-2">
            {people.map(p => (
              <label key={p.id} className="flex items-center gap-2"><input type="checkbox" checked={ids.includes(p.id)} onChange={e => setIds(e.target.checked ? [...ids, p.id] : ids.filter(x => x !== p.id))} />{p.name}</label>
            ))}
          </div>
          <div className="flex flex-wrap gap-3">
            {(['email', 'sino', 'whatsapp'] as const).map(k => (
              <label key={k} className="flex items-center gap-1"><input type="checkbox" checked={ch[k]} onChange={e => setCh({ ...ch, [k]: e.target.checked })} />{k === 'email' ? 'E-mail' : k === 'sino' ? 'Sino' : 'WhatsApp'}</label>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} onClick={async () => { setBusy(true); const r = await saveIntelSettings({ own_cnpjs: cnpjs, recipient_ids: ids, channels: ch }); setBusy(false); setMsg(r.ok ? 'Salvo.' : (r.error ?? 'Não foi possível.')); if (r.ok) onSaved() }}
          className="rounded-lg bg-brand-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-60">Salvar</button>
        <button type="button" onClick={async () => { const r = await trackNow(); setMsg(r.ok ? 'Conferindo no PNCP em segundo plano. O aviso chega no sino quando terminar.' : (r.error ?? 'Não foi possível.')) }}
          className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"><RefreshCw className="h-4 w-4" />Conferir agora</button>
        {msg && <span role="status" className="text-xs text-gray-600">{msg}</span>}
      </div>
    </section>
  )
}

// Concorrentes que mais aparecem nas disputas que a equipe registrou
function BidRivals({ onOpen }: { onOpen: (ni: string, nome: string | null) => void }) {
  const [r, setR] = useState<Extract<Awaited<ReturnType<typeof getBidRivals>>, { ok: true }> | null>(null)
  useEffect(() => {
    let alive = true
    getBidRivals().then(x => { if (alive && x.ok) setR(x) })
    return () => { alive = false }
  }, [])
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="mb-1 text-sm font-semibold text-gray-900">Concorrentes que mais encontramos</p>
      {!r || r.rivals.length === 0
        ? <p className="text-xs text-gray-500">Registre quem disputou em cada licitação (painel da licitação → &ldquo;Quem disputou&rdquo;). Aqui aparecem os concorrentes que mais cruzam com vocês.</p>
        : (
          <>
            <p className="mb-2 text-xs text-gray-500">{r.disputasRegistradas} disputa(s) registrada(s) pela equipe.</p>
            <ul className="divide-y divide-gray-100 text-xs">
              {r.rivals.map(x => (
                <li key={x.cnpj ?? x.name} className="flex justify-between gap-2 py-1.5">
                  {x.cnpj ? <button type="button" onClick={() => onOpen(x.cnpj as string, x.name)} className="min-w-0 truncate text-left text-brand-700 hover:underline">{x.name}</button> : <span className="min-w-0 truncate text-gray-800">{x.name}</span>}
                  <span className="shrink-0 text-gray-600">{x.disputas} disputa(s) · venceu {x.vitorias} · nós vencemos {x.contraNosGanhamos}</span>
                </li>
              ))}
            </ul>
          </>
        )}
    </section>
  )
}
