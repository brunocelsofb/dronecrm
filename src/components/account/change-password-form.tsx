'use client'

// Trocar a própria senha (Minha conta). Com senha provisória, a tela pede a troca antes de seguir.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { changeOwnPassword } from '@/lib/actions/password'
import { PASSWORD_MIN } from '@/lib/auth/password'

const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-700 focus:outline-none'

export function ChangePasswordForm({ forced }: { forced: boolean }) {
  const router = useRouter()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setMsg(null)
    const r = await changeOwnPassword({ current, next, confirm })
    setBusy(false)
    if (!r.ok) { setMsg({ ok: false, text: r.error }); return }
    setCurrent(''); setNext(''); setConfirm('')
    setMsg({ ok: true, text: 'Senha trocada.' })
    if (forced) window.location.assign('/')
    else router.refresh()
  }
  return (
    <form onSubmit={submit} className={`space-y-3 rounded-lg border bg-white p-4 ${forced ? 'border-warn-600' : 'border-gray-200'}`}>
      <div>
        <h2 className="text-sm font-semibold text-gray-900">{forced ? 'Crie a sua senha para continuar' : 'Trocar senha'}</h2>
        <p className="mt-0.5 text-xs text-gray-500">{forced ? 'O administrador definiu uma senha provisória. Troque agora por uma só sua.' : `Mínimo de ${PASSWORD_MIN} caracteres, com letras e números.`}</p>
      </div>
      <div><label htmlFor="pw-cur" className="mb-1 block text-xs font-medium text-gray-600">{forced ? 'Senha provisória' : 'Senha atual'}</label>
        <input id="pw-cur" type="password" autoComplete="current-password" className={inp} value={current} onChange={e => setCurrent(e.target.value)} required /></div>
      <div><label htmlFor="pw-new" className="mb-1 block text-xs font-medium text-gray-600">Nova senha</label>
        <input id="pw-new" type="password" autoComplete="new-password" minLength={PASSWORD_MIN} className={inp} value={next} onChange={e => setNext(e.target.value)} required /></div>
      <div><label htmlFor="pw-conf" className="mb-1 block text-xs font-medium text-gray-600">Repita a nova senha</label>
        <input id="pw-conf" type="password" autoComplete="new-password" className={inp} value={confirm} onChange={e => setConfirm(e.target.value)} required /></div>
      <button type="submit" disabled={busy} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">{busy ? 'Trocando…' : 'Trocar senha'}</button>
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`text-sm ${msg.ok ? 'text-positive-700' : 'text-negative-700'}`}>{msg.text}</p>}
    </form>
  )
}
