'use client'

import { useRef, useState } from 'react'

type WallpaperField = {
  key: string
  label: string
  description: string
  bucketPath: string
  column: string
  initial: string | null
}

const FIELDS: WallpaperField[] = [
  { key: 'login',       label: 'Tela de Login',              description: 'Fundo da tela de login de todas as empresas (/login)',           bucketPath: 'login-bg',        column: 'login_bg_url',              initial: '' },
  { key: 'support',     label: 'Formulário de Suporte',      description: 'Fundo da página /suporte',                          bucketPath: 'support-bg',      column: 'support_bg_url',            initial: '' },
  { key: 'nps',         label: 'Pesquisa NPS',               description: 'Fundo da página /nps/[token]',                      bucketPath: 'nps-bg',          column: 'nps_bg_url',                initial: '' },
  { key: 'clinica',     label: 'Pesquisa — Eng. Clínica',    description: 'Fundo da pesquisa de Engenharia Clínica',           bucketPath: 'survey-clinica',  column: 'survey_clinica_bg_url',     initial: '' },
  { key: 'hospitalar',  label: 'Pesquisa — Eng. Hospitalar', description: 'Fundo da pesquisa de Engenharia Hospitalar/Predial', bucketPath: 'survey-hospitalar',column: 'survey_hospitalar_bg_url', initial: '' },
  { key: 'lead',        label: 'Formulário de Leads',        description: 'Fundo da página /captura',                          bucketPath: 'lead-bg',         column: 'lead_bg_url',               initial: '' },
]

function WallpaperCard({ field, initialUrl }: { field: WallpaperField; initialUrl: string | null }) {
  const [url, setUrl] = useState(initialUrl)
  const [uploading, setUploading] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleUpload() {
    const file = inputRef.current?.files?.[0]
    if (!file) return
    setUploading(true); setError(null)

    const formData = new FormData()
    formData.append('file', file)
    formData.append('bucketPath', field.bucketPath)
    formData.append('column', field.column)

    const res = await fetch('/api/settings/wallpaper-upload', { method: 'POST', body: formData })
    const data = await res.json()
    setUploading(false)
    if (!res.ok) { setError(data.error || 'Erro no upload'); return }
    setUrl(data.url)
    if (inputRef.current) inputRef.current.value = ''
  }

  async function handleRemove() {
    if (!confirm(`Remover o wallpaper de "${field.label}"? A tela voltará ao fundo padrão.`)) return
    setRemoving(true); setError(null)
    const res = await fetch('/api/settings/public-asset', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ column: field.column }),
    })
    setRemoving(false)
    if (res.ok) setUrl(null)
    else setError('Erro ao remover')
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[#1B556B]">{field.label}</p>
          <p className="text-xs text-gray-400 mt-0.5">{field.description}</p>
        </div>
        {url && (
          <span className="rounded-full bg-green-100 text-green-700 text-[10px] font-medium px-2 py-0.5 flex-shrink-0">Ativo</span>
        )}
      </div>

      {/* Preview */}
      {url && (
        <div className="w-full h-24 rounded-lg overflow-hidden border border-gray-100">
          <img src={url} alt="preview" className="w-full h-full object-cover" />
        </div>
      )}
      {!url && (
        <div className="w-full h-16 rounded-lg border-2 border-dashed border-gray-200 flex items-center justify-center">
          <p className="text-xs text-gray-400">Nenhum wallpaper configurado</p>
        </div>
      )}

      {/* Ações */}
      <div className="flex items-center gap-2 flex-wrap">
        <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" className="text-xs max-w-[160px]" />
        <button onClick={handleUpload} disabled={uploading}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          {uploading ? 'Enviando...' : '⬆ Enviar wallpaper'}
        </button>
        {url && (
          <button onClick={handleRemove} disabled={removing}
            className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50">
            {removing ? 'Removendo...' : '🗑 Remover'}
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}

export function WallpaperManager(props: {
  loginBgUrl: string | null
  showLogin: boolean
  supportBgUrl: string | null
  npsBgUrl: string | null
  clinicaBgUrl: string | null
  hospitalarBgUrl: string | null
  leadBgUrl: string | null
  bgColor: string
}) {
  const initialUrls: Record<string, string | null> = {
    login: props.loginBgUrl,
    support: props.supportBgUrl,
    nps: props.npsBgUrl,
    clinica: props.clinicaBgUrl,
    hospitalar: props.hospitalarBgUrl,
    lead: props.leadBgUrl,
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {FIELDS.filter(f => f.key !== 'login' || props.showLogin).map(field => (
          <WallpaperCard key={field.key} field={field} initialUrl={initialUrls[field.key] ?? null} />
        ))}
      </div>
    </div>
  )
}
