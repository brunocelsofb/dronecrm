'use client'

// Admin: definir uma senha provisória para alguém da equipe (troca obrigatória no próximo acesso)
import { useState } from 'react'
import { adminResetPassword } from '@/lib/actions/password'
import { PASSWORD_MIN } from '@/lib/auth/password'

export function ResetPasswordButton({ userId, name }: { userId: string; name: string }) {
  const [open, setOpen] = useState(false)
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  if (!open) return <button type="button" onClick={() => { setOpen(true); setMsg(null) }} className="text-xs text-brand-700 hover:underline">Redefinir senha</button>
  async function save() {
    setBusy(true); setMsg(null)
    const r = await adminResetPassword(userId, pw)
    setBusy(false)
    if (!r.ok) { setMsg({ ok: false, text: r.error }); return }
    setPw(''); setMsg({ ok: true, text: `Pronto. Passe a senha provisória para ${name}; no próximo acesso o Drone pede para trocar.` })
  }
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {!msg?.ok && <>
        <input type="text" autoComplete="off" aria-label={`Senha provisória para ${name}`} placeholder={`Senha provisória (mín. ${PASSWORD_MIN})`} value={pw} onChange={e => setPw(e.target.value)} className="w-48 rounded border border-gray-300 px-2 py-1 text-xs" />
        <button type="button" disabled={busy || !pw} onClick={save} className="rounded bg-brand-700 px-2 py-1 text-xs text-white disabled:opacity-50">{busy ? 'Salvando…' : 'Salvar'}</button>
      </>}
      <button type="button" onClick={() => { setOpen(false); setPw(''); setMsg(null) }} className="text-xs text-gray-500">{msg?.ok ? 'Fechar' : 'Cancelar'}</button>
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`w-full text-right text-xs ${msg.ok ? 'text-positive-700' : 'text-negative-700'}`}>{msg.text}</p>}
    </div>
  )
}
