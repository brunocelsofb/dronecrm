'use client'

// Tela Marketing: Resultados (investimento → leads → oportunidades → ganhos →
// faturado), Campanhas (cadastro + investimento por mês) e Links (link da
// campanha e formulário do site com a origem).

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { fmtBRL, fmtPct, fmtNum1 } from '@/lib/format'
import { CHANNELS, channelLabel, campaignCode } from '@/lib/marketing/tracking'
import type { MkRow } from '@/lib/marketing/report'
import { MarketingGuide } from './marketing-guide'
import { IntegrationsCenter, type IntegrationRow } from './integrations-center'
import type { CampaignFull } from '@/lib/marketing/data'
import { saveCampaign, deleteCampaign, saveCampaignCost, type CampaignInput } from '@/lib/actions/marketing'

type Report = { campaignRows: MkRow[]; channelOnlyRows: MkRow[]; channels: MkRow[]; totals: MkRow; unattributedOpps: number }
type Props = {
  year: number; month: number | null; nowYear: number; nowMonth: number
  tab: 'resultados' | 'campanhas' | 'links' | 'guia' | 'integracoes'
  integrations: IntegrationRow[]
  campaigns: CampaignFull[]
  costs: { campaign_id: string; year: number; month: number; amount: number }[]
  report: Report
  people: { id: string; name: string }[]
  baseUrl: string
  slug: string | null
  canSeeContracts: boolean
}

const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
const MON = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const STATUS: Record<string, { label: string; cls: string }> = {
  planejada: { label: 'Planejada', cls: 'bg-gray-100 text-gray-600' },
  ativa: { label: 'Ativa', cls: 'bg-positive-100 text-positive-700' },
  pausada: { label: 'Pausada', cls: 'bg-warn-600/15 text-warn-700' },
  encerrada: { label: 'Encerrada', cls: 'bg-gray-100 text-gray-500' },
}
const AUDIENCE: Record<string, string> = { novos: 'Novos clientes', clientes: 'Clientes atuais (carteira)', ambos: 'Novos e atuais' }
const roasTxt = (v: number | null) => (v === null ? '—' : `${fmtNum1(v)}x`)
const parseBR = (v: string) => Number(v.replace(/\s|R\$/g, '').replace(/\./g, '').replace(',', '.'))

export function MarketingView(p: Props) {
  const router = useRouter()
  const go = (q: Record<string, string>) => {
    const params = new URLSearchParams({ ano: String(p.year), mes: p.month === null ? 'ano' : String(p.month), aba: p.tab, ...q })
    router.push(`/marketing?${params.toString()}`)
  }
  const years = Array.from({ length: 4 }, (_, i) => p.nowYear - i)
  const periodLabel = p.month === null ? `Ano de ${p.year}` : `${MONTHS[p.month - 1]}/${p.year}`

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Marketing</h1>
          <p className="text-sm text-gray-500">Cada campanha ligada ao resultado: investimento, leads, oportunidades, ganhos e faturado.</p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <select aria-label="Mês" value={p.month === null ? 'ano' : String(p.month)} onChange={e => go({ mes: e.target.value })}
            className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-gray-800">
            <option value="ano">Ano todo</option>
            {MONTHS.map((m, i) => <option key={m} value={i + 1} disabled={p.year === p.nowYear && i + 1 > p.nowMonth}>{m}</option>)}
          </select>
          <select aria-label="Ano" value={p.year} onChange={e => go({ ano: e.target.value, mes: Number(e.target.value) === p.nowYear ? String(p.nowMonth) : 'ano' })}
            className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-gray-800">
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      <nav className="flex gap-1 overflow-x-auto border-b border-gray-200 text-sm" aria-label="Seções">
        {([['resultados', 'Resultados'], ['campanhas', `Campanhas (${p.campaigns.length})`], ['links', 'Links e formulário'], ['integracoes', 'Integrações'], ['guia', 'Como funciona']] as const).map(([id, label]) => (
          <button key={id} onClick={() => go({ aba: id })}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 ${p.tab === id ? 'border-brand-700 font-medium text-brand-800' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
            {label}
          </button>
        ))}
      </nav>

      {p.tab === 'resultados' && <Results report={p.report} periodLabel={periodLabel} hasCampaigns={p.campaigns.length > 0} onNew={() => go({ aba: 'campanhas' })} />}
      {p.tab === 'campanhas' && <Campaigns {...p} />}
      {p.tab === 'links' && <Links campaigns={p.campaigns} baseUrl={p.baseUrl} slug={p.slug} />}
      {p.tab === 'integracoes' && <IntegrationsCenter rows={p.integrations} campaigns={p.campaigns} baseUrl={p.baseUrl} />}
      {p.tab === 'guia' && <MarketingGuide />}
    </div>
  )
}

