'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, Upload } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { sanitizeStorageFileName } from '@/lib/utils/storage'
import { registerCompanyFile, companyFileUrl, contractFileUrl, deleteCompanyFile } from '@/lib/actions/company-files'

type F = { id: string; file_name: string; file_size: number | null; created_at: string; description?: string | null; uploader?: string | null }
type CF = F & { contract_label: string }

const size = (n: number | null) => (n ? (n > 1_048_576 ? `${(n / 1_048_576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1024))} KB`) : '')
const date = (iso: string) => new Date(iso).toLocaleDateString('pt-BR')

export function CompanyFilesSection({ companyId, files, contractFiles, isAdmin }: { companyId: string; files: F[]; contractFiles: CF[]; isAdmin: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [desc, setDesc] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<F | null>(null)

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > 50 * 1024 * 1024) { setError('Arquivo acima de 50 MB.'); return }
    setBusy(true); setError(null)
    const path = `companies/${companyId}/${Date.now()}-${sanitizeStorageFileName(file.name)}`
    const { error: upErr } = await createClient().storage.from('contract-files').upload(path, file)
    if (upErr) { setBusy(false); setError(`Falha no upload: ${upErr.message}`); return }
    const r = await registerCompanyFile(companyId, { name: file.name, path, size: file.size, type: file.type, description: desc })
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    setDesc(''); router.refresh()
  }
  async function open(fn: () => Promise<{ ok: true; url: string } | { ok: false; error: string }>) {
    const r = await fn()
    if (r.ok) window.open(r.url, '_blank'); else setError(r.error)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-gray-300 p-3">
        <label className="block min-w-[220px] flex-1"><span className="text-[10px] font-medium uppercase text-gray-500">Descrição (opcional)</span>
          <input value={desc} onChange={e => setDesc(e.target.value)} maxLength={300} placeholder="Ex.: Cartão CNPJ, alvará, apresentação institucional"
            className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none" /></label>
        <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800 ${busy ? 'pointer-events-none opacity-50' : ''}`}>
          <Upload className="h-4 w-4" /> {busy ? 'Enviando…' : 'Anexar arquivo'}
          <input type="file" className="hidden" onChange={upload} />
        </label>
      </div>
      {error && <p className="text-xs text-negative-700">{error}</p>}

      <div>
        <p className="mb-1 text-xs font-semibold text-gray-700">Arquivos da empresa ({files.length})</p>
        {files.length === 0 ? <p className="text-sm text-gray-400">Nenhum arquivo anexado direto na empresa.</p> : (
          <ul className="divide-y divide-gray-50">
            {files.map(f => (
              <li key={f.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <button type="button" onClick={() => open(() => companyFileUrl(f.id))} className="truncate text-left text-sm font-medium text-brand-700 hover:underline">📄 {f.file_name}</button>
                  <p className="text-[11px] text-gray-500">{[f.description, size(f.file_size), date(f.created_at), f.uploader].filter(Boolean).join(' · ')}</p>
                </div>
                {isAdmin && <button type="button" onClick={() => setConfirm(f)} title="Excluir (admin)" className="text-gray-300 hover:text-negative-700"><Trash2 className="h-4 w-4" /></button>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {contractFiles.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold text-gray-700">Nas oportunidades desta empresa ({contractFiles.length})</p>
          <ul className="divide-y divide-gray-50">
            {contractFiles.map(f => (
              <li key={f.id} className="py-2">
                <button type="button" onClick={() => open(() => contractFileUrl(f.id))} className="text-left text-sm text-gray-800 hover:underline">📄 {f.file_name}</button>
                <p className="text-[11px] text-gray-500">{[f.contract_label, size(f.file_size), date(f.created_at)].filter(Boolean).join(' · ')}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {confirm && (
        <div role="dialog" aria-modal="true" onClick={() => setConfirm(null)} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div onClick={e => e.stopPropagation()} className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <p className="text-base font-semibold text-gray-900">Tem certeza que quer excluir este arquivo?</p>
            <p className="mt-2 text-sm text-gray-600">{confirm.file_name} será apagado para sempre.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirm(null)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm">Cancelar</button>
              <button type="button" onClick={async () => { const f = confirm; setConfirm(null); const r = await deleteCompanyFile(f.id); if (!r.ok) setError(r.error); else router.refresh() }}
                className="rounded-lg bg-negative-600 px-3 py-1.5 text-sm font-semibold text-white">Sim, excluir</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
