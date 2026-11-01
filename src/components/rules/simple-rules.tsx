'use client'
// Central de regras: regras simples do sistema (sem IA), editáveis ali mesmo.
import { useState, useTransition } from 'react'
import Link from 'next/link'
import { saveFunnelRenewal, saveStageSla, saveTicketSla, previewFunnelRenewal } from '@/lib/actions/rules-central'
import { Switch } from '@/components/ia/agent-tasks-panel'
import { PRIORITY_LABELS, PRIORITY_ORDER } from '@/lib/utils/gut-matrix'

export function SimpleBadge() {
  return <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">⚙️ AÇÃO SIMPLES · SEM IA</span>
}
export function AgentBadge({ agent }: { agent: string }) {
  return <span className="rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700">🤖 AGENTE {agent.toUpperCase()}</span>
}

function Msg({ m }: { m: string | null }) {
  if (!m) return null
  return <span className={`text-xs ${m === 'Salvo' ? 'text-gray-400' : 'text-negative-600'}`}>{m}</span>
}

export type FunnelRenewalView = { id: string; name: string; days: number | null; stageId: string | null; stages: { id: string; name: string }[] }

function FunnelRenewalRow({ p }: { p: FunnelRenewalView }) {
  const init = { enabled: p.days != null && !!p.stageId, days: String(p.days ?? 30), stageId: p.stageId ?? '' }
  const [v, setV] = useState(init)
  const [saved, setSaved] = useState(init)
  const [msg, setMsg] = useState<string | null>(null)
  const [prev, setPrev] = useState<{ total: number; items: { name: string; detail: string }[]; error?: string } | null>(null)
  const [pending, start] = useTransition()
  const dirty = JSON.stringify(v) !== JSON.stringify(saved)
  const save = (next = v) => start(async () => {
    setMsg(null)
    const r = await saveFunnelRenewal(p.id, { enabled: next.enabled, days: Number(next.days), stageId: next.stageId || null })
    if (r.ok) { setSaved(next); setMsg('Salvo') } else { setMsg(r.error); if (next.enabled !== v.enabled) setV(saved) }
  })
  const test = () => start(async () => { setPrev(null); setPrev(await previewFunnelRenewal(p.id, { days: Number(v.days), stageId: v.stageId || null })) })
  return (
    <li className="py-3">
      <div className="flex gap-3">
        <Switch on={v.enabled} label={`Renovação automática no funil ${p.name}`} onChange={on => {
          const next = { ...v, enabled: on }
          setV(next)
          if (!on || next.stageId) save(next) // ligar só salva sozinho se já tiver etapa
        }} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900">Funil {p.name} <SimpleBadge /></p>
          <div className={`mt-1 flex flex-wrap items-center gap-1.5 text-sm text-gray-700 ${v.enabled ? '' : 'opacity-50'}`}>
            <span>QUANDO faltar</span>
            <input type="number" min={1} max={365} value={v.days} disabled={!v.enabled} onChange={e => { setV({ ...v, days: e.target.value }); setMsg(null) }}
              className="w-16 rounded-md border border-gray-300 px-1.5 py-1 text-sm" />
            <span>dias ou menos para o vencimento → a oportunidade volta para a etapa</span>
            <select value={v.stageId} disabled={!v.enabled} onChange={e => { setV({ ...v, stageId: e.target.value }); setMsg(null) }}
              className="rounded-md border border-gray-300 px-1.5 py-1 text-sm">
              <option value="">escolha…</option>
              {p.stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <p className="mt-0.5 text-[11px] text-gray-400">Confere todo dia de madrugada. Vencidos também voltam. Fica registrado no histórico da oportunidade.</p>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs">
            {dirty && <button type="button" onClick={() => save()} disabled={pending} className="rounded-md bg-brand-700 px-2.5 py-1 font-semibold text-white hover:bg-brand-800 disabled:opacity-50">{pending ? 'Salvando…' : 'Salvar'}</button>}
            {v.enabled && <button type="button" onClick={test} disabled={pending || !v.stageId} className="font-medium text-brand-700 hover:underline disabled:opacity-50">Testar</button>}
            <Msg m={msg} />
          </div>
          {prev && (
            <div className="mt-2 rounded-md border border-gray-200 bg-gray-50 p-2.5 text-xs text-gray-700">
              {prev.error ? <p className="text-negative-600">{prev.error}</p> : <p>Hoje <b>{prev.total}</b> oportunidade(s) voltariam (ou já estariam) para a etapa de renovação — nada foi movido.</p>}
              <ul className="mt-1 max-h-40 overflow-auto">{prev.items.map((i, k) => <li key={k}>• {i.name} <span className="text-gray-400">— {i.detail}</span></li>)}</ul>
            </div>
          )}
        </div>
      </div>
    </li>
  )
}

export function FunnelRenewalEditor({ pipelines }: { pipelines: FunnelRenewalView[] }) {
  if (!pipelines.length) return null
  return <ul className="divide-y divide-gray-100">{pipelines.map(p => <FunnelRenewalRow key={p.id} p={p} />)}</ul>
}

export type StageSlaView = { id: string; name: string; stages: { id: string; name: string; sla: number | null }[] }

function StageSlaInput({ stage }: { stage: { id: string; name: string; sla: number | null } }) {
  const [v, setV] = useState(stage.sla == null ? '' : String(stage.sla))
  const [saved, setSaved] = useState(v)
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const save = () => {
    if (v === saved) return
    start(async () => {
      const r = await saveStageSla(stage.id, v === '' ? null : Number(v))
      if (r.ok) { setSaved(v); setMsg('Salvo') } else { setMsg(r.error); setV(saved) }
    })
  }
  return (
    <label className="flex items-center justify-between gap-2 py-1 text-sm text-gray-700">
      <span className="min-w-0 truncate">{stage.name}</span>
      <span className="flex shrink-0 items-center gap-1.5">
        <input type="number" min={1} max={365} value={v} placeholder="sem" disabled={pending} onChange={e => { setV(e.target.value); setMsg(null) }}
          onBlur={save} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          className="w-16 rounded-md border border-gray-300 px-1.5 py-1 text-sm" />
        <span className="text-xs text-gray-400">dias</span>
        <Msg m={msg} />
      </span>
    </label>
  )
}

export function StageSlaEditor({ pipelines }: { pipelines: StageSlaView[] }) {
  if (!pipelines.length) return null
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {pipelines.map(p => (
        <div key={p.id} className="rounded-md border border-gray-100 p-3">
          <p className="text-xs font-semibold text-gray-600">Funil {p.name}</p>
          <div className="mt-1 divide-y divide-gray-50">{p.stages.map(s => <StageSlaInput key={s.id} stage={s} />)}</div>
        </div>
      ))}
    </div>
  )
}

