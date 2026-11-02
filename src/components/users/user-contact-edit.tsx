'use client'
// Nome e telefone do login, editáveis na lista (cadastro completo: nome e sobrenome, telefone, área e e-mail)
import { useState, useTransition } from 'react'
import { updateUserContact } from '@/lib/actions/users'
import { profileProblems } from '@/lib/people/profile-complete'

export function UserContactEdit({ id, fullName, phone, email, department }: { id: string; fullName: string; phone: string; email: string; department: string | null }) {
  const [v, setV] = useState({ full_name: fullName, phone })
  const [saved, setSaved] = useState(v)
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const save = () => {
    if (v.full_name === saved.full_name && v.phone === saved.phone) return
    start(async () => {
      const r = await updateUserContact(id, v)
      if (r.error) { setMsg(r.error); setV(saved) } else { setSaved(v); setMsg(null) }
    })
  }
  const missing = profileProblems({ full_name: v.full_name, phone: v.phone, department, email })
  const input = 'w-full rounded border border-transparent px-1 py-0.5 hover:border-gray-200 focus:border-brand-700 focus:outline-none'
  return (
    <div className="min-w-[12rem]">
      <input value={v.full_name} disabled={pending} aria-label="Nome e sobrenome" onChange={e => setV({ ...v, full_name: e.target.value })} onBlur={save}
        className={`${input} font-medium text-gray-900`} />
      <p className="px-1 text-xs text-gray-400">{email}</p>
      <input value={v.phone} disabled={pending} inputMode="tel" placeholder="Telefone com DDD" aria-label="Telefone" onChange={e => setV({ ...v, phone: e.target.value })} onBlur={save}
        className={`${input} text-xs text-gray-600`} />
      {missing.length > 0 && <p className="px-1 text-[11px] text-warn-700">Cadastro incompleto: falta {missing.join(', ')}.</p>}
      {msg && <p className="px-1 text-[11px] text-negative-600">{msg}</p>}
    </div>
  )
}
