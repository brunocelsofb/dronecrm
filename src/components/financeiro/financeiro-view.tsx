'use client'

// Tela Financeiro: por mês, cada contrato com em contrato → apurado → enviado →
// faturado, as pendências (confirmar recorrência, relatório de medição até o
// dia N) e as ações (enviar, lançar faturado, cancelar).

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { fmtBRL } from '@/lib/format'
import type { FinanceRow } from '@/lib/revenue/dashboard-compute'
import { sendToBilling, sendManyToBilling, markInvoiced, cancelSubmission, saveBillingFlowStart, generateBillingReturnKey } from '@/lib/actions/billing-flow'
import { saveRecurringDiscount } from '@/lib/actions/measurements'
import { ERP_LABEL, type ErpProvider } from '@/lib/erp/connectors'

type Line = { contractId: string; client: string; number: string; value: number; note?: string }
type Part = { total: number; lines: Line[] }
type Props = {
  year: number; month: number; nowYear: number; nowMonth: number
  revenue: {
    potential: number; apurado: number; sent: number; invoiced: number; gap: number
    avulsoSent: number; avulsoInvoiced: number; avulsoTotal: number; flow: boolean
    parts: Record<'discounts' | 'glosas' | 'below' | 'pending' | 'pendingConfirm' | 'above' | 'notSent' | 'notInvoiced' | 'invoiceDiff', Part>
  }
  rows: FinanceRow[]
  owners: Record<string, { id: string | null; name: string }>
  errors: { id: string; contract_id: string; source_type: string; erp_error: string | null; client: string }[]
  me: { id: string; isAdmin: boolean }
  due: { iso: string; overdue: boolean; day: number }
  erp: { provider: ErpProvider; flowStart: string | null; hasReturnKey: boolean }
}

const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
const KIND: Record<FinanceRow['kind'], string> = { recorrente: '$ Recorrente', medicao: '📏 Medição', avulso: 'Avulso' }
const STATE: Record<FinanceRow['state'], { label: string; cls: string }> = {
  pendente_confirmacao: { label: 'Confirmar recorrência', cls: 'bg-warn-600/15 text-warn-700' },
  sem_medicao: { label: 'Sem medição', cls: 'bg-negative-100 text-negative-700' },
  aguardando_aprovacao: { label: 'Medição sem relatório', cls: 'bg-warn-600/15 text-warn-700' },
  pronto: { label: 'Pronto para enviar', cls: 'bg-brand-100 text-brand-800' },
  enviado: { label: 'Enviado · aguardando faturamento', cls: 'bg-brand-700 text-white' },
  faturado: { label: 'Faturado', cls: 'bg-positive-100 text-positive-700' },
  anterior: { label: 'Antes do fluxo', cls: 'bg-gray-100 text-gray-600' },
}
type Filter = 'todos' | 'pendentes' | 'prontos' | 'enviados' | 'faturados'
const FILTERS: { id: Filter; label: string; test: (r: FinanceRow) => boolean }[] = [
  { id: 'todos', label: 'Todos', test: () => true },
  { id: 'pendentes', label: 'Pendências', test: r => r.state === 'pendente_confirmacao' || r.state === 'sem_medicao' || r.state === 'aguardando_aprovacao' },
  { id: 'prontos', label: 'Prontos para enviar', test: r => r.state === 'pronto' },
  { id: 'enviados', label: 'Enviados', test: r => r.state === 'enviado' },
  { id: 'faturados', label: 'Faturados', test: r => r.state === 'faturado' },
]
const br = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—')
const rowKey = (r: FinanceRow) => `${r.contractId}:${r.kind}`

