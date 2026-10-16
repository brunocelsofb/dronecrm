'use client'

// Configurações: cadastra na conta ZapSign da empresa o aviso automático
// (webhook) para o CRM saber na hora quando um documento é assinado.

import { useState } from 'react'
import { registerZapSignWebhook, testZapSign } from '@/lib/actions/zapsign'

export function ZapSignWebhookButton({ hasToken, currentUrl }: { hasToken: boolean; currentUrl: string | null }) {
  const [url, setUrl] = useState(currentUrl)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setBusy(true); setError(null)
    try {
      const r = await registerZapSignWebhook()
      if (r.error) setError(r.error)
      else setUrl(r.url ?? null)
    } catch {
      setError('Falha de conexão. Tente de novo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-sm font-medium text-gray-900">Avisos automáticos de assinatura</p>
      <p className="text-xs text-gray-500">
        Com os avisos ativos, a ZapSign avisa o CRM quando um documento é assinado ou recusado, e o PDF assinado entra sozinho na aba
        “Contrato e aditivos”. Sem os avisos, use “Atualizar status” no documento.
      </p>
      {url && <p className="text-xs text-positive-700">✅ Ativo · {url}</p>}
      {error && <p role="alert" className="text-xs text-negative-700">{error}</p>}
      <button onClick={run} disabled={busy || !hasToken} className="rounded-md border border-brand-700 px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-100 disabled:opacity-50">
        {busy ? 'Ativando…' : url ? 'Ativar de novo' : 'Ativar avisos'}
      </button>
      {!hasToken && <p className="text-[11px] text-gray-500">Salve o token da ZapSign acima primeiro.</p>}
    </div>
  )
}

export function ZapSignTestButton({ hasToken }: { hasToken: boolean }) {
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null)
  async function run() {
    setBusy(true); setRes(null)
    try {
      const r = await testZapSign()
      setRes(r.ok ? { ok: true, text: `Conexão OK com a ZapSign (${r.env}).` } : { ok: false, text: r.error })
    } catch {
      setRes({ ok: false, text: 'Falha de conexão. Tente de novo.' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-4">
      <button onClick={run} disabled={busy || !hasToken} className="rounded-md border border-brand-700 px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-100 disabled:opacity-50">
        {busy ? 'Testando…' : 'Testar conexão com a ZapSign'}
      </button>
      {res && <p role="status" className={`w-full text-xs ${res.ok ? 'text-positive-700' : 'text-negative-700'}`}>{res.ok ? '✓ ' : '⚠ '}{res.text}</p>}
    </div>
  )
}
