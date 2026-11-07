'use client'
// Central de atendimento: transferir conversa para uma pessoa ou para a fila de uma área, com nota.
import { useEffect, useState, useTransition } from 'react'
import { listTransferTargets, transferConversation, type TransferShare } from '@/lib/actions/whatsapp-central'

const SHARES: { id: TransferShare; label: string; hint: string }[] = [
  { id: 'nota', label: 'Só a nota', hint: 'Quem recebe vê a sua nota e as mensagens daqui em diante (recomendado).' },
  { id: 'atendimento', label: 'Atendimento atual', hint: 'Vê também as mensagens deste atendimento (desde o protocolo).' },
  { id: 'tudo', label: 'Todo o histórico', hint: 'Vê todas as conversas anteriores com este contato.' },
]

export function CentralTransferModal({ phone, instance, onClose, onDone }: {
  phone: string; instance: string; onClose: () => void; onDone: () => void
}) {
  const [targets, setTargets] = useState<{ people: { id: string; name: string; area: string }[]; areas: { id: string; label: string }[] } | null>(null)
  const [to, setTo] = useState('')               // "u:<id>" ou "a:<area>"
  const [note, setNote] = useState('')
  const [share, setShare] = useState<TransferShare>('nota')
  const [notify, setNotify] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  useEffect(() => { listTransferTargets().then(setTargets).catch(() => setTargets({ people: [], areas: [] })) }, [])

  const submit = () => start(async () => {
    setError(null)
    const [kind, id] = [to.slice(0, 1), to.slice(2)]
    const r = await transferConversation({
      phone, instance, note, share, notifyCustomer: notify,
      toUser: kind === 'u' ? id : null, toArea: kind === 'a' ? id : null,
    })
    if (!r.ok) { setError(r.error); return }
    onDone()
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="central-transfer-title">
      <div className="w-full max-w-md space-y-4 rounded-xl bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 id="central-transfer-title" className="text-sm font-semibold text-gray-900">Transferir conversa</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700" aria-label="Fechar">✕</button>
        </div>

        <label className="block text-xs font-medium text-gray-700">Para
          <select value={to} onChange={e => setTo(e.target.value)} disabled={!targets}
            className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none">
            <option value="">{targets ? 'Escolha uma pessoa ou área…' : 'Carregando…'}</option>
            {targets && targets.areas.length > 0 && (
              <optgroup label="Fila da área (quem estiver livre assume)">
                {targets.areas.map(a => <option key={a.id} value={`a:${a.id}`}>{a.label}</option>)}
              </optgroup>
            )}
            {targets && targets.people.length > 0 && (
              <optgroup label="Pessoa">
                {targets.people.map(p => <option key={p.id} value={`u:${p.id}`}>{p.name} · {p.area}</option>)}
              </optgroup>
            )}
          </select>
        </label>

        <label className="block text-xs font-medium text-gray-700">Nota para quem recebe (obrigatória)
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} maxLength={2000}
            placeholder="Ex.: cliente pediu 2ª via do boleto de outubro; já confirmei o CNPJ."
            className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none" />
          <span className="text-[11px] font-normal text-gray-400">Interna: o cliente não vê.</span>
        </label>

        <fieldset className="space-y-1.5">
          <legend className="text-xs font-medium text-gray-700">O que quem recebe pode ver da conversa</legend>
          {SHARES.map(s => (
            <label key={s.id} className="flex cursor-pointer items-start gap-2 text-xs text-gray-700">
              <input type="radio" name="share" className="mt-0.5 accent-brand-700" checked={share === s.id} onChange={() => setShare(s.id)} />
              <span><b className="font-medium">{s.label}</b> <span className="text-gray-400">— {s.hint}</span></span>
            </label>
          ))}
        </fieldset>

        <label className="flex items-center gap-2 text-xs text-gray-700">
          <input type="checkbox" className="accent-brand-700" checked={notify} onChange={e => setNotify(e.target.checked)} />
          Avisar o cliente da transferência
        </label>

        {error && <p role="alert" className="text-xs text-negative-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">Cancelar</button>
          <button onClick={submit} disabled={pending || !to || note.trim().length < 3}
            className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">
            {pending ? 'Transferindo…' : 'Transferir'}
          </button>
        </div>
      </div>
    </div>
  )
}
