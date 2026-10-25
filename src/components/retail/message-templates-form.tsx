'use client'

// Modelos de texto por etapa do pedido (WhatsApp e e-mail), com as variáveis disponíveis
import { useState } from 'react'
import { saveRetailMessageTemplates } from '@/lib/actions/retail-order-messages'
import { DEFAULT_TEMPLATES, MESSAGE_STAGES, MESSAGE_VARS, type MessageStage, type MessageTemplates } from '@/lib/retail/order-messages'

const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-700 focus:outline-none disabled:bg-gray-50'
const lbl = 'mb-1 block text-xs font-medium text-gray-600'

export function MessageTemplatesForm({ initial, canEdit }: { initial: MessageTemplates; canEdit: boolean }) {
  const [t, setT] = useState<MessageTemplates>(initial)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const set = (s: MessageStage, k: 'wa' | 'subject' | 'email', v: string) => setT(p => ({ ...p, [s]: { ...p[s], [k]: v } }))

  async function save() {
    setBusy(true); setMsg(null)
    const r = await saveRetailMessageTemplates(t)
    setBusy(false)
    setMsg(r.ok ? { ok: true, text: 'Modelos salvos. Valem para os próximos rascunhos.' } : { ok: false, text: r.error })
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
        <h2 className="font-semibold text-gray-900">Como funciona</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-gray-700">
          <li>O pedido muda de etapa (a equipe muda; o pagamento o Drone confere sozinho).</li>
          <li>O Drone monta o rascunho com este modelo e os dados do pedido.</li>
          <li>No pedido, aparece &quot;Para revisar&quot;: a equipe ajusta e envia, ou descarta.</li>
        </ol>
        <p className="mt-3 text-xs text-gray-500">Variáveis (escreva com chaves duplas):</p>
        <ul className="mt-1 grid grid-cols-1 gap-x-4 gap-y-0.5 text-xs text-gray-600 sm:grid-cols-2">
          {MESSAGE_VARS.map(v => <li key={v.key}><code className="rounded bg-gray-100 px-1">{`{{${v.key}}}`}</code> {v.label}</li>)}
        </ul>
        {!canEdit && <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">Só o administrador muda os modelos.</p>}
      </section>

      {MESSAGE_STAGES.map(s => (
        <section key={s.id} className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-gray-900">{s.label}</h2>
            <span className="text-xs text-gray-500">{s.when}</span>
          </div>
          <div><label className={lbl} htmlFor={`wa-${s.id}`}>WhatsApp</label><textarea id={`wa-${s.id}`} className={inp} rows={5} value={t[s.id].wa} onChange={e => set(s.id, 'wa', e.target.value)} disabled={!canEdit} /></div>
          <details className="rounded-lg bg-gray-50 px-3 py-2">
            <summary className="cursor-pointer text-sm text-gray-700">E-mail (opcional no envio)</summary>
            <div className="mt-2 space-y-2">
              <div><label className={lbl} htmlFor={`sub-${s.id}`}>Assunto</label><input id={`sub-${s.id}`} className={inp} value={t[s.id].subject} onChange={e => set(s.id, 'subject', e.target.value)} disabled={!canEdit} /></div>
              <div><label className={lbl} htmlFor={`em-${s.id}`}>Texto</label><textarea id={`em-${s.id}`} className={inp} rows={6} value={t[s.id].email} onChange={e => set(s.id, 'email', e.target.value)} disabled={!canEdit} /></div>
            </div>
          </details>
          {canEdit && <button type="button" onClick={() => setT(p => ({ ...p, [s.id]: DEFAULT_TEMPLATES[s.id] }))} className="text-xs text-gray-500 underline">Voltar ao texto padrão</button>}
        </section>
      ))}

      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? 'bg-positive-100 text-positive-700' : 'bg-negative-100 text-negative-700'}`}>{msg.text}</p>}
      {canEdit && <div className="flex justify-end"><button type="button" onClick={save} disabled={busy} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">{busy ? 'Salvando…' : 'Salvar modelos'}</button></div>}
    </div>
  )
}
