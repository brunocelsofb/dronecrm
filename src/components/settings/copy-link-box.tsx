'use client'

import { useState } from 'react'
import { Copy, Check } from 'lucide-react'

export function CopyLinkBox({ title, text, url }: { title: string; text: string; url: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* sem permissão de área de transferência: o link fica visível para copiar à mão */ }
  }
  return (
    <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-sm font-semibold text-gray-900">{title}</p>
      <p className="mt-0.5 text-xs text-gray-500">{text}</p>
      <div className="mt-3 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-700">{url}</code>
        <button type="button" onClick={copy} className="flex shrink-0 items-center gap-1.5 rounded-md bg-brand-700 px-3 py-2 text-xs font-medium text-white hover:bg-brand-800">
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? 'Copiado' : 'Copiar'}
        </button>
      </div>
    </div>
  )
}
