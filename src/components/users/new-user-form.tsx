'use client'

import { useActionState, useRef, useEffect } from 'react'
import { createUserByAdmin, type ActionState } from '@/lib/actions/users'
import { DEPARTMENTS } from '@/lib/constants/departments'

const initialState: ActionState = {}

export function NewUserForm({ areas = [] }: { areas?: { id: string; label: string }[] }) {
  const [state, formAction, pending] = useActionState(createUserByAdmin, initialState)
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (!pending && !state.error) {
      formRef.current?.reset()
    }
  }, [pending, state])

  return (
    <form ref={formRef} action={formAction} className="grid grid-cols-2 gap-3 rounded-lg border border-gray-200 bg-white p-4">
      <div>
        <label className="block text-xs font-medium text-gray-700">Nome e sobrenome *</label>
        <input
          name="full_name"
          required
          pattern="\S+(\s+\S+)+"
          title="Nome e sobrenome"
          className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700">E-mail *</label>
        <input
          name="email"
          type="email"
          required
          className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700">Telefone (WhatsApp) com DDD *</label>
        <input
          name="phone"
          type="tel"
          inputMode="tel"
          required
          placeholder="(11) 91234-5678"
          className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700">Senha provisória *</label>
        <input
          name="password"
          type="text"
          required
          minLength={8}
          placeholder="Mín. 8, letras e números"
          className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none"
        />
        <p className="mt-1 text-xs text-gray-400">Mínimo de 8 caracteres, com letras e números. Repasse à pessoa: no primeiro acesso o Drone pede para ela criar a própria senha.</p>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700">Papel</label>
        <select
          name="role"
          defaultValue="member"
          className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none"
        >
          <option value="member">Membro</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700">Área (se não for Admin)</label>
        <select
          name="access_profile"
          defaultValue="gestor"
          className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none"
        >
          {areas.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700">Área de trabalho *</label>
        <select
          name="department"
          required
          defaultValue=""
          className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none"
        >
          <option value="" disabled>Escolha a área</option>
          {DEPARTMENTS.map((d) => (
            <option key={d.value} value={d.value}>{d.label}</option>
          ))}
        </select>
      </div>

      {state.error && <p className="col-span-2 text-xs text-red-600">{state.error}</p>}

      <div className="col-span-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
        >
          {pending ? 'Criando...' : '+ Criar Usuário'}
        </button>
      </div>
    </form>
  )
}