export function TicketSlaEditor({ initial }: { initial: Record<string, number> }) {
  const init = Object.fromEntries(PRIORITY_ORDER.map(k => [k, String(initial[k])]))
  const [v, setV] = useState<Record<string, string>>(init)
  const [saved, setSaved] = useState(init)
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const dirty = PRIORITY_ORDER.some(k => v[k] !== saved[k])
  const save = () => start(async () => {
    setMsg(null)
    const r = await saveTicketSla(Object.fromEntries(PRIORITY_ORDER.map(k => [k, Number(v[k])])))
    if (r.ok) { setSaved(v); setMsg('Salvo') } else setMsg(r.error)
  })
  return (
    <div>
      <div className="flex flex-wrap gap-4">
        {PRIORITY_ORDER.map(k => (
          <label key={k} className="text-[11px] text-gray-600">{PRIORITY_LABELS[k]}
            <span className="mt-0.5 flex items-center gap-1">
              <input type="number" min={1} max={90} value={v[k]} onChange={e => { setV({ ...v, [k]: e.target.value }); setMsg(null) }}
                className="w-16 rounded-md border border-gray-300 px-1.5 py-1 text-sm text-gray-900" />
              <span className="text-gray-400">dias</span>
            </span>
          </label>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-3">
        {dirty && <button type="button" onClick={save} disabled={pending} className="rounded-md bg-brand-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50">{pending ? 'Salvando…' : 'Salvar prazos'}</button>}
        <Msg m={msg} />
      </div>
      <p className="mt-1 text-[11px] text-gray-400">Vale para os chamados abertos daqui para frente e quando a prioridade for trocada; os prazos já calculados não mudam.</p>
    </div>
  )
}

// Regra que é editada em outra tela (complexa demais para editar aqui): mostra o resumo e leva até lá
export function LinkRule({ title, sentence, href, badge }: { title: string; sentence: string; href: string; badge: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-900">{title} {badge}</p>
        <p className="text-xs text-gray-600">{sentence}</p>
      </div>
      <Link href={href} className="shrink-0 text-xs font-medium text-brand-700 hover:underline">Editar →</Link>
    </li>
  )
}
