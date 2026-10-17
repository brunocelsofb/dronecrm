'use client'

// Importar lista de prospecção (planilha) → leads outbound do comercial.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { parseLeadFile, importLeadsChunk, type ImportRow } from '@/lib/actions/lead-import'

export function LeadImport() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [rows, setRows] = useState<ImportRow[] | null>(null)
  const [info, setInfo] = useState<{ ignored: number; columns: string[] } | null>(null)
  const [progress, setProgress] = useState<{ done: number; created: number; duplicates: number } | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function read(fd: FormData) {
    setBusy(true); setMsg(null); setRows(null); setProgress(null)
    try {
      const r = await parseLeadFile(fd)
      if (r.ok) { setRows(r.rows); setInfo({ ignored: r.ignored, columns: r.columns }) } else setMsg({ ok: false, text: r.error })
    } catch { setMsg({ ok: false, text: 'Falha ao enviar a planilha.' }) }
    setBusy(false)
  }

  async function run() {
    if (!rows?.length) return
    setBusy(true); setMsg(null)
    let created = 0, duplicates = 0
    const errors: string[] = []
    for (let i = 0; i < rows.length; i += 20) {
      const r = await importLeadsChunk(rows.slice(i, i + 20))
      if (!r.ok) { errors.push(r.error); break }
      created += r.created; duplicates += r.duplicates; errors.push(...r.errors)
      setProgress({ done: Math.min(i + 20, rows.length), created, duplicates })
    }
    setMsg({ ok: errors.length === 0, text: `${created} lead(s) criado(s)${duplicates ? `, ${duplicates} já existiam (nova anotação no lead)` : ''}.${errors.length ? ` Problemas: ${errors.slice(0, 3).join(' · ')}` : ''}` })
    setRows(null); setBusy(false)
    router.refresh()
  }

  if (!open) {
    return <button onClick={() => setOpen(true)} className="px-4 py-2 text-xs font-medium rounded-xl border border-gray-200 bg-white text-gray-600">⬆️ Importar planilha</button>
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal="true" aria-label="Importar planilha de prospecção">
      <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between">
          <p className="text-base font-semibold text-gray-900">Importar lista de prospecção</p>
          <button onClick={() => { if (!busy) { setOpen(false); setRows(null); setMsg(null); setProgress(null) } }} className="text-sm text-gray-500" aria-label="Fechar">✕</button>
        </div>
        <p className="mt-1 text-xs text-gray-600">
          Excel ou CSV, com os títulos das colunas na primeira linha: <strong>Nome, E-mail, Telefone, Empresa, CNPJ, Observação</strong> (em português ou inglês; colunas a mais são ignoradas).
          Os leads entram como <strong>outbound</strong>, com você como responsável, para começar a qualificação. Mesmo e-mail com lead aberto não duplica.
        </p>
        {!rows && (
          <form action={read} className="mt-3 flex items-center gap-2">
            <input name="file" type="file" accept=".xlsx,.xls,.csv" required className="min-w-0 flex-1 text-sm" />
            <button disabled={busy} className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Lendo…' : 'Ler planilha'}</button>
          </form>
        )}
        {rows && (
          <div className="mt-3 text-sm">
            <p className="font-medium text-gray-900">{rows.length} lead(s) encontrados{info?.ignored ? ` · ${info.ignored} linha(s) sem nome, e-mail ou telefone ignoradas` : ''}</p>
            <ul className="mt-2 max-h-40 divide-y divide-gray-50 overflow-auto rounded-lg border border-gray-100 text-xs">
              {rows.slice(0, 8).map((r, i) => <li key={i} className="px-2 py-1">{r.name ?? '—'} · {r.company_name ?? 'sem empresa'} · {r.email ?? r.phone ?? '—'}</li>)}
            </ul>
            {rows.length > 8 && <p className="mt-1 text-[11px] text-gray-400">Mostrando 8 de {rows.length}.</p>}
            {progress && <p className="mt-2 text-xs text-gray-600">Importando {progress.done} de {rows.length}… não feche.</p>}
            <div className="mt-3 flex gap-3">
              <button disabled={busy} onClick={run} className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Importando…' : `Importar ${rows.length} lead(s)`}</button>
              <button disabled={busy} onClick={() => setRows(null)} className="text-sm text-gray-500">Trocar planilha</button>
            </div>
          </div>
        )}
        {msg && <p role="status" className={`mt-3 text-sm ${msg.ok ? 'text-positive-700' : 'text-red-600'}`}>{msg.text}</p>}
      </div>
    </div>
  )
}
