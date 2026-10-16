'use client'

import { ACCESS_PROFILES } from '@/lib/auth/access-profiles'

export function UserAccessSelect({
  defaultValue,
  action,
}: {
  defaultValue: string | null
  action: (formData: FormData) => void
}) {
  return (
    <form action={action}>
      <select
        name="access_profile"
        defaultValue={defaultValue ?? 'gestor'}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        title={ACCESS_PROFILES.find(p => p.id === (defaultValue ?? 'gestor'))?.description}
        className="rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-brand-700 focus:outline-none"
      >
        {ACCESS_PROFILES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
    </form>
  )
}
