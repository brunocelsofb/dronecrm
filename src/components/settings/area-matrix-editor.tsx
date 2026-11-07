'use client'
// Configurações → Áreas e acessos: abas de cada área, se vê valores, criar/renomear/excluir.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { saveProfileFeatures, setAreaSeesValues, renameArea, createArea, deleteArea, restoreArea } from '@/lib/actions/access-profiles'

type AreaView = { id: string; label: string; description: string; seesValues: boolean; builtin: boolean; features: string[]; people: number }

export function AreaMatrixEditor({ features, areas, hiddenBuiltins, customized }: {
  features: { key: string; label: string }[]
  areas: AreaView[]
  hiddenBuiltins: { id: string; label: string }[]
  customized: boolean
}) {
  const router = useRouter()
  const [matrix, setMatrix] = useState<Record<string, string[]>>(Object.fromEntries(areas.map(a => [a.id, a.features])))
  const [values, setValues] = useState<Record<string, boolean>>(Object.fromEntries(areas.map(a => [a.id, a.seesValues])))
  const [newName, setNewName] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okText: string, refresh = true) => start(async () => {
    const r = await fn()
    setMsg(r.ok ? { ok: true, text: okText } : { ok: false, text: (r as { error?: string }).error ?? 'Erro.' })
    if (r.ok && refresh) router.refresh()
  })
  const toggle = (a: string, f: string) => setMatrix(m => ({ ...m, [a]: (m[a] ?? []).includes(f) ? m[a].filter(x => x !== f) : [...(m[a] ?? []), f] }))

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-gray-500">Área</th>
              {areas.map(a => (
                <th key={a.id} className="min-w-[110px] px-2 py-2 text-center align-top font-medium text-gray-700" title={a.description}>
                  <button className="block w-full text-center hover:underline" title="Renomear"
                    onClick={() => { const n = prompt('Nome da área', a.label); if (n && n.trim() && n !== a.label) run(() => renameArea(a.id, n), 'Área renomeada.') }}>
                    {a.label}
                  </button>
                  <span className="block text-[11px] font-normal text-gray-400">{a.people} {a.people === 1 ? 'pessoa' : 'pessoas'}</span>
                  {a.id !== 'gestor' && (
                    <button className="mt-0.5 text-[11px] font-normal text-gray-400 hover:text-negative-600" disabled={pending}
                      onClick={() => { if (confirm(`Excluir a área "${a.label}"?`)) run(() => deleteArea(a.id), 'Área excluída.') }}>
                      excluir
                    </button>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            <tr className="bg-warn-100/40">
              <td className="px-3 py-2 font-medium text-gray-900">Vê valores
                <span className="block text-[11px] font-normal text-gray-500">contratos, propostas, funil, faturamento</span>
              </td>
              {areas.map(a => (
                <td key={a.id} className="px-2 py-2 text-center">
                  <input type="checkbox" className="h-4 w-4 accent-brand-700" checked={!!values[a.id]} disabled={pending}
                    aria-label={`${a.label} vê valores`}
                    onChange={e => { const on = e.target.checked; setValues(v => ({ ...v, [a.id]: on })); run(() => setAreaSeesValues(a.id, on), 'Salvo.', false) }} />
                </td>
              ))}
            </tr>
            {features.map(f => (
              <tr key={f.key} className="hover:bg-gray-50">
                <td className="px-3 py-2 text-gray-800">{f.label}</td>
                {areas.map(a => (
                  <td key={a.id} className="px-2 py-2 text-center">
                    <input type="checkbox" aria-label={`${f.label} para ${a.label}`} className="h-4 w-4 accent-brand-700"
                      checked={(matrix[a.id] ?? []).includes(f.key)} onChange={() => toggle(a.id, f.key)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending} onClick={() => run(() => saveProfileFeatures(matrix), 'Abas salvas. O menu de cada pessoa muda no próximo carregamento.')}
          className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">
          {pending ? 'Salvando…' : 'Salvar abas'}
        </button>
        {customized && (
          <button disabled={pending} onClick={() => run(() => saveProfileFeatures(null), 'Abas voltaram ao padrão.')} className="text-sm text-gray-500 hover:underline">
            Abas ao padrão
          </button>
        )}
        {msg && <span role="status" className={`text-sm ${msg.ok ? 'text-positive-700' : 'text-negative-600'}`}>{msg.text}</span>}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-3">
        <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Nova área (ex.: Jurídico)"
          className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none" />
        <button disabled={pending || !newName.trim()} onClick={() => { const n = newName; setNewName(''); run(() => createArea(n), 'Área criada: marque as abas e salve.') }}
          className="rounded-md border border-brand-700 px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-100 disabled:opacity-50">
          + Criar área
        </button>
        {hiddenBuiltins.length > 0 && (
          <span className="text-xs text-gray-500">
            Excluídas: {hiddenBuiltins.map(h => (
              <button key={h.id} className="ml-1 text-brand-700 hover:underline" onClick={() => run(() => restoreArea(h.id), 'Área de volta.')}>{h.label} ↺</button>
            ))}
          </span>
        )}
      </div>

      <ul className="grid gap-1 text-xs text-gray-500 sm:grid-cols-2">
        {areas.map(a => <li key={a.id}><strong className="text-gray-700">{a.label}:</strong> {a.description || 'Área criada pela empresa.'}</li>)}
      </ul>
    </div>
  )
}
