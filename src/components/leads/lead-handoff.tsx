'use client'

// Inbound × outbound no lead: o marketing passa o lead qualificado ao
// comercial; o comercial pode devolver ao marketing (ainda não está pronto).

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { passLeadToCommercial, returnLeadToMarketing } from '@/lib/actions/leads'

export function LeadHandoff({ leadId, entryType, handedOffAt, status, canPass, users }: {
  leadId: string
  entryType: string | null
  handedOffAt: string | null
  status: string
  canPass: boolean
  users: { id: string; full_name: string | null }[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [to, setTo] = useState('')
  const [note, setNote] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const inbound = entryType !== 'outbound'
  const withMarketing = inbound && !handedOffAt

  return (
    <div className={`rounded-lg border p-4 text-sm ${withMarketing ? 'border-warn-600/40 bg-warn-600/10' : 'border-gray-200 bg-white'}`}>
      <p className="font-medium text-gray-900">
        {inbound ? 'Inbound' : 'Outbound'} · {withMarketing ? 'com o marketing (em qualificação)' : 'com o comercial'}
      </p>
      <p className="mt-0.5 text-xs text-gray-600">
        {inbound
          ? 'Lead que veio até a empresa (formulário, anúncio, integração ou WhatsApp). O marketing qualifica e passa ao comercial.'
          : 'Lead encontrado pelo comercial (prospecção). Já está com o comercial.'}
        {handedOffAt && inbound && ` Passado ao comercial em ${new Date(handedOffAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}.`}
      </p>

      {withMarketing && canPass && status !== 'descartado' && (
        <div className="mt-3 grid gap-2 sm:grid-cols-[200px_1fr_auto]">
          <select value={to} onChange={e => setTo(e.target.value)} className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm">
            <option value="">Quem atende (Hunter)</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Observação para o comercial (opcional)" className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm" />
          <button disabled={pending} onClick={() => start(async () => { const r = await passLeadToCommercial(leadId, to || null, note); if (r.error) setErr(r.error); else router.refresh() })}
            className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">Passar para o comercial</button>
        </div>
      )}
      {withMarketing && !canPass && <p className="mt-2 text-xs text-gray-500">Só o marketing (ou o Admin) passa este lead ao comercial.</p>}

      {inbound && handedOffAt && status !== 'convertido' && (
        <button disabled={pending} onClick={() => { const reason = window.prompt('Por que devolver ao marketing? (ex.: ainda pesquisando, sem orçamento agora)'); if (reason) start(async () => { const r = await returnLeadToMarketing(leadId, reason); if (r.error) setErr(r.error); else router.refresh() }) }}
          className="mt-2 text-xs text-gray-600 hover:underline">↩️ Devolver ao marketing (ainda não está pronto)</button>
      )}
      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
    </div>
  )
}
