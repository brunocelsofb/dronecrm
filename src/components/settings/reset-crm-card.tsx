'use client'

// "Resetar CRM": apaga tudo da empresa (menos usuários e licença).
// Passos obrigatórios: baixar a cópia e digitar o nome exato da empresa.

import { useState, useTransition } from 'react'
import { resetCrm } from '@/lib/actions/reset'

export function ResetCrmCard({ tenantName, tenantId, compact = false }: { tenantName: string; tenantId?: string; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const [downloaded, setDownloaded] = useState(false)
  const [typed, setTyped] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const exportUrl = '/api/tenant/export'
  const canReset = downloaded && typed.trim() === tenantName.trim() && !pending

  const body = (
    <div className="space-y-3">
      <p className="text-sm text-gray-700">
        Apaga <strong>todos</strong> os dados de <strong>{tenantName}</strong>: contratos, oportunidades, leads, empresas, contatos,
        atividades, mensagens, propostas, chamados, pesquisas, funis e etapas, WhatsApps conectados (inclusive no servidor),
        agentes IA (chave e textos) e configurações. Ficam só os <strong>usuários</strong> e a <strong>licença</strong>.
        O CRM volta como novo, com o funil básico. <strong>Não tem como desfazer.</strong>
      </p>

      {tenantId ? (
        // Plataforma: o Super Admin não baixa os dados de outra empresa (privacidade).
        // A cópia é do admin da empresa, em Configurações → Zona de risco.
        <label className="flex items-start gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={downloaded} onChange={e => setDownloaded(e.target.checked)} className="mt-0.5" />
          <span>1. A empresa pediu o reset por escrito e já baixou a própria cópia dos dados (o Super Admin não tem acesso a essa cópia). O reset fica no registro de acessos da empresa.</span>
        </label>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <a
            href={exportUrl}
            onClick={() => setDownloaded(true)}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            1. Baixar cópia dos dados (planilha)
          </a>
          {downloaded && <span className="text-xs text-green-700">✓ Cópia solicitada — confira o arquivo antes de continuar.</span>}
        </div>
      )}

      <div>
        <label htmlFor={`reset-${tenantId ?? 'me'}`} className="block text-xs font-semibold text-gray-700 mb-1">
          2. Para confirmar, digite o nome da empresa: <span className="font-mono">{tenantName}</span>
        </label>
        <input
          id={`reset-${tenantId ?? 'me'}`}
          value={typed}
          onChange={e => { setTyped(e.target.value); setMsg(null) }}
          disabled={!downloaded}
          className="w-full max-w-md rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none disabled:bg-gray-100"
        />
      </div>

      <button
        disabled={!canReset}
        onClick={() => start(async () => {
          const r = await resetCrm(typed, tenantId)
          setMsg(r.error ?? `✓ CRM resetado. ${r.summary ?? ''}`)
          if (!r.error) { setTyped(''); setDownloaded(false) }
        })}
        className="rounded-lg bg-red-600 px-5 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40"
      >
        {pending ? 'Resetando…' : '3. Resetar CRM'}
      </button>
      {msg && <p role="status" className="text-sm text-gray-800">{msg}</p>}
    </div>
  )

  if (compact) {
    return (
      <div className="bg-red-50 border-b border-red-100 px-6 py-4">
        {!open
          ? <button onClick={() => setOpen(true)} className="text-xs font-medium text-red-700 underline">Resetar CRM desta empresa…</button>
          : body}
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-red-200 bg-white p-6">
      <h2 className="text-sm font-semibold text-red-700">Zona de risco — Resetar CRM</h2>
      <div className="mt-3">
        {!open
          ? <button onClick={() => setOpen(true)} className="rounded-lg border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50">Quero resetar o CRM…</button>
          : body}
      </div>
    </div>
  )
}
