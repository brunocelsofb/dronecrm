'use client'

// Link da bio do Instagram: um link fixo da vitrine; o pedido de quem entra por ele conta aqui.
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ensureBioCampaign } from '@/lib/actions/retail-campaigns'
import { fmtBRL } from '@/lib/format'

export function BioLink({ bio, readOnly }: { bio: { id: string; link: string | null; sold: number; paid: number } | null; readOnly: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  async function create() {
    setBusy(true); setErr(null)
    const r = await ensureBioCampaign()
    setBusy(false)
    if (!r.ok) setErr(r.error); else router.refresh()
  }
  async function copy() {
    if (!bio?.link) return
    try { await navigator.clipboard.writeText(bio.link); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { setErr('Não consegui copiar. Selecione o link e copie.') }
  }
  return (
    <section className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900">Link da bio do Instagram</h2>
        {bio && <Link href={`/varejo/campanhas/${bio.id}`} className="text-xs text-brand-700 hover:underline">{fmtBRL(bio.sold)} vendido · {bio.paid} pedido(s) pago(s) →</Link>}
      </div>
      {!bio ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 text-xs text-gray-600">Um link fixo da sua loja para a bio: mostra quanto vendeu quem entrou pelo Instagram.</p>
          {!readOnly && <button type="button" disabled={busy} onClick={create} className="rounded-lg bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">{busy ? 'Criando…' : 'Criar link da bio'}</button>}
        </div>
      ) : bio.link ? (
        <div className="flex flex-wrap items-center gap-2"><code className="min-w-0 flex-1 truncate rounded bg-gray-50 px-2 py-1.5 text-xs text-gray-800">{bio.link}</code>
          <button type="button" className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700" onClick={copy}>{copied ? 'Copiado' : 'Copiar'}</button></div>
      ) : <p className="text-sm text-warn-700">Configure a vitrine (Configurar loja → Vitrine) para ter o link.</p>}
      {err && <p role="alert" className="text-sm text-negative-700">{err}</p>}
    </section>
  )
}
