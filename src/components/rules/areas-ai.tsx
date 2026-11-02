'use client'
// Central de regras → Áreas e IA: áreas da empresa, modo sem IA e quem envia sozinho.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { saveArea, deleteArea, setAiPaused, setAutoSender } from '@/lib/actions/rules-central'
import { Switch } from '@/components/ia/agent-tasks-panel'

export type AreaView = { id: string; name: string; leadId: string | null; memberIds: string[]; emails: string[] }
export type PersonView = { id: string; name: string; missing: string[]; hasEmail: boolean }

const input = 'mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900'

function AreaEditor({ a, people, onDone }: { a: Omit<AreaView, 'id'> & { id?: string }; people: PersonView[]; onDone: () => void }) {
  const router = useRouter()
  const [v, setV] = useState({ ...a, emailsText: a.emails.join(', ') })
  const [err, setErr] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const toggle = (id: string) => setV({ ...v, memberIds: v.memberIds.includes(id) ? v.memberIds.filter(x => x !== id) : [...v.memberIds, id] })
  const save = () => start(async () => {
    setErr(null)
    const r = await saveArea({ id: v.id ?? null, name: v.name, leadId: v.leadId, memberIds: v.memberIds, emails: v.emailsText.split(/[,;\s]+/).filter(Boolean) })
    if (!r.ok) { setErr(r.error); return }
    router.refresh(); onDone()
  })
  const remove = () => {
    if (!v.id || !window.confirm(`Excluir a área "${v.name}"?`)) return
    start(async () => { const r = await deleteArea(v.id!); if (!r.ok) setErr(r.error); else { router.refresh(); onDone() } })
  }
  return (
    <div className="space-y-2 rounded-md border border-brand-100 bg-brand-100/40 p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-[11px] text-gray-600">Nome da área<input value={v.name} maxLength={60} onChange={e => setV({ ...v, name: e.target.value })} placeholder="Ex.: Time técnico" className={input} /></label>
        <label className="text-[11px] text-gray-600">Quem recebe a tarefa da área
          <select value={v.leadId ?? ''} onChange={e => setV({ ...v, leadId: e.target.value || null })} className={input}>
            <option value="">Primeira pessoa marcada</option>
            {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      </div>
      <div>
        <p className="text-[11px] text-gray-600">Pessoas da área (recebem aviso no sino e os e-mails)</p>
        <div className="mt-0.5 flex flex-wrap gap-1">
          {people.map(p => (
            <label key={p.id} className={`flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${v.memberIds.includes(p.id) ? 'border-brand-700 bg-brand-100 text-brand-800' : 'border-gray-200 text-gray-600'}`}>
              <input type="checkbox" className="hidden" checked={v.memberIds.includes(p.id)} onChange={() => toggle(p.id)} />{p.name}
            </label>
          ))}
        </div>
      </div>
      <label className="block text-[11px] text-gray-600">E-mails de fora do CRM (opcional, separados por vírgula)
        <input value={v.emailsText} onChange={e => setV({ ...v, emailsText: e.target.value })} placeholder="faturamento@empresa.com, financeiro@empresa.com" className={input} />
      </label>
      {err && <p className="text-xs text-negative-600">{err}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={pending} className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50">{pending ? 'Salvando…' : 'Salvar'}</button>
        <button type="button" onClick={onDone} className="rounded-md px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100">Fechar</button>
        {v.id && <button type="button" onClick={remove} disabled={pending} className="ml-auto text-xs text-negative-600 hover:underline">Excluir</button>}
      </div>
    </div>
  )
}

export function AreasManager({ areas, people }: { areas: AreaView[]; people: PersonView[] }) {
  const [editing, setEditing] = useState<string | null>(null)
  const nameOf = (id: string | null) => people.find(p => p.id === id)?.name ?? '—'
  return (
    <div>
      {editing !== 'new' && <button type="button" onClick={() => setEditing('new')} className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800">+ Nova área</button>}
      {editing === 'new' && <div className="mt-2"><AreaEditor a={{ name: '', leadId: null, memberIds: [], emails: [] }} people={people} onDone={() => setEditing(null)} /></div>}
      <ul className="mt-2 divide-y divide-gray-100">
        {areas.map(a => (
          <li key={a.id} className="py-2.5">
            {editing === a.id ? <AreaEditor a={a} people={people} onDone={() => setEditing(null)} /> : (
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">{a.name}</p>
                  <p className="text-xs text-gray-500">Tarefa vai para {nameOf(a.leadId ?? a.memberIds[0] ?? null)} · {a.memberIds.length} pessoa(s){a.emails.length ? ` · ${a.emails.length} e-mail(s) de fora` : ''}</p>
                </div>
                <button type="button" onClick={() => setEditing(a.id)} className="text-xs font-medium text-brand-700 hover:underline">Editar</button>
              </div>
            )}
          </li>
        ))}
        {!areas.length && editing !== 'new' && <li className="py-2 text-xs text-gray-400">Nenhuma área ainda. Crie, por exemplo: Time técnico, Faturamento, Financeiro.</li>}
      </ul>
    </div>
  )
}

export function AiSettings({ aiPaused, senderId, people }: { aiPaused: boolean; senderId: string | null; people: PersonView[] }) {
  const [paused, setPaused] = useState(aiPaused)
  const [sender, setSender] = useState(senderId ?? '')
  const [msg, setMsg] = useState<string | null>(null)
  const [, start] = useTransition()
  const incomplete = people.filter(p => p.missing.length)
  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <Switch on={paused} label="Modo sem IA" onChange={v => { setPaused(v); start(async () => { const r = await setAiPaused(v); if (!r.ok) { setPaused(!v); setMsg(r.error) } }) }} />
        <div>
          <p className="text-sm font-medium text-gray-900">Modo sem IA</p>
          <p className="text-xs text-gray-500">Ligado, nenhuma regra usa IA: o que seria feito pelo agente vira tarefa para a pessoa, com as mesmas instruções. Use quando quiser economizar; desligue para o agente voltar a trabalhar.
            Também acontece sozinho se a chave da IA faltar ou o orçamento do mês acabar.</p>
        </div>
      </div>
      <div>
        <p className="text-sm font-medium text-gray-900">Quem envia as mensagens automáticas</p>
        <p className="text-xs text-gray-500">Os e-mails internos das regras saem pelo e-mail dessa pessoa. Ela precisa ter o cadastro completo (nome e sobrenome, telefone, área e e-mail) e o e-mail conectado em Minha Conta. Sem ninguém escolhido, o envio vira tarefa.</p>
        <select value={sender} onChange={e => {
          const v = e.target.value; const prev = sender; setSender(v); setMsg(null)
          start(async () => { const r = await setAutoSender(v || null); if (!r.ok) { setSender(prev); setMsg(r.error) } else setMsg('Salvo') })
        }} className="mt-1 w-full max-w-sm rounded-md border border-gray-300 px-2 py-1.5 text-sm">
          <option value="">Ninguém (envios viram tarefa)</option>
          {people.map(p => <option key={p.id} value={p.id} disabled={p.missing.length > 0 || !p.hasEmail}>{p.name}{p.missing.length ? ` — falta ${p.missing.join(', ')}` : !p.hasEmail ? ' — e-mail não conectado' : ''}</option>)}
        </select>
        {msg && <p className={`mt-1 text-xs ${msg === 'Salvo' ? 'text-gray-400' : 'text-negative-600'}`}>{msg}</p>}
      </div>
      {incomplete.length > 0 && (
        <div className="rounded-md bg-warn-100 px-3 py-2 text-xs text-warn-700">
          {incomplete.length} pessoa(s) com cadastro incompleto: {incomplete.slice(0, 6).map(p => `${p.name} (falta ${p.missing.join(', ')})`).join('; ')}{incomplete.length > 6 ? '…' : ''}. <Link href="/users" className="font-medium underline">Completar em Usuários</Link>
        </div>
      )}
    </div>
  )
}
