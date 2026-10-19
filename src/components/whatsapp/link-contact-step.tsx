'use client'

// Vincular conversa → passo obrigatório: quem é esta pessoa na empresa da conta.

import { useEffect, useState } from 'react'
import { getLinkContext, linkConversationWithContact, type LinkContext } from '@/lib/actions/whatsapp-link'

const input = 'w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none'

export function LinkContactStep({ phone, contractId, suggestedName, onDone, onCancel }: {
  phone: string; contractId: string; suggestedName: string | null
  onDone: (msg: string) => void; onCancel: () => void
}) {
  const [ctx, setCtx] = useState<LinkContext | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'existing' | 'other' | 'new'>('new')
  const [pick, setPick] = useState('')
  const [name, setName] = useState(suggestedName ?? '')
  const [role, setRole] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    getLinkContext(phone, contractId).then(r => {
      if (!alive) return
      if (!r.ok) { setError(r.error); return }
      setCtx(r.ctx)
      if (r.ctx.existing.length) { setMode('existing'); setPick(r.ctx.existing[0].id) }
    })
    return () => { alive = false }
  }, [phone, contractId])

  async function submit() {
    setBusy(true); setError(null)
    const r = await linkConversationWithContact(phone, contractId,
      mode === 'new' ? { name, role, email } : { contactId: pick, addPhoneToContact: mode === 'other' })
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    onDone(r.linkedMessages
      ? `Conversa vinculada e ${r.contactName} registrado(a) como contato da conta.`
      : `${r.contactName} registrado(a) como contato da conta. As mensagens já estavam vinculadas.`)
  }

  if (!ctx) {
    return (
      <div className="mt-2 rounded-lg border border-gray-200 bg-white p-3 text-xs text-gray-500">
        {error ? <span className="text-negative-700">{error}</span> : 'Carregando a conta…'}
        <button type="button" onClick={onCancel} className="ml-3 text-gray-500 underline">Voltar</button>
      </div>
    )
  }

  return (
    <div className="mt-2 space-y-3 rounded-lg border border-brand-700/30 bg-white p-3">
      <div>
        <p className="text-sm font-semibold text-gray-900">Quem é esta pessoa na conta?</p>
        <p className="text-xs text-gray-500">
          Conta: <b>{ctx.contract.label}</b>{ctx.contract.number ? ` · ${ctx.contract.number}` : ''}
          {ctx.company ? <> · Empresa: <b>{ctx.company.name}</b>{ctx.company.cnpj ? ` (CNPJ ${ctx.company.cnpj})` : ''}</> : null}
        </p>
      </div>

      {!ctx.company ? (
        <p className="rounded-md bg-warn-100 px-3 py-2 text-xs text-warn-700">
          Esta oportunidade não tem empresa vinculada. Abra a oportunidade, vincule a empresa e volte para vincular a conversa.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-3 text-sm">
            {ctx.existing.length > 0 && (
              <label className="flex items-center gap-1.5"><input type="radio" checked={mode === 'existing'} onChange={() => { setMode('existing'); setPick(ctx.existing[0].id) }} /> Já cadastrado com este número</label>
            )}
            {ctx.others.length > 0 && (
              <label className="flex items-center gap-1.5"><input type="radio" checked={mode === 'other'} onChange={() => { setMode('other'); setPick(ctx.others[0].id) }} /> Outro contato da empresa</label>
            )}
            <label className="flex items-center gap-1.5"><input type="radio" checked={mode === 'new'} onChange={() => setMode('new')} /> Novo contato</label>
          </div>

          {mode === 'existing' && (
            <select className={input} value={pick} onChange={e => setPick(e.target.value)}>
              {ctx.existing.map(c => <option key={c.id} value={c.id}>{c.name}{c.role ? ` · ${c.role}` : ''}{c.email ? ` · ${c.email}` : ''}</option>)}
            </select>
          )}
          {mode === 'other' && (
            <>
              <select className={input} value={pick} onChange={e => setPick(e.target.value)}>
                {ctx.others.map(c => <option key={c.id} value={c.id}>{c.name}{c.role ? ` · ${c.role}` : ''}</option>)}
              </select>
              <p className="text-[11px] text-gray-500">Este número será acrescentado ao cadastro do contato escolhido.</p>
            </>
          )}
          {mode === 'new' && (
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="block"><span className="text-[10px] font-medium uppercase text-gray-500">Nome *</span>
                <input className={input} value={name} maxLength={120} onChange={e => setName(e.target.value)} autoFocus /></label>
              <label className="block"><span className="text-[10px] font-medium uppercase text-gray-500">Cargo</span>
                <input className={input} value={role} maxLength={80} onChange={e => setRole(e.target.value)} placeholder="Ex.: Gerente de manutenção" /></label>
              <label className="block"><span className="text-[10px] font-medium uppercase text-gray-500">E-mail</span>
                <input className={input} value={email} maxLength={200} onChange={e => setEmail(e.target.value)} type="email" /></label>
              <p className="text-[11px] text-gray-500 sm:col-span-3">Telefone: {phone} (do WhatsApp). O contato entra na empresa e na oportunidade.</p>
            </div>
          )}
        </>
      )}

      {error && <p className="text-xs text-negative-700">{error}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={busy || !ctx.company || (mode === 'new' ? !name.trim() : !pick)} onClick={submit}
          className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-800 disabled:opacity-40">
          {busy ? 'Vinculando…' : 'Salvar contato e vincular'}
        </button>
        <button type="button" onClick={onCancel} className="px-2 text-xs text-gray-500">Cancelar</button>
      </div>
    </div>
  )
}
