'use client'

// Marketing → Leads: o inbound. Todo lead que veio até a empresa (formulário,
// anúncio, integração) chega aqui; o marketing qualifica e passa ao comercial.

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { passLeadToCommercial, updateLeadStatus } from '@/lib/actions/leads'
import { channelLabel, inferChannel } from '@/lib/marketing/tracking'
import { fmtPct } from '@/lib/format'

export type InboundLead = {
  id: string; name: string; email: string | null; phone: string | null; company_name: string | null
  status: string; score: number; source: string | null; created_at: string; campaign_id: string | null
  handed_off_at: string | null; utm_source: string | null; utm_medium: string | null; gclid: string | null; fbclid: string | null
}

type View = 'qualificar' | 'passados' | 'descartados'
const STATUS: Record<string, string> = { novo: 'Novo', em_qualificacao: 'Em qualificação', qualificado: 'Qualificado', convertido: 'Convertido', descartado: 'Descartado' }

export function MarketingLeads({ leads, campaigns, people }: { leads: InboundLead[]; campaigns: { id: string; name: string }[]; people: { id: string; name: string }[] }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [view, setView] = useState<View>('qualificar')
  const [passing, setPassing] = useState<string | null>(null)
  const [to, setTo] = useState('')
  const [note, setNote] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const campName = useMemo(() => new Map(campaigns.map(c => [c.id, c.name])), [campaigns])

  const groups = useMemo(() => ({
    qualificar: leads.filter(l => !l.handed_off_at && l.status !== 'descartado'),
    passados: leads.filter(l => !!l.handed_off_at),
    descartados: leads.filter(l => !l.handed_off_at && l.status === 'descartado'),
  }), [leads])
  const rows = groups[view]
  const converted = groups.passados.filter(l => l.status === 'convertido').length

  const act = (fn: () => Promise<{ error?: string }>, ok: string) => start(async () => {
    const r = await fn()
    setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: ok })
    if (!r.error) { setPassing(null); setTo(''); setNote(''); router.refresh() }
  })

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-gray-500">
        Leads <strong>inbound</strong>: vieram até a empresa por formulário, site, anúncio ou integração. O marketing qualifica e clica em
        <strong> Passar para o comercial</strong>; aí o lead aparece na aba Leads do comercial, que converte em oportunidade. Leads de prospecção (outbound) ficam só com o comercial.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Para qualificar" value={String(groups.qualificar.length)} />
        <Stat label="Passados ao comercial" value={String(groups.passados.length)} />
        <Stat label="Viraram oportunidade" value={String(converted)} sub={`${fmtPct(groups.passados.length ? (converted / groups.passados.length) * 100 : null)} dos passados`} />
        <Stat label="Descartados" value={String(groups.descartados.length)} />
      </div>

      <div className="flex gap-1.5">
        {([['qualificar', 'Para qualificar'], ['passados', 'Passados ao comercial'], ['descartados', 'Descartados']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setView(id)} className={`rounded-xl px-3 py-1.5 text-xs font-medium ${view === id ? 'bg-brand-700 text-white' : 'bg-gray-100 text-gray-600'}`}>{label} ({groups[id].length})</button>
        ))}
      </div>
      {msg && <p role="status" className={`text-sm ${msg.ok ? 'text-positive-700' : 'text-red-600'}`}>{msg.text}</p>}

      <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Lead</th>
              <th className="px-3 py-2 text-left font-medium">Empresa</th>
              <th className="px-3 py-2 text-left font-medium">Campanha / canal</th>
              <th className="px-3 py-2 text-left font-medium">Situação</th>
              <th className="px-3 py-2 text-right font-medium">Pontos</th>
              <th className="px-3 py-2 text-right font-medium">Recebido</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map(l => (
              <tr key={l.id} className="align-top">
                <td className="px-3 py-2">
                  <Link href={`/leads/${l.id}`} className="font-medium text-gray-900 hover:underline">{l.name}</Link>
                  <p className="text-xs text-gray-400">{l.email ?? l.phone ?? '—'}</p>
                </td>
                <td className="px-3 py-2 text-xs text-gray-600">{l.company_name ?? '—'}</td>
                <td className="px-3 py-2 text-xs text-gray-600">{l.campaign_id ? campName.get(l.campaign_id) ?? '—' : '—'}<p className="text-gray-400">{channelLabel(inferChannel(l))}</p></td>
                <td className="px-3 py-2 text-xs">{STATUS[l.status] ?? l.status}</td>
                <td className="px-3 py-2 text-right text-xs tabular-nums">{l.score}</td>
                <td className="px-3 py-2 text-right text-xs text-gray-500">{new Date(l.created_at).toLocaleDateString('pt-BR')}</td>
                <td className="px-3 py-2 text-right text-xs">
                  {view === 'qualificar' && passing !== l.id && (
                    <div className="flex flex-col items-end gap-1">
                      <button onClick={() => { setPassing(l.id); setMsg(null) }} className="rounded-md bg-brand-700 px-2.5 py-1 font-medium text-white hover:bg-brand-800">Passar para o comercial</button>
                      <span className="flex gap-2">
                        {l.status === 'novo' && <button disabled={pending} onClick={() => act(() => updateLeadStatus(l.id, 'em_qualificacao'), 'Em qualificação.')} className="text-brand-700 hover:underline">Em qualificação</button>}
                        <button disabled={pending} onClick={() => act(() => updateLeadStatus(l.id, 'descartado'), 'Lead descartado.')} className="text-gray-500 hover:underline">Descartar</button>
                      </span>
                    </div>
                  )}
                  {view === 'qualificar' && passing === l.id && (
                    <div className="flex w-64 flex-col gap-1.5 rounded-lg border border-gray-200 bg-gray-50 p-2 text-left">
                      <select value={to} onChange={e => setTo(e.target.value)} className="rounded border border-gray-300 px-2 py-1">
                        <option value="">Quem atende (Hunter)</option>
                        {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                      <input value={note} onChange={e => setNote(e.target.value)} placeholder="Observação (opcional)" className="rounded border border-gray-300 px-2 py-1" />
                      <div className="flex gap-2">
                        <button disabled={pending} onClick={() => act(() => passLeadToCommercial(l.id, to || null, note), 'Passado ao comercial.')} className="rounded bg-brand-700 px-2 py-1 font-medium text-white disabled:opacity-50">Passar</button>
                        <button onClick={() => setPassing(null)} className="text-gray-500">Cancelar</button>
                      </div>
                    </div>
                  )}
                  {view === 'descartados' && <button disabled={pending} onClick={() => act(() => updateLeadStatus(l.id, 'em_qualificacao'), 'Lead reaberto.')} className="text-brand-700 hover:underline">Reabrir</button>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-sm text-gray-400">Nada aqui.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-gray-900">{value}</p>
      {sub && <p className="text-[11px] text-gray-500">{sub}</p>}
    </div>
  )
}