export function FinanceiroView(p: Props) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [filter, setFilter] = useState<Filter>('todos')
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [invoicing, setInvoicing] = useState<string | null>(null)
  const [inv, setInv] = useState({ number: '', date: '', amount: '' })

  const rows = useMemo(() => p.rows.filter(FILTERS.find(f => f.id === filter)!.test), [p.rows, filter])
  const count = (f: Filter) => p.rows.filter(FILTERS.find(x => x.id === f)!.test).length
  const canSend = (r: FinanceRow) => p.me.isAdmin || p.owners[r.contractId]?.id === p.me.id
  const ready = rows.filter(r => r.state === 'pronto' && canSend(r))
  const chosen = ready.filter(r => selected[rowKey(r)])
  const r = p.revenue
  const prev = p.month === 1 ? { y: p.year - 1, m: 12 } : { y: p.year, m: p.month - 1 }
  const next = p.month === 12 ? { y: p.year + 1, m: 1 } : { y: p.year, m: p.month + 1 }
  const isFutureNext = next.y > p.nowYear || (next.y === p.nowYear && next.m > p.nowMonth)

  function run(fn: () => Promise<{ ok: boolean; error?: string } | { sent: number; errors: string[] }>, okText: string) {
    setMsg(null)
    start(async () => {
      try {
        const res = await fn()
        if ('sent' in res) setMsg({ ok: res.errors.length === 0, text: `${res.sent} enviado(s).${res.errors.length ? ` ${res.errors.length} com problema: ${[...new Set(res.errors)].join(' · ')}` : ''}` })
        else if (res.ok) setMsg({ ok: true, text: okText })
        else setMsg({ ok: false, text: res.error ?? 'Não foi possível concluir.' })
        setSelected({}); setInvoicing(null)
        router.refresh()
      } catch {
        setMsg({ ok: false, text: 'Falha de conexão. Tente de novo.' })
      }
    })
  }

  const parts: { key: keyof Props['revenue']['parts']; label: string; sign?: -1 }[] = [
    { key: 'pendingConfirm', label: 'Recorrência não confirmada' },
    { key: 'pending', label: 'Medição pendente (sem lançamento/relatório)' },
    { key: 'discounts', label: 'Descontos' },
    { key: 'glosas', label: 'Glosas' },
    { key: 'below', label: 'Medido abaixo do contrato' },
    { key: 'above', label: 'Medido acima do contrato', sign: -1 },
    { key: 'notSent', label: 'Apurado e ainda não enviado' },
    { key: 'notInvoiced', label: 'Enviado, aguardando faturamento' },
    { key: 'invoiceDiff', label: 'Faturado diferente do enviado' },
  ]

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Financeiro</h1>
          <p className="text-sm text-gray-500">O que está em contrato, o que foi enviado para faturamento e o que já foi faturado.</p>
        </div>
        <div className="flex items-center gap-1.5 text-sm">
          <Link href={`/financeiro?ano=${prev.y}&mes=${prev.m}`} className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-gray-700 hover:bg-gray-50" aria-label="Mês anterior">‹</Link>
          <span className="min-w-36 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-center font-medium text-gray-900">{MONTHS[p.month - 1]}/{p.year}</span>
          {isFutureNext
            ? <span className="rounded-lg border border-gray-100 px-2.5 py-1.5 text-gray-300">›</span>
            : <Link href={`/financeiro?ano=${next.y}&mes=${next.m}`} className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-gray-700 hover:bg-gray-50" aria-label="Próximo mês">›</Link>}
        </div>
      </div>

      {!r.flow && (
        <p className="rounded-xl bg-gray-100 p-3 text-xs text-gray-600">
          Este mês é anterior ao início do fluxo de faturamento{p.erp.flowStart ? ` (${p.erp.flowStart.split('-').reverse().join('/')})` : ''}: vale a regra antiga (recorrente automático; apurado = faturado). Nada a enviar.
        </p>
      )}

      {/* Resumo */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Card label="Em contrato (potencial)" value={fmtBRL(r.potential)} hint="100% do valor dos contratos ativos" />
        <Card label="Apurado" value={fmtBRL(r.apurado)} hint="recorrência confirmada + medição validada" />
        <Card label="Enviado para faturamento" value={fmtBRL(r.sent)} hint={`avulso: ${fmtBRL(r.avulsoSent)}`} tone="brand" />
        <Card label="Faturado" value={fmtBRL(r.invoiced)} hint={`avulso: ${fmtBRL(r.avulsoInvoiced)}`} tone="good" />
        <Card label="Diferença no mês" value={r.gap > 0 ? `− ${fmtBRL(r.gap)}` : fmtBRL(0)} hint="em contrato − faturado" tone={r.gap > 0 ? 'bad' : 'good'} />
      </div>

      {r.gap > 0 && (
        <details className="rounded-2xl border border-gray-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-semibold text-gray-900">De onde vem a diferença de {fmtBRL(r.gap)}</summary>
          <ul className="mt-3 divide-y divide-gray-50 text-sm">
            {parts.filter(x => Math.abs(r.parts[x.key].total) > 0.005).map(x => (
              <li key={x.key} className="py-2">
                <details>
                  <summary className="flex cursor-pointer items-center justify-between gap-3">
                    <span className="text-gray-700">{x.label} <span className="text-xs text-gray-400">· {r.parts[x.key].lines.length}</span></span>
                    <span className="tabular-nums font-medium text-gray-900">{x.sign === -1 ? '+ ' : ''}{fmtBRL(r.parts[x.key].total)}</span>
                  </summary>
                  <ul className="mt-1 space-y-0.5 pl-3 text-xs text-gray-600">
                    {r.parts[x.key].lines.map((l, i) => (
                      <li key={i} className="flex justify-between gap-3">
                        <Link href={`/contracts/${l.contractId}`} className="truncate hover:underline">{l.client}{l.note ? ` — ${l.note}` : ''}</Link>
                        <span className="tabular-nums">{fmtBRL(l.value)}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Pendências do relatório de medição */}
      {r.flow && p.rows.some(x => x.state === 'sem_medicao' || x.state === 'aguardando_aprovacao') && (
        <p className={`rounded-xl p-3 text-xs ${p.due.overdue ? 'bg-negative-100 text-negative-700' : 'bg-warn-600/10 text-warn-700'}`}>
          {p.due.overdue ? '⚠ Prazo do relatório de medição vencido' : '⏳ Prazo do relatório de medição'}: {br(p.due.iso)} (dia {p.due.day} do mês seguinte).{' '}
          {p.rows.filter(x => x.state === 'sem_medicao').length} sem medição lançada · {p.rows.filter(x => x.state === 'aguardando_aprovacao').length} sem relatório (aguardando aprovação do Admin).
        </p>
      )}

      {p.errors.length > 0 && (
        <div className="rounded-xl border border-negative-100 bg-white p-3 text-xs">
          <p className="font-semibold text-negative-700">Envios com erro (podem ser reenviados)</p>
          <ul className="mt-1 space-y-0.5 text-gray-700">{p.errors.map(e => <li key={e.id}>{e.client} · {e.source_type}: {e.erp_error}</li>)}</ul>
        </div>
      )}

      {/* Lista */}
      <div className="rounded-2xl border border-gray-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map(f => (
              <button key={f.id} onClick={() => setFilter(f.id)} className={`rounded-full px-3 py-1 text-xs font-medium ${filter === f.id ? 'bg-brand-700 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                {f.label} <span className="opacity-70">{count(f.id)}</span>
              </button>
            ))}
          </div>
          {ready.length > 0 && (
            <div className="flex items-center gap-2">
              <button onClick={() => setSelected(Object.fromEntries(ready.map(x => [rowKey(x), true])))} className="text-xs text-brand-700 hover:underline">Marcar prontos ({ready.length})</button>
              <button
                disabled={pending || chosen.length === 0}
                onClick={() => run(() => sendManyToBilling(chosen.map(x => ({ contractId: x.contractId, sourceType: x.kind, year: p.year, month: p.month }))), 'Enviado(s).')}
                className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-800 disabled:opacity-50"
              >
                {pending ? 'Enviando…' : `Enviar selecionados (${chosen.length})`}
              </button>
            </div>
          )}
        </div>
        {msg && <p role="status" className={`px-4 pt-3 text-xs ${msg.ok ? 'text-positive-700' : 'text-negative-700'}`}>{msg.ok ? '✓ ' : ''}{msg.text}</p>}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead className="bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="w-8 px-3 py-2" />
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2 text-right">Em contrato</th>
                <th className="px-3 py-2 text-right">Apurado</th>
                <th className="px-3 py-2 text-right">Enviado</th>
                <th className="px-3 py-2 text-right">Faturado</th>
                <th className="px-3 py-2">Situação</th>
                <th className="px-3 py-2 text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(x => {
                const k = rowKey(x)
                const mine = canSend(x)
                return (
                  <tr key={k} className="align-top">
                    <td className="px-3 py-2.5">
                      {x.state === 'pronto' && mine && (
                        <input type="checkbox" aria-label={`Selecionar ${x.client}`} checked={!!selected[k]} onChange={e => setSelected(s => ({ ...s, [k]: e.target.checked }))} />
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <Link href={`/contracts/${x.contractId}?tab=faturamento`} className="font-medium text-gray-900 hover:underline">{x.client}</Link>
                      <p className="text-[11px] text-gray-500">{x.number ? `${x.number} · ` : ''}{p.owners[x.contractId]?.name || 'sem consultor'}{x.note ? ` · ${x.note}` : ''}</p>
                      {x.changedAfterSend && <p className="text-[11px] font-medium text-warn-700">⚠ O apurado mudou depois do envio — o Admin pode cancelar e reenviar.</p>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-xs text-gray-600">{KIND[x.kind]}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">{x.kind === 'avulso' ? '—' : fmtBRL(x.potential)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-gray-900">{x.apurado === null ? '—' : fmtBRL(x.apurado)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-brand-700">{x.sent === null ? '—' : fmtBRL(x.sent)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-positive-700">
                      {x.invoiced === null ? '—' : fmtBRL(x.invoiced)}
                      {x.invoiceNumber && <p className="text-[10px] text-gray-500">NF {x.invoiceNumber} · {br(x.invoicedAt)}</p>}
                    </td>
                    <td className="px-3 py-2.5"><span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${STATE[x.state].cls}`}>{STATE[x.state].label}</span></td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex flex-col items-end gap-1 text-xs">
                        {x.state === 'pendente_confirmacao' && mine && (
                          <>
                            <button disabled={pending} onClick={() => run(() => saveRecurringDiscount({ contractId: x.contractId, year: p.year, month: p.month, discount: 0 }), 'Recorrência confirmada.')}
                              className="rounded-md border border-brand-700 px-2.5 py-1 font-medium text-brand-700 hover:bg-brand-100 disabled:opacity-50">Confirmar {fmtBRL(x.potential)}</button>
                            <Link href={`/contracts/${x.contractId}?tab=faturamento`} className="text-gray-500 hover:underline">com desconto…</Link>
                          </>
                        )}
                        {(x.state === 'sem_medicao' || x.state === 'aguardando_aprovacao') && (
                          <Link href={`/contracts/${x.contractId}?tab=faturamento`} className="text-brand-700 hover:underline">{x.state === 'sem_medicao' ? 'Lançar medição' : p.me.isAdmin ? 'Aprovar / anexar relatório' : 'Anexar relatório'}</Link>
                        )}
                        {x.state === 'pronto' && mine && (
                          <button disabled={pending} onClick={() => run(() => sendToBilling({ contractId: x.contractId, sourceType: x.kind, year: p.year, month: p.month }), 'Enviado para faturamento.')}
                            className="rounded-md bg-brand-700 px-2.5 py-1 font-medium text-white hover:bg-brand-800 disabled:opacity-50">Enviar</button>
                        )}
                        {x.state === 'enviado' && p.me.isAdmin && x.submissionId && (
                          invoicing === x.submissionId ? (
                            <div className="flex w-56 flex-col gap-1 rounded-lg border border-gray-200 bg-gray-50 p-2 text-left">
                              <input placeholder="Nº da nota" value={inv.number} onChange={e => setInv(v => ({ ...v, number: e.target.value }))} className="rounded border border-gray-300 px-2 py-1" />
                              <input type="date" value={inv.date} onChange={e => setInv(v => ({ ...v, date: e.target.value }))} className="rounded border border-gray-300 px-2 py-1" />
                              <input inputMode="decimal" placeholder="Valor faturado" value={inv.amount} onChange={e => setInv(v => ({ ...v, amount: e.target.value }))} className="rounded border border-gray-300 px-2 py-1" />
                              <div className="flex gap-2">
                                <button disabled={pending} onClick={() => run(() => markInvoiced({ submissionId: x.submissionId!, invoiceNumber: inv.number, invoicedAt: inv.date, amount: Number(inv.amount.replace(/\./g, '').replace(',', '.')) }), 'Faturado lançado.')}
                                  className="rounded bg-positive-700 px-2 py-1 font-medium text-white disabled:opacity-50">Salvar</button>
                                <button onClick={() => setInvoicing(null)} className="text-gray-500">Cancelar</button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <button onClick={() => { setInvoicing(x.submissionId); setInv({ number: '', date: new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10), amount: String(x.sent ?? '').replace('.', ',') }) }}
                                className="rounded-md border border-positive-700 px-2.5 py-1 font-medium text-positive-700 hover:bg-positive-100">Lançar faturado</button>
                              <button disabled={pending} onClick={() => { const reason = window.prompt('Motivo do cancelamento do envio:'); if (reason) run(() => cancelSubmission({ submissionId: x.submissionId!, reason }), 'Envio cancelado.') }}
                                className="text-gray-500 hover:underline">Cancelar envio</button>
                            </>
                          )
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {rows.length === 0 && <tr><td colSpan={9} className="px-4 py-6 text-center text-xs text-gray-500">Nada nesta lista.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {p.me.isAdmin && <IntegrationCard erp={p.erp} />}
    </div>
  )
}

function Card({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: 'brand' | 'good' | 'bad' }) {
  const cls = tone === 'brand' ? 'bg-brand-700 text-white' : tone === 'good' ? 'bg-positive-600 text-white' : tone === 'bad' ? 'bg-negative-600 text-white' : 'border border-gray-200 bg-white text-gray-900'
  const sub = tone ? 'text-white/80' : 'text-gray-500'
  return (
    <div className={`rounded-2xl p-4 ${cls}`}>
      <p className={`text-[10px] font-semibold uppercase tracking-wide ${sub}`}>{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      <p className={`mt-0.5 text-[11px] ${sub}`}>{hint}</p>
    </div>
  )
}

function IntegrationCard({ erp }: { erp: Props['erp'] }) {
  const router = useRouter()
  const [flowStart, setFlowStart] = useState(erp.flowStart ?? '')
  const [msg, setMsg] = useState<string | null>(null)
  const [key, setKey] = useState<{ url: string; key: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function saveStart() {
    setBusy(true); setMsg(null)
    const r = await saveBillingFlowStart(flowStart)
    setBusy(false); setMsg(r.ok ? 'Início do fluxo salvo.' : r.error)
    if (r.ok) router.refresh()
  }
  async function genKey() {
    if (erp.hasReturnKey && !window.confirm('Gerar uma nova chave invalida a anterior. Continuar?')) return
    setBusy(true); setMsg(null)
    const r = await generateBillingReturnKey()
    setBusy(false)
    if (r.ok) setKey({ url: r.url, key: r.key })
    else setMsg(r.error)
  }

  return (
    <details className="rounded-2xl border border-gray-200 bg-white p-4 text-sm">
      <summary className="cursor-pointer font-semibold text-gray-900">Integração com o faturamento (Admin)</summary>
      <div className="mt-3 grid gap-4 md:grid-cols-3">
        <div>
          <p className="text-xs font-medium text-gray-600">Sistema de faturamento</p>
          <p className="mt-1 text-gray-900">{ERP_LABEL[erp.provider]}</p>
          <p className="mt-1 text-[11px] text-gray-500">Sankhya e TOTVS estão preparados; a conexão é ligada quando a empresa tiver as credenciais e a documentação da API.</p>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600" htmlFor="flow-start">Início do fluxo (mês)</label>
          <div className="mt-1 flex gap-2">
            <input id="flow-start" type="month" value={flowStart} onChange={e => setFlowStart(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1 text-sm" />
            <button onClick={saveStart} disabled={busy || !flowStart} className="rounded-md border border-brand-700 px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100 disabled:opacity-50">Salvar</button>
          </div>
          <p className="mt-1 text-[11px] text-gray-500">Antes desse mês vale a regra antiga (recorrente automático, apurado = faturado).</p>
        </div>
        <div>
          <p className="text-xs font-medium text-gray-600">Retorno automático do faturado</p>
          <p className="mt-1 text-[11px] text-gray-500">O ERP (ou a integração) avisa o CRM quando faturar, com nº da nota, data e valor.</p>
          <button onClick={genKey} disabled={busy} className="mt-2 rounded-md border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            {erp.hasReturnKey ? 'Gerar nova chave' : 'Gerar chave de retorno'}
          </button>
        </div>
      </div>
      {key && (
        <div className="mt-3 space-y-1 rounded-lg bg-gray-50 p-3 text-xs">
          <p className="font-medium text-gray-900">Guarde a chave agora — ela não aparece de novo.</p>
          <p>Endereço: <code className="break-all">{key.url}</code></p>
          <p>Cabeçalho: <code className="break-all">Authorization: Bearer {key.key}</code></p>
          <p>Corpo (JSON): <code className="break-all">{'{"envio_id":"…","numero_nota":"12345","data_faturamento":"AAAA-MM-DD","valor_faturado":1234.56}'}</code></p>
        </div>
      )}
      {msg && <p className="mt-2 text-xs text-gray-700">{msg}</p>}
    </details>
  )
}