// ─── Resultados ─────────────────────────────────────────────────────────────
function Results({ report, periodLabel, hasCampaigns, onNew }: { report: Report; periodLabel: string; hasCampaigns: boolean; onNew: () => void }) {
  const t = report.totals
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Card label="Investimento" value={fmtBRL(t.invest)} hint={periodLabel} />
        <Card label="Leads" value={String(t.leads)} hint={`custo por lead ${fmtBRL(t.cpl)}`} />
        <Card label="Oportunidades" value={String(t.opps)} hint={`${fmtPct(t.leadToOpp)} dos leads`} />
        <Card label="Ganhos" value={String(t.won)} hint={`${fmtBRL(t.wonValue)} · ${fmtPct(t.oppToWon)} das oport.`} />
        <Card label="Faturado" value={fmtBRL(t.invoiced)} hint="mesma regra da meta" tone="good" />
        <Card label="Retorno (ROAS)" value={roasTxt(t.roas)} hint={`faturado ÷ investimento · CAC ${fmtBRL(t.cac)}`} tone="brand" />
      </div>

      {!hasCampaigns && (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-center">
          <p className="text-sm font-medium text-gray-900">Nenhuma campanha cadastrada ainda</p>
          <p className="mt-1 text-xs text-gray-500">Cadastre a campanha, use o link dela no anúncio e os leads, oportunidades e o faturado aparecem aqui sozinhos.</p>
          <button onClick={onNew} className="mt-3 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800">+ Nova campanha</button>
          <p className="mt-2 text-xs text-gray-500">Primeira vez? Veja a aba <strong>Como funciona</strong>.</p>
        </div>
      )}

      <Table title="Por campanha" rows={report.campaignRows} first="Campanha" nameOf={r => (
        <span className="flex flex-col">
          <span className="font-medium text-gray-900">{r.name}</span>
          <span className="text-[11px] text-gray-400">{channelLabel(r.channel)}{r.audience ? ` · ${AUDIENCE[r.audience] ?? r.audience}` : ''}</span>
        </span>
      )} />
      {report.channelOnlyRows.length > 0 && (
        <Table title="Leads sem campanha cadastrada (canal deduzido do link ou do formulário)" rows={report.channelOnlyRows} first="Canal" nameOf={r => channelLabel(r.channel)} noInvest />
      )}
      <Table title="Por canal" rows={report.channels} first="Canal" nameOf={r => channelLabel(r.channel)} />

      <p className="text-xs text-gray-500">
        Conta o que aconteceu no período: leads e oportunidades criados, ganhos fechados, faturado e investimento lançado.
        {report.unattributedOpps > 0 && ` ${report.unattributedOpps} oportunidade(s) do período sem origem de marketing (criadas direto, sem lead nem campanha) não entram aqui.`}
      </p>
    </div>
  )
}

