'use client'

import { useRef, useTransition } from 'react'
import { updateTenantData } from '@/lib/actions/super-admin'

interface Props {
  tenant: {
    id: string
    name: string
    slug: string
    plan: string
    max_users: number
    trial_ends_at: string | null
  }
}

export function EditTenantRow({ tenant }: Props) {
  const checkRef = useRef<HTMLInputElement>(null)
  const [isPending, startTransition] = useTransition()

  // Formata para input type=datetime-local (YYYY-MM-DDTHH:mm)
  const trialForInput = tenant.trial_ends_at
    ? new Date(tenant.trial_ends_at).toISOString().slice(0, 16)
    : ''

  async function handleSubmit(formData: FormData) {
    startTransition(async () => {
      await updateTenantData(formData)
      if (checkRef.current) checkRef.current.checked = false
    })
  }

  return (
    <>
      <input
        ref={checkRef}
        type="checkbox"
        id={`edit-${tenant.id}`}
        className="hidden peer/edit"
      />
      <div className="hidden peer-checked/edit:block bg-blue-50 border-b border-blue-100 px-6 py-4">
        <p className="text-xs font-semibold text-blue-700 mb-3 uppercase tracking-wide">
          Editando: {tenant.name}
        </p>
        <form action={handleSubmit} className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <input type="hidden" name="tenant_id" value={tenant.id} />
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Nome</label>
            <input
              name="name"
              defaultValue={tenant.name}
              required
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Slug</label>
            <input
              name="slug"
              defaultValue={tenant.slug}
              required
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Plano</label>
            <select
              name="plan"
              defaultValue={tenant.plan}
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            >
              <option value="starter">Starter</option>
              <option value="professional">Professional</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Máx. Usuários</label>
            <input
              name="max_users"
              type="number"
              min="1"
              defaultValue={tenant.max_users}
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Fim do Trial (deixe vazio para remover)
            </label>
            <input
              name="trial_ends_at"
              type="datetime-local"
              defaultValue={trialForInput}
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div className="col-span-3 flex gap-2 pt-1">
            <button
              type="submit"
              disabled={isPending}
              className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isPending ? 'Salvando...' : 'Salvar alterações'}
            </button>
            <label
              htmlFor={`edit-${tenant.id}`}
              className="cursor-pointer rounded border border-gray-300 px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
            >
              Cancelar
            </label>
          </div>
        </form>
      </div>
    </>
  )
}
