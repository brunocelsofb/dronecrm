'use client'

// Nova atividade direto na empresa (sem precisar de oportunidade)

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { createActivity } from '@/lib/actions/activities'
import { ACTIVITY_TYPE_LABELS, type ActivityType } from '@/lib/utils/activity-types'

const input = 'w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none'

export function CompanyActivityForm({ companyId, people, currentUserId }: { companyId: string; people: { id: string; name: string }[]; currentUserId: string | null }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ title: '', type: 'task' as ActivityType, date: '', time: '', assignedTo: currentUserId ?? '', content: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (!f.title.trim()) { setError('Dê um título à atividade.'); return }
    if (!f.date) { setError('Escolha a data.'); return }
    setBusy(true); setError(null)
    const r = await createActivity({
      companyId, title: f.title.trim(), content: f.content.trim() || f.title.trim(), activityType: f.type, status: 'planned',
      activityDate: f.date, activityTime: f.time || null, assignedTo: f.assignedTo || null,
    })
    setBusy(false)
    if (r.error) { setError(r.error); return }
    setOpen(false); setF({ title: '', type: 'task', date: '', time: '', assignedTo: currentUserId ?? '', content: '' }); router.refresh()
  }

  if (!open) return (
    <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800">
      <Plus className="h-4 w-4" /> Nova atividade na empresa
    </button>
  )
  return (
    <div className="space-y-2 rounded-lg border border-brand-700/30 p-3">
      <div className="grid gap-2 sm:grid-cols-[2fr_1fr]">
        <label className="block"><span className="text-[10px] font-medium uppercase text-gray-500">Título *</span><input className={input} value={f.title} onChange={e => setF({ ...f, title: e.target.value })} autoFocus placeholder="Ex.: Ligar para apresentar o serviço de engenharia hospitalar" /></label>
        <label className="block"><span className="text-[10px] font-medium uppercase text-gray-500">Tipo</span>
          <select className={input} value={f.type} onChange={e => setF({ ...f, type: e.target.value as ActivityType })}>
            {(Object.keys(ACTIVITY_TYPE_LABELS) as ActivityType[]).map(k => <option key={k} value={k}>{ACTIVITY_TYPE_LABELS[k]}</option>)}
          </select></label>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="block"><span className="text-[10px] font-medium uppercase text-gray-500">Data *</span><input type="date" className={input} value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></label>
        <label className="block"><span className="text-[10px] font-medium uppercase text-gray-500">Hora</span><input type="time" className={input} value={f.time} onChange={e => setF({ ...f, time: e.target.value })} /></label>
        <label className="block"><span className="text-[10px] font-medium uppercase text-gray-500">Responsável</span>
          <select className={input} value={f.assignedTo} onChange={e => setF({ ...f, assignedTo: e.target.value })}>{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      </div>
      <label className="block"><span className="text-[10px] font-medium uppercase text-gray-500">Descrição</span><textarea className={`${input} min-h-[50px]`} value={f.content} onChange={e => setF({ ...f, content: e.target.value })} /></label>
      {error && <p className="text-xs text-negative-700">{error}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={save} className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">{busy ? 'Salvando…' : 'Criar atividade'}</button>
        <button type="button" onClick={() => setOpen(false)} className="px-2 text-xs text-gray-500">Cancelar</button>
      </div>
    </div>
  )
}
