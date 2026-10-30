'use client'

// Código para colar no site (estatísticas de página), com botão Copiar
import { useState } from 'react'

export function InstallSnippet({ code, compact }: { code: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { setCopied(false) }
  }
  return (
    <section className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-900">{compact ? 'Código do site' : 'Instale no seu site (uma vez)'}</h2>
      {!compact && <ol className="list-decimal space-y-1 pl-5 text-sm text-gray-700">
        <li>Copie o código abaixo.</li>
        <li>Cole no site antes de &lt;/head&gt; ou no fim da página. WordPress: em um plugin de &quot;cabeçalho e rodapé&quot; ou no campo de códigos do tema/Elementor.</li>
        <li>Abra o site: a visita aparece aqui em alguns segundos. Vale para todas as páginas e LPs onde o código estiver.</li>
      </ol>}
      <div className="flex flex-wrap items-start gap-2">
        <code className="min-w-0 flex-1 break-all rounded bg-gray-50 px-2 py-1.5 text-xs text-gray-800">{code}</code>
        <button type="button" onClick={copy} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700">{copied ? 'Copiado' : 'Copiar'}</button>
      </div>
      <p className="text-[11px] text-gray-500">Sem cookies e sem guardar dado pessoal: o site não precisa mudar o aviso de cookies por causa dele. Para os leads do formulário contarem na página, use o formulário ou o envio da aba Links e formulário (eles mandam o endereço da página).</p>
    </section>
  )
}
