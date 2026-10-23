'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { fmtBRL } from '@/lib/format'
import {
  FUNNEL_STAGES, LOST_REASONS, OPEN_STAGES, itemsText, lostReasonLabel, nextMoves, sinceText,
  type FunnelSettings, type FunnelStage,
} from '@/lib/retail/funnel'
import { markRetailOrderLost, moveRetailFunnel, registerRetailNudge, saveRetailFunnelSettings } from '@/lib/actions/retail-funnel'

export type FunnelCard = {
  id: string; number: number; status: string; stage: FunnelStage; total: number
  customer: string | null; items: string[]
  hoursInStage: number; overdue: boolean; suggestLost: boolean
  nudgeCount: number; lastNudgeHours: number | null
  whatsappUrl: string | null; lostReason: string | null; hidden: boolean
}

type Tab = 'recuperar' | FunnelStage

export function FunnelBoard({ cards, settings, canEdit, isAdmin }: { cards: FunnelCard[]; settings: FunnelSettings; canEdit: boolean; isAdmin: boolean }) {
  const visible = cards.filter(c => !c.hidden)
  const recover = visible.filter(c => c.overdue).sort((a, b) => b.hoursInStage - a.hoursInStage)
  const byStage = (s: FunnelStage) => visible.filter(c => c.stage === s)
  const [tab, setTab] = useState<Tab>(recover.length ? 'recuperar' : 'atendimento')

  const lostSummary = useMemo(() => {
    const lost = cards.filter(c => c.stage === 'perdido')
    const m = new Map<string, number>()
    for (const c of lost) { const k = lostReasonLabel(c.lostReason); m.set(k, (m.get(k) ?? 0) + 1) }
    return { total: lost.length, list: [...m.entries()].sort((a, b) => b[1] - a[1]) }
  }, [cards])

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'recuperar', label: 'Recuperar hoje', count: recover.length },
    ...FUNNEL_STAGES.map(s => ({ id: s.id as Tab, label: s.label, count: byStage(s.id).length })),
  ]
  const listFor = (t: Tab) => (t === 'recuperar' ? recover : byStage(t))

  return (
    <div className="space-y-4">
      {/* Resumo e abas (no celular as abas trocam a lista; no computador, levam até a coluna) */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
        {tabs.map(t => (
          <button key={t.id} type="button" onClick={() => { setTab(t.id); document.getElementById(`col-${t.id}`)?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' }) }}
            className={`shrink-0 rounded-full px-3 py-1.5 text-sm ${tab === t.id ? 'bg-brand-700 text-white' : t.id === 'recuperar' && t.count ? 'border border-warn-600/40 bg-warn-100 text-warn-700' : 'border border-gray-300 bg-white text-gray-700'}`}>
            {t.label} <span className="font-semibold">{t.count}</span>
          </button>
        ))}
      </div>

      {/* Celular: uma lista por vez */}
      <div className="md:hidden">
        <StageHeader tab={tab} cards={listFor(tab)} settings={settings} />
        {tab === 'perdido' && <LostSummary s={lostSummary} />}
        <CardList cards={listFor(tab)} canEdit={canEdit} empty={tab === 'recuperar' ? 'Ninguém parado. Bom trabalho!' : 'Nenhum pedido aqui.'} />
      </div>

      {/* Computador: Recuperar hoje em cima + quadro com as colunas */}
      <div className="hidden space-y-4 md:block">
        {recover.length > 0 && (
          <section className="rounded-xl border border-warn-600/40 bg-warn-100/40 p-3">
            <h2 className="text-sm font-semibold text-warn-700">Recuperar hoje · {recover.length}</h2>
            <p className="text-xs text-gray-600">Pedidos parados há mais tempo que o combinado. Abra o WhatsApp com a mensagem pronta, confira e envie.</p>
            <div className="mt-2 grid gap-2 lg:grid-cols-2 xl:grid-cols-3">
              {recover.map(c => <Card key={c.id} c={c} canEdit={canEdit} />)}
            </div>
          </section>
        )}
        <div className="flex gap-3 overflow-x-auto pb-2">
          {FUNNEL_STAGES.map(s => {
            const list = byStage(s.id)
            return (
              <section key={s.id} id={`col-${s.id}`} className={`flex w-72 shrink-0 flex-col rounded-xl border bg-gray-50 ${tab === s.id ? 'border-brand-700' : 'border-gray-200'}`}>
                <div className="border-b border-gray-200 p-3">
                  <StageHeader tab={s.id} cards={list} settings={settings} compact />
                </div>
                <div className="max-h-[70dvh] space-y-2 overflow-y-auto p-2">
                  {s.id === 'perdido' && <LostSummary s={lostSummary} />}
                  {list.length === 0 ? <p className="p-2 text-xs text-gray-400">Nenhum pedido.</p> : list.map(c => <Card key={c.id} c={c} canEdit={canEdit} />)}
                </div>
              </section>
            )
          })}
        </div>
      </div>

      {isAdmin && <SettingsForm settings={settings} />}
    </div>
  )
}

function StageHeader({ tab, cards, settings, compact }: { tab: Tab; cards: FunnelCard[]; settings: FunnelSettings; compact?: boolean }) {
  const st = FUNNEL_STAGES.find(s => s.id === tab)
  const total = cards.reduce((s, c) => s + c.total, 0)
  const limit: Partial<Record<FunnelStage, number>> = { carrinho: settings.carrinho_h, atendimento: settings.atendimento_h, proposta: settings.proposta_h, pagamento: settings.pagamento_h }
  const h = st ? limit[st.id] : undefined
  return (
    <div className={compact ? '' : 'mb-2'}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900">{st?.label ?? 'Recuperar hoje'} · {cards.length}</h2>
        {cards.length > 0 && <span className="text-xs text-gray-500">{fmtBRL(total)}</span>}
      </div>
      <p className="text-xs text-gray-500">
        {st ? st.hint : 'Parados há mais tempo que o combinado, do mais antigo ao mais novo.'}
        {h ? ` · avisa depois de ${h} h` : ''}
        {st?.id === 'entrega' ? ' · últimos 30 dias' : st?.id === 'perdido' ? ' · últimos 30 dias' : ''}
      </p>
    </div>
  )
}

function LostSummary({ s }: { s: { total: number; list: [string, number][] } }) {
  if (!s.total) return null
  return (
    <div className="mb-2 rounded-lg border border-gray-200 bg-white p-2 text-xs text-gray-600">
      <p className="font-medium text-gray-800">Por que perdemos (90 dias) · {s.total}</p>
      <ul className="mt-1 space-y-0.5">
        {s.list.map(([k, v]) => <li key={k} className="flex justify-between"><span>{k}</span><span>{v}</span></li>)}
      </ul>
    </div>
  )
}

function CardList({ cards, canEdit, empty }: { cards: FunnelCard[]; canEdit: boolean; empty: string }) {
  if (!cards.length) return <div className="rounded-xl border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">{empty}</div>
  return <div className="space-y-2">{cards.map(c => <Card key={c.id} c={c} canEdit={canEdit} />)}</div>
}

function Card({ c, canEdit }: { c: FunnelCard; canEdit: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [losing, setLosing] = useState(false)
  const [reason, setReason] = useState('')
  const isOpen = OPEN_STAGES.includes(c.stage)
  const moves = nextMoves(c.stage).filter(m => m.status !== c.status)
  const stageLabel = FUNNEL_STAGES.find(s => s.id === c.stage)?.label

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true); setErr(null)
    const r = await fn()
    setBusy(false)
    if (!r.ok) { setErr(r.error ?? 'Não foi possível.'); return }
    setLosing(false); router.refresh()
  }

  return (
    <article className={`rounded-lg border bg-white p-3 text-sm shadow-sm ${c.overdue ? 'border-warn-600/60' : 'border-gray-200'}`}>
      <div className="flex items-start justify-between gap-2">
        <Link href={`/varejo/pedidos/${c.id}`} className="min-w-0 font-medium text-gray-900 hover:underline">
          <span className="block truncate">Nº {c.number} · {c.customer ?? 'Sem cliente'}</span>
        </Link>
        <span className="whitespace-nowrap font-medium text-gray-900">{fmtBRL(c.total)}</span>
      </div>
      <p className="mt-0.5 truncate text-xs text-gray-500">{itemsText(c.items)}</p>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600">{stageLabel} {sinceText(c.hoursInStage)}</span>
        {c.overdue && <span className="rounded bg-warn-100 px-1.5 py-0.5 font-medium text-warn-700">Parado</span>}
        {c.nudgeCount > 0 && c.lastNudgeHours !== null && (
          <span className="rounded bg-brand-100 px-1.5 py-0.5 text-brand-800">{c.nudgeCount} lembrete{c.nudgeCount > 1 ? 's' : ''} · último {sinceText(c.lastNudgeHours)}</span>
        )}
        {c.stage === 'perdido' && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600">{lostReasonLabel(c.lostReason)}</span>}
      </div>
      {isOpen && c.suggestLost && !losing && (
        <p className="mt-1 text-[11px] text-gray-500">Muito tempo nesta etapa. Se ela desistiu, marque como perdido.</p>
      )}

      {canEdit && c.stage !== 'perdido' && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {isOpen && c.whatsappUrl && (
            <a href={c.whatsappUrl} target="_blank" rel="noopener noreferrer"
              onClick={() => { registerRetailNudge(c.id).then(() => router.refresh()).catch(() => {}) }}
              className="rounded-md bg-[#32AF9D] px-2.5 py-1.5 text-xs font-medium text-white hover:opacity-90">
              Lembrete no WhatsApp
            </a>
          )}
          {isOpen && !c.whatsappUrl && <span className="text-[11px] text-gray-400">Sem telefone</span>}
          {c.stage === 'atendimento' && (
            <Link href={`/varejo/pedidos/${c.id}`} className="rounded-md border border-gray-300 px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50">Gerar proposta</Link>
          )}
          {moves.length > 0 && (
            <select disabled={busy} value="" aria-label="Mover para"
              onChange={e => { const s = e.target.value; if (s) run(() => moveRetailFunnel(c.id, s)) }}
              className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-700">
              <option value="">Mover para…</option>
              {moves.map(m => <option key={m.status} value={m.status}>{m.label}</option>)}
            </select>
          )}
          {isOpen && !losing && (
            <button type="button" disabled={busy} onClick={() => setLosing(true)} className="px-1 py-1.5 text-xs text-gray-500 underline hover:text-gray-700">Perdido</button>
          )}
        </div>
      )}

      {losing && (
        <div className="mt-2 space-y-2 rounded-md border border-gray-200 bg-gray-50 p-2">
          <label className="block text-xs font-medium text-gray-700">Por que ela desistiu?
            <select value={reason} onChange={e => setReason(e.target.value)} className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm">
              <option value="">Escolha…</option>
              {LOST_REASONS.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </label>
          <div className="flex gap-2">
            <button type="button" disabled={busy || !reason} onClick={() => run(() => markRetailOrderLost(c.id, reason))}
              className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">Marcar como perdido</button>
            <button type="button" disabled={busy} onClick={() => { setLosing(false); setReason('') }} className="px-2 py-1.5 text-xs text-gray-600">Voltar</button>
          </div>
        </div>
      )}
      {err && <p role="alert" className="mt-1 text-xs text-negative-700">{err}</p>}
    </article>
  )
}

function SettingsForm({ settings }: { settings: FunnelSettings }) {
  const router = useRouter()
  const [f, setF] = useState<Record<keyof FunnelSettings, string>>({
    carrinho_h: String(settings.carrinho_h), atendimento_h: String(settings.atendimento_h),
    proposta_h: String(settings.proposta_h), pagamento_h: String(settings.pagamento_h), lost_suggest_days: String(settings.lost_suggest_days),
  })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const fields: { k: keyof FunnelSettings; label: string; unit: string }[] = [
    { k: 'carrinho_h', label: 'Carrinho sem conversa', unit: 'horas' },
    { k: 'atendimento_h', label: 'Em atendimento sem resposta', unit: 'horas' },
    { k: 'proposta_h', label: 'Proposta sem aceite', unit: 'horas' },
    { k: 'pagamento_h', label: 'Aguardando pagamento', unit: 'horas' },
    { k: 'lost_suggest_days', label: 'Sugerir "perdido" depois de', unit: 'dias' },
  ]
  async function save() {
    setBusy(true); setMsg(null)
    const r = await saveRetailFunnelSettings({
      carrinho_h: Number(f.carrinho_h), atendimento_h: Number(f.atendimento_h), proposta_h: Number(f.proposta_h),
      pagamento_h: Number(f.pagamento_h), lost_suggest_days: Number(f.lost_suggest_days),
    })
    setBusy(false)
    setMsg(r.ok ? { ok: true, text: 'Prazos salvos.' } : { ok: false, text: r.error })
    if (r.ok) router.refresh()
  }
  return (
    <details className="rounded-xl border border-gray-200 bg-white p-4">
      <summary className="cursor-pointer text-sm font-semibold text-gray-900">Prazos para avisar (administrador)</summary>
      <p className="mt-1 text-xs text-gray-500">Depois de quanto tempo na etapa o pedido fica laranja e entra em "Recuperar hoje". Vale para toda a equipe. Nenhum pedido vira perdido sozinho.</p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {fields.map(x => (
          <label key={x.k} className="block text-xs font-medium text-gray-600">{x.label}
            <span className="mt-1 flex items-center gap-1">
              <input type="number" inputMode="numeric" min={1} value={f[x.k]} onChange={e => setF(p => ({ ...p, [x.k]: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-700 focus:outline-none" />
              <span className="text-xs text-gray-500">{x.unit}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button type="button" disabled={busy} onClick={save} className="rounded-lg bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">Salvar prazos</button>
        {msg && <p role="status" className={`text-xs ${msg.ok ? 'text-positive-700' : 'text-negative-700'}`}>{msg.text}</p>}
      </div>
    </details>
  )
}
