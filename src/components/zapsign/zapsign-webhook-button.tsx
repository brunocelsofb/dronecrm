'use client'

// Configurações: cadastra na conta ZapSign da empresa o aviso automático
// (webhook) para o CRM saber na hora quando um documento é assinado.

import { useState } from 'react'
import { registerZapSignWebhook, testZapSign, generateZapSignHookUrl } from '@/lib/actions/zapsign'

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

// Sem Plano de API: o aviso é cadastrado na tela da ZapSign com este endereço
export function ZapSignHookCard({ currentUrl }: { currentUrl: string | null }) {
  const [url, setUrl] = useState(currentUrl)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  async function gen() {
    if (url && !window.confirm('Gerar um novo endereço invalida o anterior (atualize também na ZapSign). Continuar?')) return
    setBusy(true); setMsg(null)
    try {
      const r = await generateZapSignHookUrl()
      if (r.ok) setUrl(r.url)
      else setMsg(r.error)
    } catch {
      setMsg('Falha de conexão. Tente de novo.')
    } finally {
      setBusy(false)
    }
  }
  async function copy() {
    if (!url) return
    try { await navigator.clipboard.writeText(url); setMsg('Endereço copiado.') } catch { window.prompt('Copie o endereço:', url) }
  }
  return (
    <div className="space-y-2 rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-sm font-medium text-gray-900">Avisos de assinatura sem Plano de API (gratuito)</p>
      <ol className="list-decimal space-y-0.5 pl-4 text-xs text-gray-600">
        <li>Gere o endereço abaixo e copie.</li>
        <li>Na ZapSign: Configurações → Integrações → API ZapSign → Webhooks → <strong>Criar webhook</strong>. Tipo de evento: <strong>Todos (documentos)</strong>. Cole o endereço em “URL do webhook” e registre.</li>
        <li>No contrato, aba Contrato e aditivos, registre o link de cada documento enviado pela ZapSign. Quando todos assinarem, o PDF assinado volta sozinho.</li>
      </ol>
      {url && <p className="break-all rounded bg-gray-50 p-2 font-mono text-[11px] text-gray-700">{url}</p>}
      <div className="flex gap-2">
        <button onClick={gen} disabled={busy} className="rounded-md border border-brand-700 px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-100 disabled:opacity-50">{busy ? 'Gerando…' : url ? 'Gerar novo endereço' : 'Gerar endereço'}</button>
        {url && <button onClick={copy} className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-800">Copiar</button>}
      </div>
      <p className="text-[11px] text-gray-400">O endereço tem uma chave secreta da empresa: não compartilhe fora da ZapSign.</p>
      {msg && <p className="text-xs text-gray-700">{msg}</p>}
    </div>
  )
}
