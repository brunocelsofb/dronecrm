'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { getNoteTargets, saveWhatsAppNote, type NoteTargets } from '@/lib/actions/whatsapp-notes'

type Msg = { id: string; message: string | null; direction: string; created_at: string; media_type?: string | null; media_filename?: string | null }

const fmt = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

// Salvar mensagens da conversa como nota na oportunidade, na empresa e/ou no lead
export function SaveNoteModal({ phone, messages, initialId, onClose }: { phone: string; messages: Msg[]; initialId: string; onClose: () => void }) {
  // Mensagens em volta da escolhida, para marcar mais de uma
  const nearby = useMemo(() => {
    const i = Math.max(0, messages.findIndex(m => m.id === initialId))
    return messages.slice(Math.max(0, i - 10), i + 11)
  }, [messages, initialId])
  const [picked, setPicked] = useState<Set<string>>(new Set([initialId]))
  const [comment, setComment] = useState('')
  const [targets, setTargets] = useState<NoteTargets | null>(null)
  const [contractId, setContractId] = useState('')
  const [companyId, setCompanyId] = useState('')
  const [leadId, setLeadId] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()

  useEffect(() => {
    let alive = true
    getNoteTargets(phone).then(r => {
      if (!alive) return
      if (!r.ok) { setMsg({ ok: false, text: r.error }); return }
      setTargets(r.targets)
      // Sugestão: a primeira oportunidade e a empresa dela
      const c = r.targets.contracts[0]
      if (c) { setContractId(c.id); if (c.company_id) setCompanyId(c.company_id) }
      else if (r.targets.companies[0]) setCompanyId(r.targets.companies[0].id)
      else if (r.targets.leads[0]) setLeadId(r.targets.leads[0].id)
    })
    return () => { alive = false }
  }, [phone])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const toggle = (id: string) => setPicked(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const nothing = targets && !targets.contracts.length && !targets.companies.length && !targets.leads.length

  function save() {
    setMsg(null)
    start(async () => {
      const r = await saveWhatsAppNote({
        phone, messageIds: [...picked], comment,
        contractId: contractId || null, companyId: companyId || null, leadId: leadId || null,
      })
      if (!r.ok) { setMsg({ ok: false, text: r.error }); return }
      setMsg({ ok: true, text: `Nota salva: ${r.saved.join(', ')}.` })
      setTimeout(onClose, 1200)
    })
  }

  const sel = 'w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Salvar como nota" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-xl bg-white shadow-xl">
        <div className="border-b border-gray-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-gray-900">📌 Salvar como nota</h2>
          <p className="text-xs text-gray-500">Marque as mensagens e escolha onde guardar. Fica no histórico com autor, data e &quot;via WhatsApp&quot;.</p>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <p className="mb-1 text-xs font-medium text-gray-700">Mensagens ({picked.size})</p>
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg bg-gray-50 p-2">
              {nearby.map(m => (
                <label key={m.id} className={`flex cursor-pointer items-start gap-2 rounded-md px-2 py-1 text-xs ${picked.has(m.id) ? 'bg-brand-100' : 'hover:bg-white'}`}>
                  <input type="checkbox" className="mt-0.5" checked={picked.has(m.id)} onChange={() => toggle(m.id)} />
                  <span className="min-w-0">
                    <span className="text-gray-400">{fmt(m.created_at)} · {m.direction === 'enviado' ? 'Empresa' : 'Contato'}</span>
                    <span className="block whitespace-pre-wrap break-words text-gray-800">
                      {m.media_type ? `📎 ${m.media_filename || m.media_type} ` : ''}{m.message && !/^\[.*\]$/.test(m.message.trim()) ? m.message : ''}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-gray-700">Comentário (opcional)</span>
            <textarea value={comment} onChange={e => setComment(e.target.value)} maxLength={2000} placeholder="Ex.: cliente aprovou o atestado"
              className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm" rows={2} />
          </label>
          {!targets && !msg && <p className="text-xs text-gray-400">Buscando oportunidades e empresas do contato…</p>}
          {nothing && <p className="rounded-md bg-warn-100 px-3 py-2 text-xs text-warn-700">Este contato ainda não está ligado a oportunidade, empresa ou lead. Vincule a conversa (ou crie a oportunidade) e salve a nota depois.</p>}
          {targets && !nothing && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-medium text-gray-700">Oportunidade</span>
                <select className={sel} value={contractId} onChange={e => {
                  setContractId(e.target.value)
                  const c = targets.contracts.find(x => x.id === e.target.value)
                  if (c?.company_id) setCompanyId(c.company_id)
                }}>
                  <option value="">— não salvar na oportunidade —</option>
                  {targets.contracts.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-gray-700">Empresa (histórico da conta)</span>
                <select className={sel} value={companyId} onChange={e => setCompanyId(e.target.value)}>
                  <option value="">— não salvar na empresa —</option>
                  {targets.companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              {targets.leads.length > 0 && (
                <label className="block sm:col-span-2">
                  <span className="text-xs font-medium text-gray-700">Lead</span>
                  <select className={sel} value={leadId} onChange={e => setLeadId(e.target.value)}>
                    <option value="">— não salvar no lead —</option>
                    {targets.leads.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </label>
              )}
            </div>
          )}
          {msg && <p className={`text-sm ${msg.ok ? 'text-positive-700' : 'text-negative-700'}`}>{msg.text}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">Cancelar</button>
          <button type="button" onClick={save} disabled={pending || !picked.size || !!nothing || (!contractId && !companyId && !leadId)}
            className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">
            {pending ? 'Salvando…' : 'Salvar nota'}
          </button>
        </div>
      </div>
    </div>
  )
}
