'use client'

import Link from 'next/link'
import { Fragment, useState, useTransition } from 'react'
import { ChevronDown, ChevronRight, MessageCircle } from 'lucide-react'
import { SDR_STATUS_LABEL } from '@/lib/sdr/settings'
import { takeOverSdr } from '@/lib/actions/sdr'

export type SdrRow = {
  id: string; phone: string; instance_name: string; status: string; contact_name: string | null
  lead_id: string | null; assigned_to: string | null; answers: Record<string, unknown> | null
  summary: string | null; end_reason: string | null; ai_replies: number
  input_tokens: number; output_tokens: number; last_error: string | null; started_at: string; ended_at: string | null
}

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-brand-100 text-brand-800',
  handed_off: 'bg-positive-100 text-positive-700',
  routed: 'bg-gray-100 text-gray-700',
  human: 'bg-gray-100 text-gray-700',
  disqualified: 'bg-negative-100 text-negative-700',
  error: 'bg-warn-100 text-warn-700',
}

const fmtDate = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const fmtPhone = (p: string) => { const d = p.replace(/\D/g, ''); return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : p }

function Answers({ a }: { a: Record<string, unknown> | null }) {
  if (!a) return null
  const base = (['nome', 'empresa', 'cargo', 'email', 'cnpj', 'cidade'] as const).filter(k => typeof a[k] === 'string')
  const r = (a.respostas && typeof a.respostas === 'object' ? a.respostas : {}) as Record<string, string>
  if (!base.length && !Object.keys(r).length) return <p className="text-xs text-gray-500">Nada registrado ainda.</p>
  return (
    <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
      {base.map(k => <div key={k}><dt className="inline font-medium capitalize text-gray-600">{k}: </dt><dd className="inline text-gray-800">{String(a[k])}</dd></div>)}
      {Object.entries(r).map(([q, v]) => <div key={q} className="sm:col-span-2"><dt className="inline font-medium text-gray-600">{q} </dt><dd className="inline text-gray-800">→ {v}</dd></div>)}
    </dl>
  )
}

export function SdrConversations({ rows, names, canSeeLeads }: { rows: SdrRow[]; names: Record<string, string>; canSeeLeads: boolean }) {
  const [open, setOpen] = useState<string | null>(null)
  const [filter, setFilter] = useState<string>('todas')
  const [err, setErr] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const shown = filter === 'todas' ? rows : rows.filter(r => r.status === filter)

  function takeOver(id: string) {
    setErr(null)
    start(async () => {
      const r = await takeOverSdr(id)
      if (!r.ok) setErr(r.error)
    })
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 p-3">
        {['todas', ...Object.keys(SDR_STATUS_LABEL)].map(st => (
          <button key={st} type="button" onClick={() => setFilter(st)}
            className={`rounded-full px-2.5 py-1 text-xs ${filter === st ? 'bg-brand-700 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
            {st === 'todas' ? 'Todas' : SDR_STATUS_LABEL[st]}
          </button>
        ))}
        {err && <span className="text-xs text-negative-700">{err}</span>}
      </div>
      {shown.length === 0 ? (
        <p className="p-6 text-center text-sm text-gray-500">Nenhuma conversa neste mês{filter !== 'todas' ? ' com esse status' : ''}.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                <th className="w-6 px-3 py-2" />
                <th className="px-3 py-2 font-medium">Contato</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Resultado</th>
                <th className="px-3 py-2 font-medium">Vendedor</th>
                <th className="px-3 py-2 font-medium">Respostas</th>
                <th className="px-3 py-2 font-medium">Início</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {shown.map(r => {
                const isOpen = open === r.id
                const a = r.answers ?? {}
                const who = (typeof a.nome === 'string' && a.nome) || r.contact_name || fmtPhone(r.phone)
                const company = typeof a.empresa === 'string' ? a.empresa : null
                return (
                  <Fragment key={r.id}>
                    <tr className="border-b border-gray-50 align-top hover:bg-gray-50">
                      <td className="px-3 py-2">
                        <button type="button" onClick={() => setOpen(isOpen ? null : r.id)} aria-label={isOpen ? 'Fechar detalhes' : 'Ver detalhes'} className="text-gray-400 hover:text-gray-700">
                          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        <p className="font-medium text-gray-900">{who}</p>
                        <p className="text-xs text-gray-500">{company ? `${company} · ` : ''}{fmtPhone(r.phone)}</p>
                      </td>
                      <td className="px-3 py-2"><span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[r.status] ?? 'bg-gray-100 text-gray-700'}`}>{SDR_STATUS_LABEL[r.status] ?? r.status}</span></td>
                      <td className="max-w-[280px] px-3 py-2 text-xs text-gray-700">
                        <p className="line-clamp-2">{r.end_reason ?? (r.status === 'active' ? 'Qualificando…' : '—')}</p>
                        {r.lead_id && canSeeLeads && <Link href={`/leads/${r.lead_id}`} className="text-brand-700 hover:underline">Abrir lead</Link>}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-700">{r.assigned_to ? names[r.assigned_to] ?? '—' : '—'}</td>
                      <td className="px-3 py-2 text-xs text-gray-700">{r.ai_replies}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-700">{fmtDate(r.started_at)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        <Link href={`/whatsapp?phone=${encodeURIComponent(r.phone)}&instance=${encodeURIComponent(r.instance_name)}`}
                          className="mr-2 inline-flex items-center gap-1 text-xs text-brand-700 hover:underline"><MessageCircle size={12} /> Conversa</Link>
                        {r.status === 'active' && (
                          <button type="button" disabled={pending} onClick={() => takeOver(r.id)}
                            className="rounded-md border border-brand-700 px-2 py-0.5 text-xs font-medium text-brand-700 hover:bg-brand-100 disabled:opacity-50">Assumir</button>
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-gray-100 bg-gray-50">
                        <td />
                        <td colSpan={7} className="space-y-2 px-3 py-3">
                          {r.summary && <p className="whitespace-pre-wrap text-xs text-gray-800"><strong>Resumo para o vendedor:</strong> {r.summary}</p>}
                          <Answers a={r.answers} />
                          {r.last_error && <p className="text-xs text-negative-700">Último erro: {r.last_error}</p>}
                          <p className="text-[11px] text-gray-500">Consumo: {(r.input_tokens + r.output_tokens).toLocaleString('pt-BR')} tokens · número {r.instance_name || '—'}{r.ended_at ? ` · encerrada ${fmtDate(r.ended_at)}` : ''}</p>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
