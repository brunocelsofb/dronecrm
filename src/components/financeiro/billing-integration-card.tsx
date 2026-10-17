'use client'

// Integração do faturamento (ERP): mês de início do fluxo, ida (manual ou
// webhook) e volta (endereço de retorno). Fica em Configurações → Integrações.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { saveBillingFlowStart, generateBillingReturnKey, saveBillingDelivery, generateBillingOutSecret, testBillingWebhook } from '@/lib/actions/billing-flow'
import type { ErpProvider } from '@/lib/erp/connectors'

export type ErpStatus = { provider: ErpProvider; flowStart: string | null; hasReturnKey: boolean; outUrl: string | null; hasOutSecret: boolean }

export function BillingIntegrationCard({ erp }: { erp: ErpStatus }) {
  const router = useRouter()
  const [flowStart, setFlowStart] = useState(erp.flowStart ?? '')
  const [msg, setMsg] = useState<string | null>(null)
  const [key, setKey] = useState<{ url: string; key: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [provider, setProvider] = useState<ErpProvider>(erp.provider)
  const [outUrl, setOutUrl] = useState(erp.outUrl ?? '')
  const [outSecret, setOutSecret] = useState<string | null>(null)

  async function saveDelivery() {
    setBusy(true); setMsg(null)
    const r = await saveBillingDelivery({ provider, outUrl })
    setBusy(false); setMsg(r.ok ? 'Envio para faturamento salvo.' : r.error)
    if (r.ok) router.refresh()
  }
  async function genOutSecret() {
    if (erp.hasOutSecret && !window.confirm('Gerar uma nova chave de assinatura invalida a anterior (atualize no sistema que recebe). Continuar?')) return
    setBusy(true); setMsg(null)
    const r = await generateBillingOutSecret()
    setBusy(false)
    if (r.ok) setOutSecret(r.secret)
    else setMsg(r.error)
  }
  async function sendTest() {
    setBusy(true); setMsg(null)
    const r = await testBillingWebhook()
    setBusy(false); setMsg(r.ok ? '✓ Aviso de teste entregue (evento faturamento.teste).' : r.error)
  }

  async function saveStart() {
    setBusy(true); setMsg(null)
    const r = await saveBillingFlowStart(flowStart)
    setBusy(false); setMsg(r.ok ? 'Início do fluxo salvo.' : r.error)
    if (r.ok) router.refresh()
  }
  async function genKey() {
    if (erp.hasReturnKey && !window.confirm('Gerar uma nova chave invalida a anterior. Continuar?')) return
    setBusy(true); setMsg(null)
    const r = await generateBillingReturnKey()
    setBusy(false)
    if (r.ok) setKey({ url: r.url, key: r.key })
    else setMsg(r.error)
  }

  return (
    <details open className="rounded-2xl border border-gray-200 bg-white p-4 text-sm">
      <summary className="cursor-pointer font-semibold text-gray-900">Faturamento (ERP) — Sankhya, TOTVS ou outro</summary>
      <p className="mt-2 text-xs text-gray-600">São dois sentidos: a <strong>ida</strong> (o CRM pede para faturar) e a <strong>volta</strong> (o sistema de faturamento avisa que faturou).</p>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <div className="space-y-2 rounded-lg border border-brand-100 p-3">
          <p className="text-sm font-semibold text-brand-800">➡ Ida: CRM → faturamento</p>
          <p className="text-xs text-gray-600">O comercial clica em <strong>Enviar</strong> na tela Financeiro. Escolha o que acontece depois:</p>
          <div className="space-y-1.5 text-xs text-gray-700">
            <label className="flex items-start gap-2">
              <input type="radio" className="mt-0.5" checked={provider === 'manual'} onChange={() => setProvider('manual')} />
              <span><strong>Manual</strong> — o envio só fica registrado aqui. O financeiro vê a lista, fatura no sistema de faturamento como hoje e lança a nota no CRM.</span>
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" className="mt-0.5" checked={provider === 'webhook'} onChange={() => setProvider('webhook')} />
              <span><strong>Webhook</strong> — o CRM avisa sozinho o sistema de faturamento (Sankhya, TOTVS ou outro), com o CNPJ do cliente. Ao contrário da ZapSign, <strong>quem cria o endereço é o lado do faturamento</strong> (consultoria Sankhya ou ferramenta como n8n/Make): você só cola aqui.</span>
            </label>
          </div>
          {provider === 'webhook' && (
            <div className="space-y-1">
              <label className="text-[11px] text-gray-500" htmlFor="out-url">Endereço que recebe os envios (passado pela consultoria do faturamento)</label>
              <input id="out-url" value={outUrl} onChange={e => setOutUrl(e.target.value)} placeholder="https://…" className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm" />
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button onClick={saveDelivery} disabled={busy} className="rounded-md bg-brand-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-800 disabled:opacity-50">Salvar</button>
            {provider === 'webhook' && erp.provider === 'webhook' && (
              <>
                <button onClick={genOutSecret} disabled={busy} className="rounded-md border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50">{erp.hasOutSecret ? 'Gerar nova chave de assinatura' : 'Gerar chave de assinatura'}</button>
                <button onClick={sendTest} disabled={busy} className="rounded-md border border-brand-700 px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100 disabled:opacity-50">Enviar teste</button>
              </>
            )}
          </div>
          {outSecret && <p className="rounded bg-gray-50 p-2 text-xs">Chave de assinatura (guarde agora e passe para o técnico; não aparece de novo): <code className="break-all">{outSecret}</code></p>}
          <details className="text-[11px] text-gray-500">
            <summary className="cursor-pointer font-medium text-gray-600">Detalhes para o técnico</summary>
            <p className="mt-1">A cada envio o CRM faz um POST JSON com: <code>envio_id</code>, <code>cliente.cnpj</code>, <code>cliente.razao_social</code>, <code>cliente.nome_fantasia</code>, <code>cnpj_emitente</code>, <code>tipo</code> (recorrente | medicao | avulso), <code>competencia</code> (AAAA-MM), <code>valor</code>, <code>descricao</code>, <code>contrato.numero</code> e <code>retorno.url</code>.</p>
            <p className="mt-1">Cabeçalhos: <code>X-CRM-Evento: faturamento.envio</code> e <code>X-CRM-Assinatura: sha256=&lt;HMAC SHA-256 do corpo com a chave de assinatura&gt;</code>. Responder 2xx; se devolver JSON com <code>referencia</code>, o CRM guarda. O “Enviar teste” manda <code>faturamento.teste</code>.</p>
          </details>
        </div>

        <div className="space-y-2 rounded-lg border border-positive-100 p-3">
          <p className="text-sm font-semibold text-positive-700">⬅ Volta: faturamento → CRM</p>
          <p className="text-xs text-gray-600">
            Funciona <strong>igual à ZapSign</strong>: o CRM gera o endereço e a chave, e você entrega para quem cuida do sistema de faturamento.
            Quando a nota for emitida, o sistema avisa e o CRM marca como <strong>faturado</strong> sozinho. Sem isso, o Admin lança nº da nota, data e valor aqui.
          </p>
          <button onClick={genKey} disabled={busy} className="rounded-md border border-positive-700 px-2.5 py-1 text-xs font-medium text-positive-700 hover:bg-positive-100 disabled:opacity-50">
            {erp.hasReturnKey ? 'Gerar novo endereço e chave' : 'Gerar endereço e chave de retorno'}
          </button>
          <details className="text-[11px] text-gray-500">
            <summary className="cursor-pointer font-medium text-gray-600">Detalhes para o técnico</summary>
            <p className="mt-1">POST no endereço de retorno com <code>Authorization: Bearer &lt;chave&gt;</code> e JSON: <code>envio_id</code> (ou <code>referencia_erp</code>, ou <code>cnpj</code> + <code>competencia</code> [+ <code>tipo</code>]), <code>numero_nota</code>, <code>data_faturamento</code> (AAAA-MM-DD), <code>valor_faturado</code>.</p>
          </details>
        </div>

        <div className="md:col-span-2">
          <label className="text-xs font-medium text-gray-600" htmlFor="flow-start">Início do fluxo (mês)</label>
          <div className="mt-1 flex gap-2">
            <input id="flow-start" type="month" value={flowStart} onChange={e => setFlowStart(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1 text-sm" />
            <button onClick={saveStart} disabled={busy || !flowStart} className="rounded-md border border-brand-700 px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100 disabled:opacity-50">Salvar</button>
          </div>
          <p className="mt-1 text-[11px] text-gray-500">Antes desse mês vale a regra antiga (recorrente automático, apurado = faturado).</p>
        </div>
      </div>
      {key && (
        <div className="mt-3 space-y-1 rounded-lg bg-gray-50 p-3 text-xs">
          <p className="font-medium text-gray-900">Guarde a chave agora — ela não aparece de novo.</p>
          <p>Endereço: <code className="break-all">{key.url}</code></p>
          <p>Cabeçalho: <code className="break-all">Authorization: Bearer {key.key}</code></p>
          <p>Corpo (JSON): <code className="break-all">{'{"envio_id":"…","numero_nota":"12345","data_faturamento":"AAAA-MM-DD","valor_faturado":1234.56}'}</code></p>
          <p>Ou, sem o envio_id: <code className="break-all">{'{"cnpj":"00000000000000","competencia":"AAAA-MM","tipo":"recorrente","numero_nota":"12345","data_faturamento":"AAAA-MM-DD","valor_faturado":1234.56}'}</code></p>
        </div>
      )}
      {msg && <p className="mt-2 text-xs text-gray-700">{msg}</p>}
    </details>
  )
}
