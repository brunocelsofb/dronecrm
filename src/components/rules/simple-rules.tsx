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
export function PersonBadge({ who }: { who: string }) {
  return <span className="rounded bg-positive-100 px-1.5 py-0.5 text-[10px] font-semibold text-positive-700">👤 TAREFA PARA {who.toUpperCase()}</span>
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
            <b className="text-brand-700">{v.days}</b>
            <span>dias (junto com o &quot;preparar a renovação&quot;) → o cartão vai para a etapa</span>
            <select value={v.stageId} disabled={!v.enabled} onChange={e => { setV({ ...v, stageId: e.target.value }); setMsg(null) }}
              className="rounded-md border border-gray-300 px-1.5 py-1 text-sm">
              <option value="">escolha…</option>
              {p.stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <p className="mt-0.5 text-[11px] text-gray-400">Os dias seguem o &quot;preparar a renovação&quot; (mude na linha do tempo acima). Confere todo dia de madrugada; vencidos também entram. Mover o cartão fora desse processo pede confirmação (digitar &quot;mudar&quot;) e fica registrado quem mudou.</p>
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
        <input type="number" min={0} max={365} value={v} placeholder="7" title="Vazio = 7 dias (só a cor do cartão); 0 = etapa sem prazo" disabled={pending} onChange={e => { setV(e.target.value); setMsg(null) }}
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

// ─── Ações de evento (ganho, renovação, perda, implantação) ──────────────────
export type EventView = { key: string; when: string; whenLabel: string; agent: string | null; sentence: string; detail: string; editHref?: string; enabled: boolean }

function EventRow({ e }: { e: EventView }) {
  const [on, setOn] = useState(e.enabled)
  const [msg, setMsg] = useState<string | null>(null)
  const [, start] = useTransition()
  const toggle = (v: boolean) => {
    setOn(v); setMsg(null)
    start(async () => {
      const { saveEventToggle } = await import('@/lib/actions/rules-central')
      const r = await saveEventToggle(e.key, v)
      if (!r.ok) { setOn(!v); setMsg(r.error) }
    })
  }
  return (
    <li className="flex gap-3 py-2.5">
      <Switch on={on} label={e.sentence} onChange={toggle} />
      <div className="min-w-0 flex-1">
        <p className={`text-sm ${on ? 'text-gray-900' : 'text-gray-400'}`}>{e.sentence} {e.agent ? <AgentBadge agent={e.agent} /> : <SimpleBadge />}</p>
        <p className="text-[11px] text-gray-400">{e.detail}{e.editHref && <> · <Link href={e.editHref} className="text-brand-700 hover:underline">editar textos e destinatários →</Link></>}</p>
        <Msg m={msg} />
      </div>
    </li>
  )
}

export function EventToggles({ events }: { events: EventView[] }) {
  const groups = [...new Set(events.map(e => e.when))]
  return (
    <div className="space-y-4">
      {groups.map(w => (
        <div key={w}>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">{events.find(e => e.when === w)!.whenLabel}</p>
          <ul className="divide-y divide-gray-100">{events.filter(e => e.when === w).map(e => <EventRow key={e.key} e={e} />)}</ul>
        </div>
      ))}
    </div>
  )
}

// ─── Linha do tempo da renovação (editável) ───────────────────────────────────
export type TimelineItem = {
  id: string; days: number; label: string; agent: string | null
  who?: string // tarefa encaminhada a pessoas/áreas (régua)
  edit: { type: 'level'; key: 'prep' | 'a1' | 'a2' | 'a3' } | { type: 'funnel'; pipelineId: string; stageId: string } | { type: 'link'; href: string }
  warn?: string
}

function TimelineDays({ item, levels, onLevels, onError }: { item: TimelineItem; levels: Record<string, number>; onLevels: (l: Record<string, number>) => void; onError: (m: string | null) => void }) {
  const [v, setV] = useState(String(item.days))
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()
  if (item.edit.type === 'link') return <span className="w-20 shrink-0 text-right text-sm font-semibold text-brand-700">{item.days} dias</span>
  const save = () => {
    const n = Number(v)
    if (String(item.days) === v) return
    start(async () => {
      setMsg(null)
      if (item.edit.type === 'level') {
        const next = { ...levels, [item.edit.key]: n }
        const { saveTaskParams } = await import('@/lib/actions/agent-tasks')
        const r = await saveTaskParams('renewal_alerts', next)
        if (r.ok) { onLevels(next); setMsg('Salvo'); onError(null) } else { setMsg(r.error); onError(r.error); setV(String(item.days)) }
      } else if (item.edit.type === 'funnel') {
        const r = await saveFunnelRenewal(item.edit.pipelineId, { enabled: true, days: n, stageId: item.edit.stageId })
        if (r.ok) { setMsg('Salvo'); onError(null) } else { setMsg(r.error); onError(r.error); setV(String(item.days)) }
      }
    })
  }
  return (
    <span className="flex w-20 shrink-0 items-center justify-end gap-1">
      <input type="number" min={1} max={365} value={v} disabled={pending} title="Dias antes do vencimento"
        onChange={e => setV(e.target.value)} onBlur={save} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        className={`w-14 rounded-md border px-1 py-0.5 text-right text-sm font-semibold text-brand-700 ${msg && msg !== 'Salvo' ? 'border-negative-600' : 'border-gray-300'}`} />
      {msg && <span role="status" title={msg} className={`text-[11px] ${msg === 'Salvo' ? 'text-gray-400' : 'text-negative-600'}`}>{msg === 'Salvo' ? '✓' : '!'}</span>}
    </span>
  )
}

export function RenewalTimeline({ items, levels: initLevels }: { items: TimelineItem[]; levels: Record<string, number> }) {
  const [levels, setLevels] = useState(initLevels)
  const [err, setErr] = useState<string | null>(null)
  const list = items.map(i => i.edit.type === 'level' ? { ...i, days: levels[i.edit.key] ?? i.days } : i).sort((a, b) => b.days - a.days)
  return (
    <div>
      <ol className="space-y-1.5">
        {list.map(i => (
          <li key={i.id} className="relative flex items-center gap-3 text-sm">
            <TimelineDays item={i} levels={levels} onLevels={setLevels} onError={setErr} />
            <span className="text-gray-400">dias →</span>
            <span className="min-w-0 flex-1 text-gray-800">{i.label} {i.agent ? <AgentBadge agent={i.agent} /> : i.who ? <PersonBadge who={i.who} /> : <SimpleBadge />}
              {i.edit.type === 'link' && <Link href={i.edit.href} className="ml-1 text-xs text-brand-700 hover:underline">editar →</Link>}
              {i.warn && <span className="ml-1 rounded bg-warn-100 px-1.5 py-0.5 text-[10px] text-warn-700">{i.warn}</span>}
            </span>
          </li>
        ))}
        <li className="flex items-center gap-3 text-sm"><span className="w-20 shrink-0 text-right font-semibold text-negative-600">vencido</span><span className="text-gray-400">→</span><span className="text-gray-800">aviso de contrato vencido (revisar e enviar) <AgentBadge agent="Farmer" /></span></li>
      </ol>
      {err && <p className="mt-2 text-xs text-negative-600">{err}</p>}
      <p className="mt-2 text-[11px] text-gray-400">Mude os dias direto na linha (salva ao sair do campo). Cada linha é uma regra; liga/desliga e detalhes ficam nos quadros abaixo.</p>
    </div>
  )
}
