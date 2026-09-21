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
  }
}

export function EditTenantRow({ tenant }: Props) {
  const checkRef = useRef<HTMLInputElement>(null)
  const [isPending, startTransition] = useTransition()

  async function handleSubmit(formData: FormData) {
    startTransition(async () => {
      await updateTenantData(formData)
      // Fecha o form apos salvar com sucesso
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
        <form action={handleSubmit} className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <input type="hidden" name="tenant_id" value={tenant.id} />
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Nome</label>
            <input
              name="name"
              defaultValue={tenant.name}
              required
              disabled={isPending}
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-[#1B556B] focus:outline-none disabled:opacity-60"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Slug</label>
            <input
              name="slug"
              defaultValue={tenant.slug}
              required
              pattern="[a-z0-9-]+"
              disabled={isPending}
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-[#1B556B] focus:outline-none disabled:opacity-60"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Plano</label>
            <select
              name="plan"
              defaultValue={tenant.plan}
              disabled={isPending}
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-[#1B556B] focus:outline-none disabled:opacity-60"
            >
              <option value="starter">Starter</option>
              <option value="professional">Professional</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Max. usuarios</label>
            <input
              name="max_users"
              type="number"
              defaultValue={tenant.max_users}
              min={1}
              max={500}
              disabled={isPending}
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-[#1B556B] focus:outline-none disabled:opacity-60"
            />
          </div>
          <div className="md:col-span-4 flex justify-end gap-2 pt-1">
            <label
              htmlFor={`edit-${tenant.id}`}
              className="text-xs px-4 py-1.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-100 cursor-pointer font-medium"
            >
              Cancelar
            </label>
            <button
              type="submit"
              disabled={isPending}
              className="text-xs px-4 py-1.5 rounded bg-[#1B556B] text-white hover:bg-[#154459] font-medium transition-colors disabled:opacity-60"
            >
              {isPending ? 'Salvando...' : 'Salvar alteracoes'}
            </button>
          </div>
        </form>
      </div>
    </>
  )
}
