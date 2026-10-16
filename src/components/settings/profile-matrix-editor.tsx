'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { saveProfileFeatures } from '@/lib/actions/access-profiles'
import { DEFAULT_PROFILE_FEATURES, type AccessProfile } from '@/lib/auth/access-profiles'

type Profile = { id: AccessProfile; label: string; description: string; people: number }

export function ProfileMatrixEditor({ features, profiles, initial, customized }: {
  features: { key: string; label: string }[]
  profiles: Profile[]
  initial: Record<AccessProfile, string[]>
  customized: boolean
}) {
  const router = useRouter()
  const [matrix, setMatrix] = useState<Record<AccessProfile, string[]>>(initial)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()

  const toggle = (p: AccessProfile, f: string) => setMatrix(m => ({
    ...m, [p]: m[p].includes(f) ? m[p].filter(x => x !== f) : [...m[p], f],
  }))

  const save = (value: Record<AccessProfile, string[]> | null, okText: string) => start(async () => {
    const r = await saveProfileFeatures(value)
    setMsg(r.ok ? { ok: true, text: okText } : { ok: false, text: r.error })
    if (r.ok) { if (!value) setMatrix(DEFAULT_PROFILE_FEATURES); router.refresh() }
  })

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-gray-500">Aba</th>
              {profiles.map(p => (
                <th key={p.id} className="px-3 py-2 text-center font-medium text-gray-700" title={p.description}>
                  <span className="block">{p.label}</span>
                  <span className="block text-[11px] font-normal text-gray-400">{p.people} {p.people === 1 ? 'pessoa' : 'pessoas'}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {features.map(f => (
              <tr key={f.key} className="hover:bg-gray-50">
                <td className="px-3 py-2 text-gray-800">{f.label}</td>
                {profiles.map(p => (
                  <td key={p.id} className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      aria-label={`${f.label} para ${p.label}`}
                      checked={matrix[p.id].includes(f.key)}
                      onChange={() => toggle(p.id, f.key)}
                      className="h-4 w-4 accent-brand-700"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="grid gap-1 text-xs text-gray-500 sm:grid-cols-2">
        {profiles.map(p => <li key={p.id}><strong className="text-gray-700">{p.label}:</strong> {p.description}</li>)}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending} onClick={() => save(matrix, 'Perfis salvos. O menu de cada pessoa muda no próximo carregamento.')}
          className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">
          {pending ? 'Salvando…' : 'Salvar'}
        </button>
        {customized && (
          <button disabled={pending} onClick={() => save(null, 'Voltou ao padrão do sistema.')} className="text-sm text-gray-500 hover:underline">
            Voltar ao padrão
          </button>
        )}
        {msg && <span role="status" className={`text-sm ${msg.ok ? 'text-positive-700' : 'text-red-600'}`}>{msg.text}</span>}
      </div>
    </div>
  )
}