function Table({ title, rows, first, nameOf, noInvest }: { title: string; rows: MkRow[]; first: string; nameOf: (r: MkRow) => React.ReactNode; noInvest?: boolean }) {
  if (!rows.length) return null
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
      <p className="border-b border-gray-100 px-4 py-2.5 text-sm font-semibold text-gray-900">{title}</p>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium">{first}</th>
              {!noInvest && <th className="px-3 py-2 text-right font-medium">Investimento</th>}
              <th className="px-3 py-2 text-right font-medium">Leads</th>
              {!noInvest && <th className="px-3 py-2 text-right font-medium">Custo/lead</th>}
              <th className="px-3 py-2 text-right font-medium">Oport.</th>
              <th className="px-3 py-2 text-right font-medium">Lead→oport.</th>
              <th className="px-3 py-2 text-right font-medium">Ganhos</th>
              <th className="px-3 py-2 text-right font-medium">Valor ganho</th>
              {!noInvest && <th className="px-3 py-2 text-right font-medium">CAC</th>}
              <th className="px-3 py-2 text-right font-medium">Faturado</th>
              {!noInvest && <th className="px-3 py-2 text-right font-medium">ROAS</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 whitespace-nowrap tabular-nums">
            {rows.map(r => (
              <tr key={r.key} className="hover:bg-gray-50">
                <td className="min-w-44 whitespace-normal px-3 py-2">{nameOf(r)}</td>
                {!noInvest && <td className="px-3 py-2 text-right">{fmtBRL(r.invest)}</td>}
                <td className="px-3 py-2 text-right">{r.leads}</td>
                {!noInvest && <td className="px-3 py-2 text-right">{fmtBRL(r.cpl)}</td>}
                <td className="px-3 py-2 text-right">{r.opps}</td>
                <td className="px-3 py-2 text-right">{fmtPct(r.leadToOpp)}</td>
                <td className="px-3 py-2 text-right">{r.won}</td>
                <td className="px-3 py-2 text-right">{fmtBRL(r.wonValue)}</td>
                {!noInvest && <td className="px-3 py-2 text-right">{fmtBRL(r.cac)}</td>}
                <td className="px-3 py-2 text-right font-medium text-gray-900">{fmtBRL(r.invoiced)}</td>
                {!noInvest && <td className="px-3 py-2 text-right">{roasTxt(r.roas)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Card({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: 'brand' | 'good' }) {
  const cls = tone === 'brand' ? 'bg-brand-700 text-white' : tone === 'good' ? 'bg-positive-600 text-white' : 'border border-gray-200 bg-white text-gray-900'
  const sub = tone ? 'text-white/80' : 'text-gray-500'
  return (
    <div className={`rounded-2xl p-4 ${cls}`}>
      <p className={`text-[10px] font-semibold uppercase tracking-wide ${sub}`}>{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      <p className={`mt-0.5 text-[11px] ${sub}`}>{hint}</p>
    </div>
  )
}

// ─── Campanhas ──────────────────────────────────────────────────────────────
const EMPTY: CampaignInput = { name: '', channel: 'meta', audience: 'novos', status: 'ativa', utm_campaign: '', objective: '', start_date: '', end_date: '', budget: null, owner_id: '', notes: '' }

function Campaigns(p: Props) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [editing, setEditing] = useState<CampaignInput | null>(null)
  const [budgetTxt, setBudgetTxt] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [costsOpen, setCostsOpen] = useState<string | null>(null)
  const rowById = useMemo(() => new Map(p.report.campaignRows.map(r => [r.campaignId, r])), [p.report.campaignRows])
  const spentYear = useMemo(() => {
    const m: Record<string, number> = {}
    for (const c of p.costs) if (c.year === p.year) m[c.campaign_id] = (m[c.campaign_id] ?? 0) + c.amount
    return m
  }, [p.costs, p.year])

  const open = (c?: CampaignFull) => {
    setMsg(null)
    if (!c) { setEditing({ ...EMPTY }); setBudgetTxt(''); return }
    setEditing({ id: c.id, name: c.name, channel: c.channel, audience: c.audience, status: c.status, utm_campaign: c.utm_campaign, objective: c.objective ?? '', start_date: c.start_date ?? '', end_date: c.end_date ?? '', budget: c.budget, owner_id: c.owner_id ?? '', notes: c.notes ?? '' })
    setBudgetTxt(c.budget !== null ? String(c.budget).replace('.', ',') : '')
  }
  const save = () => {
    if (!editing) return
    const budget = budgetTxt.trim() ? parseBR(budgetTxt) : null
    if (budget !== null && !Number.isFinite(budget)) { setMsg({ ok: false, text: 'Verba inválida.' }); return }
    start(async () => {
      const r = await saveCampaign({ ...editing, budget })
      if (r.ok) { setMsg({ ok: true, text: 'Campanha salva.' }); setEditing(null); router.refresh() }
      else setMsg({ ok: false, text: r.error })
    })
  }
  const remove = (c: CampaignFull) => {
    if (!window.confirm(`Excluir a campanha "${c.name}"?`)) return
    start(async () => {
      const r = await deleteCampaign(c.id)
      setMsg(r.ok ? { ok: true, text: 'Campanha excluída.' } : { ok: false, text: r.error })
      if (r.ok) router.refresh()
    })
  }
  const set = (k: keyof CampaignInput, v: string) => setEditing(e => (e ? { ...e, [k]: v } : e))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-gray-500">Use o <strong>código do link</strong> da campanha no anúncio (Links e formulário) para os leads entrarem ligados a ela.</p>
        {!editing && <button onClick={() => open()} className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800">+ Nova campanha</button>}
      </div>
      {msg && <p role="status" className={`text-sm ${msg.ok ? 'text-positive-700' : 'text-red-600'}`}>{msg.text}</p>}

      {editing && (
        <div className="grid gap-3 rounded-2xl border border-brand-700/30 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Nome *" className="sm:col-span-2">
            <input value={editing.name} onChange={e => set('name', e.target.value)} className="input" placeholder="Ex.: Engenharia clínica — hospitais SP" />
          </Field>
          <Field label="Canal">
            <select value={editing.channel} onChange={e => set('channel', e.target.value)} className="input">
              {CHANNELS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </Field>
          <Field label="Situação">
            <select value={editing.status} onChange={e => set('status', e.target.value)} className="input">
              {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </Field>
          <Field label="Público">
            <select value={editing.audience} onChange={e => set('audience', e.target.value)} className="input">
              {Object.entries(AUDIENCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Código do link (utm_campaign)">
            <input value={editing.utm_campaign ?? ''} onChange={e => set('utm_campaign', e.target.value)} className="input font-mono"
              placeholder={campaignCode(editing.name) || 'gerado pelo nome'} />
          </Field>
          <Field label="Início"><input type="date" value={editing.start_date ?? ''} onChange={e => set('start_date', e.target.value)} className="input" /></Field>
          <Field label="Fim"><input type="date" value={editing.end_date ?? ''} onChange={e => set('end_date', e.target.value)} className="input" /></Field>
          <Field label="Verba prevista (R$)"><input inputMode="decimal" value={budgetTxt} onChange={e => setBudgetTxt(e.target.value)} className="input" placeholder="0,00" /></Field>
          <Field label="Responsável">
            <select value={editing.owner_id ?? ''} onChange={e => set('owner_id', e.target.value)} className="input">
              <option value="">—</option>
              {p.people.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </Field>
          <Field label="Objetivo" className="sm:col-span-2">
            <input value={editing.objective ?? ''} onChange={e => set('objective', e.target.value)} className="input" placeholder="Ex.: 30 leads de hospitais privados" />
          </Field>
          <Field label="Observações" className="sm:col-span-2 lg:col-span-4">
            <textarea rows={2} value={editing.notes ?? ''} onChange={e => set('notes', e.target.value)} className="input" />
          </Field>
          <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-4">
            <button disabled={pending} onClick={save} className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">{pending ? 'Salvando…' : 'Salvar'}</button>
            <button onClick={() => setEditing(null)} className="text-sm text-gray-500 hover:underline">Cancelar</button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {p.campaigns.map(c => {
          const r = rowById.get(c.id)
          return (
            <div key={c.id} className="rounded-2xl border border-gray-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-medium text-gray-900">
                    {c.name}
                    <span className={`rounded-full px-2 py-0.5 text-[11px] ${STATUS[c.status]?.cls ?? ''}`}>{STATUS[c.status]?.label ?? c.status}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {channelLabel(c.channel)} · {AUDIENCE[c.audience] ?? c.audience} · código <code className="rounded bg-gray-100 px-1">{c.utm_campaign}</code>
                    {c.start_date && ` · ${c.start_date.split('-').reverse().join('/')}`}{c.end_date && ` a ${c.end_date.split('-').reverse().join('/')}`}
                  </p>
                  {c.objective && <p className="mt-1 text-xs text-gray-600">🎯 {c.objective}</p>}
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <button onClick={() => setCostsOpen(costsOpen === c.id ? null : c.id)} className="text-brand-700 hover:underline">Investimento por mês</button>
                  <button onClick={() => open(c)} className="text-brand-700 hover:underline">Editar</button>
                  <button disabled={pending} onClick={() => remove(c)} className="text-gray-500 hover:underline">Excluir</button>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-6">
                <Mini label={`Investido em ${p.year}`} value={fmtBRL(spentYear[c.id] ?? 0)} sub={c.budget !== null ? `verba ${fmtBRL(c.budget)}` : undefined} />
                <Mini label="Leads (período)" value={String(r?.leads ?? 0)} />
                <Mini label="Oportunidades" value={String(r?.opps ?? 0)} />
                <Mini label="Ganhos" value={String(r?.won ?? 0)} />
                <Mini label="Faturado" value={fmtBRL(r?.invoiced ?? 0)} />
                <Mini label="ROAS" value={roasTxt(r?.roas ?? null)} />
              </div>
              {costsOpen === c.id && <CostGrid campaignId={c.id} year={p.year} nowYear={p.nowYear} nowMonth={p.nowMonth} costs={p.costs.filter(x => x.campaign_id === c.id && x.year === p.year)} />}
            </div>
          )
        })}
        {p.campaigns.length === 0 && !editing && <p className="rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">Nenhuma campanha ainda.</p>}
      </div>
      <style>{`.input{margin-top:.25rem;width:100%;border-radius:.375rem;border:1px solid rgb(209 213 219);padding:.375rem .625rem;font-size:.875rem}.input:focus{outline:none;border-color:var(--color-brand-700)}`}</style>
    </div>
  )
}

function CostGrid({ campaignId, year, nowYear, nowMonth, costs }: { campaignId: string; year: number; nowYear: number; nowMonth: number; costs: { month: number; amount: number }[] }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [vals, setVals] = useState<Record<number, string>>(() => Object.fromEntries(costs.map(c => [c.month, String(c.amount).replace('.', ',')])))
  const [msg, setMsg] = useState<string | null>(null)
  const saveMonth = (m: number) => {
    const raw = (vals[m] ?? '').trim()
    const amount = raw ? parseBR(raw) : 0
    if (!Number.isFinite(amount) || amount < 0) { setMsg(`${MON[m - 1]}: valor inválido.`); return }
    const before = costs.find(c => c.month === m)?.amount ?? 0
    if (Math.abs(before - amount) < 0.005) return
    start(async () => {
      const r = await saveCampaignCost({ campaignId, year, month: m, amount })
      setMsg(r.ok ? `${MON[m - 1]}/${year} salvo.` : r.error)
      if (r.ok) router.refresh()
    })
  }
  return (
    <div className="mt-3 rounded-xl bg-gray-50 p-3">
      <p className="text-xs text-gray-600">Quanto foi gasto em cada mês de {year} (o que saiu na fatura do Meta, Google etc.). Salva ao sair do campo.</p>
      <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-12">
        {MON.map((label, i) => {
          const m = i + 1
          const future = year > nowYear || (year === nowYear && m > nowMonth)
          return (
            <label key={m} className="text-[11px] text-gray-500">
              {label}
              <input inputMode="decimal" disabled={future || pending} value={vals[m] ?? ''} placeholder="0,00"
                onChange={e => setVals(v => ({ ...v, [m]: e.target.value }))} onBlur={() => saveMonth(m)}
                className="mt-0.5 w-full rounded border border-gray-300 bg-white px-1.5 py-1 text-xs tabular-nums disabled:bg-gray-100" />
            </label>
          )
        })}
      </div>
      {msg && <p role="status" className="mt-1 text-xs text-gray-600">{msg}</p>}
    </div>
  )
}

function Mini({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-gray-50 px-2.5 py-1.5">
      <p className="text-[10px] uppercase tracking-wide text-gray-400">{label}</p>
      <p className="font-medium tabular-nums text-gray-900">{value}</p>
      {sub && <p className="text-[10px] text-gray-400">{sub}</p>}
    </div>
  )
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return <label className={`block text-xs font-medium text-gray-700 ${className ?? ''}`}>{label}{children}</label>
}

// ─── Links e formulário ─────────────────────────────────────────────────────
function Links({ campaigns, baseUrl, slug }: { campaigns: CampaignFull[]; baseUrl: string; slug: string | null }) {
  const active = campaigns.filter(c => c.status !== 'encerrada')
  const [campId, setCampId] = useState(active[0]?.id ?? '')
  const [dest, setDest] = useState('')
  const [content, setContent] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const camp = campaigns.find(c => c.id === campId) ?? null
  const ch = CHANNELS.find(c => c.id === camp?.channel)

  const utm = new URLSearchParams()
  if (camp) {
    utm.set('utm_source', ch?.utmSource ?? camp.channel)
    utm.set('utm_medium', ch?.utmMedium ?? 'outro')
    utm.set('utm_campaign', camp.utm_campaign)
    if (content.trim()) utm.set('utm_content', campaignCode(content))
  }
  const captureLink = slug && camp ? `${baseUrl}/captura?empresa=${encodeURIComponent(slug)}&${utm.toString()}` : ''
  let siteLink = ''
  if (camp && /^https?:\/\//i.test(dest.trim())) {
    try { const u = new URL(dest.trim()); utm.forEach((v, k) => u.searchParams.set(k, v)); siteLink = u.toString() } catch { siteLink = '' }
  }
  const endpoint = slug ? `${baseUrl}/api/public/lead?empresa=${encodeURIComponent(slug)}` : ''
  const snippet = endpoint ? `<form action="${endpoint}" method="POST">
  <input name="name" placeholder="Nome" required>
  <input name="email" type="email" placeholder="E-mail">
  <input name="phone" placeholder="Telefone">
  <input name="company_name" placeholder="Empresa" required>
  <input name="cnpj" placeholder="CNPJ" required>
  <textarea name="message" placeholder="Como podemos ajudar?"></textarea>
  <input type="hidden" name="_next" value="https://SEU-SITE/obrigado">
  <div style="position:absolute;left:-10000px" aria-hidden="true"><input name="website" tabindex="-1" autocomplete="off"></div>
  <button type="submit">Enviar</button>
</form>
<script>
  // Copia a origem do endereço (UTM, gclid, fbclid) para o formulário
  (function () {
    var q = new URLSearchParams(location.search), f = document.currentScript.previousElementSibling;
    ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','gclid','fbclid'].forEach(function (k) {
      if (q.get(k)) { var i = document.createElement('input'); i.type = 'hidden'; i.name = k; i.value = q.get(k); f.appendChild(i); }
    });
    var p = document.createElement('input'); p.type = 'hidden'; p.name = 'landing_page'; p.value = location.href; f.appendChild(p);
    var r = document.createElement('input'); r.type = 'hidden'; r.name = 'referrer'; r.value = document.referrer; f.appendChild(r);
  })();
</script>` : ''

  const copy = async (id: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(id); setTimeout(() => setCopied(null), 1500) } catch { setCopied(null) }
  }

  if (!slug) {
    return <p className="rounded-xl bg-warn-600/15 p-4 text-sm text-warn-700">Sua empresa ainda não tem um identificador público (slug). Peça ao administrador da plataforma para cadastrar — sem ele o link não sabe para qual empresa o lead vai.</p>
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-4">
        <p className="text-sm font-semibold text-gray-900">1. Link da campanha</p>
        <p className="text-xs text-gray-500">Cole este link no anúncio (Meta, Google, LinkedIn), no e-mail ou no QR Code do evento. Quem preencher entra como lead já ligado à campanha.</p>
        {active.length === 0 ? (
          <p className="text-sm text-gray-500">Cadastre uma campanha primeiro (aba Campanhas).</p>
        ) : (
          <>
            <label className="text-xs font-medium text-gray-700">Campanha
              <select value={campId} onChange={e => setCampId(e.target.value)} className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm">
                {active.map(c => <option key={c.id} value={c.id}>{c.name} · {channelLabel(c.channel)}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-gray-700">Variação do anúncio (opcional — utm_content)
              <input value={content} onChange={e => setContent(e.target.value)} placeholder="ex.: video-1, carrossel-b" className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm" />
            </label>
            <CopyBox id="cap" label="Formulário do CRM (pronto para usar)" text={captureLink} copied={copied} onCopy={copy} />
            <label className="text-xs font-medium text-gray-700">Ou: página do seu site (cole o endereço)
              <input value={dest} onChange={e => setDest(e.target.value)} placeholder="https://www.seusite.com.br/servicos" className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm" />
            </label>
            {siteLink && <CopyBox id="site" label="Página do site com a origem" text={siteLink} copied={copied} onCopy={copy} />}
            {siteLink && <p className="text-[11px] text-gray-500">Para a página do site entregar o lead ao CRM, o formulário dela precisa usar o código do item 2.</p>}
          </>
        )}
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-4">
        <p className="text-sm font-semibold text-gray-900">2. Formulário do seu site</p>
        <p className="text-xs text-gray-500">
          Para quem cuida do site: este formulário manda o lead direto para o CRM, com a origem (UTM, gclid do Google, fbclid do Meta).
          Também serve para Zapier/Make (enviar JSON para o mesmo endereço).
        </p>
        <CopyBox id="end" label="Endereço que recebe os leads (POST)" text={endpoint} copied={copied} onCopy={copy} />
        <CopyBox id="html" label="Código HTML do formulário" text={snippet} copied={copied} onCopy={copy} multiline />
        <p className="text-[11px] text-gray-500">Troque <code>https://SEU-SITE/obrigado</code> pela página de agradecimento do site. Campos obrigatórios: nome, empresa e CNPJ.</p>
      </div>
    </div>
  )
}

function CopyBox({ id, label, text, copied, onCopy, multiline }: { id: string; label: string; text: string; copied: string | null; onCopy: (id: string, t: string) => void; multiline?: boolean }) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-700">{label}</span>
        <button onClick={() => onCopy(id, text)} disabled={!text} className="text-xs text-brand-700 hover:underline disabled:opacity-40">{copied === id ? 'Copiado ✓' : 'Copiar'}</button>
      </div>
      {multiline
        ? <pre className="mt-1 max-h-64 overflow-auto rounded-lg bg-gray-900 p-3 text-[11px] leading-relaxed text-gray-100">{text}</pre>
        : <p className="mt-1 break-all rounded-lg bg-gray-50 px-2.5 py-2 font-mono text-[11px] text-gray-800">{text || '—'}</p>}
    </div>
  )
}
