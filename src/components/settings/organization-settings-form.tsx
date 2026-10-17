'use client'

import { useState, useRef, useActionState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { updateOrganizationSettings, updateOrganizationLogo, type ActionState } from '@/lib/actions/settings'
import { sanitizeStorageFileName } from '@/lib/utils/storage'

const initialState: ActionState = {}

export function OrganizationSettingsForm({
  currentName,
  currentCompanyName,
  currentCompanyCnpj,
  currentLogoPath,
  currentHeaderText,
  currentFooterText,
  currentBrandColor,
  currentAssistantBudget,
  currentSupportBgUrl,
  currentBgColor = '#1B556B',
  currentLoginBgUrl,
  currentLeadBgUrl,
  currentNpsBgUrl,
  currentSurveyClinicaBgUrl,
  currentSurveyHospitalarBgUrl,
  show = 'tudo',
}: {
  currentName: string
  currentCompanyName: string
  currentCompanyCnpj: string
  currentLogoPath: string | null
  currentHeaderText: string
  currentFooterText: string
  currentBrandColor: string
  currentAssistantBudget: number
  currentSupportBgUrl?: string | null
  currentBgColor?: string
  currentLoginBgUrl?: string | null
  currentLeadBgUrl?: string | null
  currentNpsBgUrl?: string | null
  currentSurveyClinicaBgUrl?: string | null
  currentSurveyHospitalarBgUrl?: string | null
  show?: 'tudo' | 'empresa' | 'orcamento'   // cada quadro de Configurações mostra só a sua parte
}) {
  const [state, formAction, pending] = useActionState(updateOrganizationSettings, initialState)
  const [logoPath, setLogoPath] = useState(currentLogoPath)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [logoError, setLogoError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const bgInputRef = useRef<HTMLInputElement>(null)
  const [uploadingBg, setUploadingBg] = useState(false)
  const [bgError, setBgError] = useState<string | null>(null)
  const [bgPath, setBgPath] = useState(currentSupportBgUrl ?? null)
  const [bgColor, setBgColorState] = useState(currentBgColor ?? '#1B556B')
  const [savingColor, setSavingColor] = useState(false)
  const loginBgRef = useRef<HTMLInputElement>(null)
  const [loginBg, setLoginBg] = useState(currentLoginBgUrl ?? null)
  const [uploadingLoginBg, setUploadingLoginBg] = useState(false)
  const [loginBgError, setLoginBgError] = useState<string | null>(null)
  const leadBgRef = useRef<HTMLInputElement>(null)
  const [leadBg, setLeadBg] = useState(currentLeadBgUrl ?? null)
  const [uploadingLeadBg, setUploadingLeadBg] = useState(false)
  const [leadBgError, setLeadBgError] = useState<string | null>(null)

  // Helper genérico de upload para wallpapers públicos
  async function uploadPublicAsset(
    file: File, folder: string, column: string,
    setUploading: (v: boolean) => void,
    setError: (v: string | null) => void,
    setPath: (v: string) => void
  ) {
    setUploading(true); setError(null)
    const sb = createClient()
    const storagePath = `${folder}/${Date.now()}-${sanitizeStorageFileName(file.name)}`
    const { error: uploadError } = await sb.storage.from('public-assets').upload(storagePath, file)
    if (uploadError) { setError(uploadError.message); setUploading(false); return }
    const { data: { publicUrl } } = sb.storage.from('public-assets').getPublicUrl(storagePath)
    const res = await fetch('/api/settings/public-asset', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: publicUrl, column }),
    })
    setUploading(false)
    if (res.ok) setPath(publicUrl); else setError('Erro ao salvar')
  }

  const npsRef = useRef<HTMLInputElement>(null)
  const [npsBg, setNpsBg] = useState(currentNpsBgUrl ?? null)
  const [uploadingNps, setUploadingNps] = useState(false)
  const [npsErr, setNpsErr] = useState<string | null>(null)

  const clinicaRef = useRef<HTMLInputElement>(null)
  const [clinicaBg, setClinicaBg] = useState(currentSurveyClinicaBgUrl ?? null)
  const [uploadingClinica, setUploadingClinica] = useState(false)
  const [clinicaErr, setClinicaErr] = useState<string | null>(null)

  const hospitalarRef = useRef<HTMLInputElement>(null)
  const [hospitalarBg, setHospitalarBg] = useState(currentSurveyHospitalarBgUrl ?? null)
  const [uploadingHospitalar, setUploadingHospitalar] = useState(false)
  const [hospitalarErr, setHospitalarErr] = useState<string | null>(null)

  async function handleLogoUpload() {
    const file = fileInputRef.current?.files?.[0]
    if (!file) return
    setUploadingLogo(true)
    setLogoError(null)

    const formData = new FormData()
    formData.append('file', file)

    const res = await fetch('/api/settings/logo-url', { method: 'POST', body: formData })
    setUploadingLogo(false)
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Erro desconhecido' }))
      setLogoError(err.error || 'Erro ao fazer upload')
    } else {
      const { url } = await res.json()
      setLogoPath(url)
    }
  }

  async function handleBgUpload() {
    const file = bgInputRef.current?.files?.[0]
    if (!file) return
    setUploadingBg(true)
    setBgError(null)

    const supabase = createClient()
    const storagePath = `support-bg/${Date.now()}-${sanitizeStorageFileName(file.name)}`
    const { error: uploadError } = await supabase.storage.from('public-assets').upload(storagePath, file)

    if (uploadError) {
      setBgError(`Falha no upload: ${uploadError.message}`)
      setUploadingBg(false)
      return
    }

    const { data: { publicUrl } } = supabase.storage.from('public-assets').getPublicUrl(storagePath)

    // Salva a URL pública direto (não o path, pois é imagem pública)
    const res = await fetch('/api/settings/support-bg', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: publicUrl }),
    })
    setUploadingBg(false)
    if (!res.ok) setBgError('Erro ao salvar URL do wallpaper')
    else setBgPath(publicUrl)
  }

  async function removeWallpaper(column: string, clearState: () => void) {
    if (!confirm('Remover o wallpaper? As telas voltarão ao gradiente padrão.')) return
    const res = await fetch('/api/settings/public-asset', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ column }),
    })
    if (res.ok) clearState()
  }

  return (
    <div className="max-w-md space-y-6">
      {show !== 'orcamento' && <>
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <label className="block text-sm font-medium text-gray-700">Logo da empresa (White Label)</label>
        <p className="mt-0.5 text-xs text-gray-400">Aparece no login, formulários públicos e propostas. Sem logo configurada, usa a logo DRONE como padrão.</p>
        {logoPath && (
          <img
            src={logoPath.startsWith('http') ? logoPath : `/api/settings/logo?path=${encodeURIComponent(logoPath)}`}
            alt="Logo atual"
            className="mt-2 h-16 object-contain"
            onError={(e) => { e.currentTarget.style.display = 'none' }}
          />
        )}
        <div className="mt-2 flex items-center gap-2">
          <input ref={fileInputRef} type="file" accept="image/png,image/jpeg" className="text-xs" />
          <button
            onClick={handleLogoUpload}
            disabled={uploadingLogo}
            className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {uploadingLogo ? 'Enviando...' : 'Enviar logo'}
          </button>
        </div>
        {logoError && <p className="mt-1 text-xs text-red-600">{logoError}</p>}
      </div>

      <form action={formAction} className="space-y-4 rounded-lg border border-gray-200 bg-white p-6">
        {/* Nome do sistema oculto — logo substitui o texto no sidebar */}
        <input type="hidden" name="name" value={currentName} />

        <div>
          <label className="block text-sm font-medium text-gray-700">Nome da empresa (contratada)</label>
          <input
            name="company_name"
            defaultValue={currentCompanyName}
            placeholder="Ex: Sua Empresa Ltda."
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-700 focus:outline-none"
          />
          <p className="mt-1 text-xs text-gray-400">
            Usado na pergunta da pesquisa NPS e no PDF das propostas — é o nome da sua empresa, não do sistema.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">CNPJ da empresa</label>
          <input
            name="company_cnpj"
            defaultValue={currentCompanyCnpj}
            placeholder="00.000.000/0000-00"
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-700 focus:outline-none"
          />
          <p className="mt-1 text-xs text-gray-400">Disponível como variável <code>{'{{minha_cnpj}}'}</code> nos templates de e-mail.</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">Cor da marca</label>
          <div className="mt-1 flex items-center gap-2">
            <input
              name="proposal_brand_color"
              type="color"
              defaultValue={currentBrandColor}
              className="h-9 w-14 rounded border border-gray-300"
            />
            <span className="text-xs text-gray-400">Usada como faixa colorida no cabeçalho e rodapé do PDF das propostas.</span>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">Cabeçalho da proposta (opcional)</label>
          <input
            name="proposal_header_text"
            defaultValue={currentHeaderText}
            placeholder="Ex: www.suaempresa.com.br"
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-700 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">Rodapé da proposta (opcional)</label>
          <input
            name="proposal_footer_text"
            defaultValue={currentFooterText}
            placeholder="Ex: Sua Empresa Ltda. · (00) 0000-0000"
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-700 focus:outline-none"
          />
          <p className="mt-1 text-xs text-gray-400">Cabeçalho e rodapé aparecem em todas as páginas de dados da proposta (não nas capas anexadas).</p>
        </div>

        {state.error && <p className="text-sm text-red-600">{state.error}</p>}

        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
        >
          {pending ? 'Salvando...' : 'Salvar'}
        </button>
      </form>
      </>}

      {show !== 'empresa' && <form action={formAction} className="space-y-4 rounded-lg border border-gray-200 bg-white p-6">
        <div>
          <label className="block text-sm font-medium text-gray-700">🤖 Orçamento mensal do Théo (US$)</label>
          <input
            name="assistant_monthly_budget_usd"
            type="number"
            min="0"
            step="1"
            defaultValue={currentAssistantBudget}
            className="mt-1 w-32 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-700 focus:outline-none"
          />
          <p className="mt-1 text-xs text-gray-400">
            Quando o gasto estimado do mês passar disso, o assistente para de responder até o mês seguinte (ou até você aumentar o valor aqui).
          </p>
        </div>

        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
        >
          {pending ? 'Salvando...' : 'Salvar orçamento'}
        </button>
        {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      </form>}
    </div>
  )
}
