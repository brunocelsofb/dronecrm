'use client'

// Configurações → Théo: a empresa liga a(s) IA(s) com a própria chave (paga o uso),
// escolhe qual está em uso, vê o gasto do mês por IA e libera o Théo para outras pessoas.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { THEO_PROVIDERS, type TheoProvider } from '@/lib/ai/theo-catalog'
import { saveTheoKey, removeTheoKey, setTheoActive, setTheoUsers } from '@/lib/actions/theo'
import { fmtNum1 } from '@/lib/format'

type ProviderState = { last4: string | null; model: string; costUsd: number; calls: number }
const usd = (v: number) => `US$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function TheoSettingsView({ active, providers, budgetUsd, monthTotalUsd, users, allowed }: {
  active: TheoProvider | null
  providers: Record<TheoProvider, ProviderState>
  budgetUsd: number
  monthTotalUsd: number
  users: { id: string; name: string }[]
  allowed: string[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [models, setModels] = useState<Record<string, string>>(() => Object.fromEntries(THEO_PROVIDERS.map(p => [p.id, providers[p.id].model])))
  const [sel, setSel] = useState<Set<string>>(new Set(allowed))

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) => start(async () => {
    const r = await fn()
    setMsg(r.ok ? { ok: true, text: okText } : { ok: false, text: r.error ?? 'Não deu certo.' })
    if (r.ok) router.refresh()
  })
  const pct = budgetUsd > 0 ? Math.min(100, (monthTotalUsd / budgetUsd) * 100) : 0

  return (
    <div className="space-y-6">
      {msg && <p role="status" className={`rounded-md px-3 py-2 text-sm ${msg.ok ? 'bg-positive-100 text-positive-700' : 'bg-red-50 text-red-700'}`}>{msg.text}</p>}

      <section className="rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-900">IA do Théo</h2>
        <p className="mt-1 text-xs text-gray-500">
          Ligue uma ou mais IAs com a chave da empresa: o uso é cobrado na conta de IA da própria empresa. Dá para deixar as três ligadas,
          alternar qual está em uso e comparar o gasto do mês de cada uma.
        </p>
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          {THEO_PROVIDERS.map(p => {
            const st = providers[p.id]
            const isActive = active === p.id
            return (
              <div key={p.id} className={`rounded-lg border p-4 ${isActive ? 'border-brand-700 ring-1 ring-brand-700' : 'border-gray-200'}`}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-gray-900">{p.label}</p>
                  {isActive ? <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-semibold text-brand-700">EM USO</span>
                    : st.last4 ? <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600">ligada</span> : null}
                </div>
                <label className="mt-3 block text-xs font-medium text-gray-700">Modelo
                  <select value={models[p.id]} onChange={e => setModels(m => ({ ...m, [p.id]: e.target.value }))}
                    className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-brand-700 focus:outline-none">
                    {p.models.map(m => <option key={m.id} value={m.id}>{m.label} — US$ {m.input} / {m.output} por milhão</option>)}
                  </select>
                </label>
                {st.last4 ? (
                  <p className="mt-2 text-xs text-gray-600">Chave cadastrada: ••••{st.last4}</p>
                ) : (
                  <p className="mt-2 text-xs text-gray-500">{p.keyHelp} <a href={p.keyUrl} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline">Criar chave ↗</a></p>
                )}
                <input type="password" autoComplete="off" value={keys[p.id] ?? ''} onChange={e => setKeys(k => ({ ...k, [p.id]: e.target.value }))}
                  placeholder={st.last4 ? 'Trocar a chave (opcional)' : 'Cole a chave (API key)'}
                  aria-label={`Chave da ${p.label}`}
                  className="mt-2 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-brand-700 focus:outline-none" />
                <div className="mt-3 flex flex-wrap gap-2">
                  {(keys[p.id] ?? '').trim() && (
                    <button disabled={pending} onClick={() => run(async () => { const r = await saveTheoKey(p.id, keys[p.id], models[p.id]); if (r.ok) setKeys(k => ({ ...k, [p.id]: '' })); return r }, `Chave da ${p.label} conferida e salva.`)}
                      className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50">Conferir e salvar</button>
                  )}
                  {st.last4 && (!isActive || models[p.id] !== st.model) && (
                    <button disabled={pending} onClick={() => run(() => setTheoActive(p.id, models[p.id]), `${p.label} em uso.`)}
                      className="rounded-md border border-brand-700 px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-50">
                      {isActive ? 'Trocar modelo' : 'Usar esta'}</button>
                  )}
                  {st.last4 && (
                    <button disabled={pending} onClick={() => { if (confirm(`Desligar a ${p.label}? A chave é apagada daqui.`)) run(() => removeTheoKey(p.id), 'IA desligada.') }}
                      className="rounded-md px-2 py-1.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50">Desligar</button>
                  )}
                </div>
                <p className="mt-3 border-t border-gray-100 pt-2 text-xs text-gray-500">Este mês: <b className="text-gray-800">{usd(st.costUsd)}</b> em {st.calls} pergunta(s)</p>
              </div>
            )
          })}
        </div>
        <p className="mt-3 text-[11px] text-gray-400">Preços por 1 milhão de tokens conferidos em 01/11/2026 nos sites das empresas; o gasto mostrado é estimativa — a cobrança real é a da conta de IA.</p>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-900">Gasto do mês</h2>
        <p className="mt-1 text-sm text-gray-700">{usd(monthTotalUsd)} de {usd(budgetUsd)} ({fmtNum1(pct)}%)</p>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
          <div className={`h-full ${pct >= 90 ? 'bg-warn-600' : 'bg-positive-600'}`} style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1 text-xs text-gray-400">Quando passar do limite, o Théo para até o mês seguinte. O limite fica logo abaixo.</p>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-900">Quem usa o Théo</h2>
        <p className="mt-1 text-xs text-gray-500">Administradores sempre usam. Marque outras pessoas da equipe: cada uma só consulta e faz o que o perfil dela já permite nas telas.</p>
        {users.length === 0 ? <p className="mt-3 text-xs text-gray-400">Nenhuma outra pessoa na equipe.</p> : (
          <div className="mt-3 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {users.map(u => (
              <label key={u.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-gray-50">
                <input type="checkbox" checked={sel.has(u.id)} onChange={() => setSel(s => { const n = new Set(s); if (n.has(u.id)) n.delete(u.id); else n.add(u.id); return n })} className="h-4 w-4 accent-[#1b556b]" />
                {u.name}
              </label>
            ))}
          </div>
        )}
        {users.length > 0 && (
          <button disabled={pending} onClick={() => run(() => setTheoUsers([...sel]), 'Acesso ao Théo atualizado.')}
            className="mt-3 rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50">Salvar quem usa</button>
        )}
      </section>
    </div>
  )
}
