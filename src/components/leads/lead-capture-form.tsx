'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createLead } from '@/lib/actions/leads'
import type { Tracking } from '@/lib/marketing/tracking'

export function LeadCaptureForm({
  onSuccess,
  redirectAfter,
  defaultPhone,
  empresa,
  tracking,
  internal,
}: {
  onSuccess?: () => void
  redirectAfter?: (leadId: string) => string
  defaultPhone?: string
  empresa?: string   // slug da empresa (formulário público)
  tracking?: Tracking // origem do link (UTM, gclid, fbclid) — formulário público
  internal?: boolean  // cadastro pela equipe (prospecção do comercial)
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function handleSubmit(formData: FormData) {
    setBusy(true)
    setError(null)
    // Formulário público: página e de onde a pessoa veio
    if (tracking) {
      formData.set('landing_page', window.location.href.split('#')[0].slice(0, 500))
      if (document.referrer) formData.set('referrer', document.referrer.slice(0, 500))
    }
    const result = await createLead(formData)
    setBusy(false)

    if (result.error) {
      setError(result.error)
      return
    }

    if (redirectAfter && result.leadId) {
      router.push(redirectAfter(result.leadId))
      return
    }

    setDone(true)
    onSuccess?.()
  }

  if (done) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 text-center">
        <p className="text-lg font-medium text-gray-900">✅ Recebido!</p>
        <p className="mt-1 text-sm text-gray-500">Obrigado pelo contato — alguém do nosso time vai falar com você em breve.</p>
      </div>
    )
  }

  return (
    <form action={handleSubmit} className="space-y-3 rounded-xl border border-gray-200 bg-white p-6">
      {empresa && <input type="hidden" name="empresa" value={empresa} />}
      {internal && <input type="hidden" name="interno" value="1" />}
      {tracking && Object.entries(tracking).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {/* Campo-armadilha para robôs: fica fora da tela */}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
        <label>Site <input type="text" name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700">Nome</label>
        <input name="name" required className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-700 focus:outline-none" />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700">E-mail</label>
        <input name="email" type="email" className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-700 focus:outline-none" />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700">Telefone</label>
        <input name="phone" defaultValue={defaultPhone} className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-700 focus:outline-none" />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700">Empresa</label>
        <input name="company_name" required className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-700 focus:outline-none" />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700">CNPJ</label>
        <input name="cnpj" required placeholder="00.000.000/0000-00" className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-700 focus:outline-none" />
      </div>
      {internal ? (
        <div>
          <label className="block text-sm font-medium text-gray-700">Origem</label>
          <select name="source" defaultValue="prospeccao" className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-700 focus:outline-none">
            <option value="prospeccao">Prospecção ativa (lista, pesquisa, LinkedIn)</option>
            <option value="indicacao">Indicação</option>
            <option value="ligacao">Ligação</option>
            <option value="evento">Evento / congresso</option>
            <option value="outro">Outro</option>
          </select>
        </div>
      ) : (
      <div>
          <label className="block text-sm font-medium text-gray-700">Como você conheceu a gente?</label>
          <select name="source" defaultValue={tracking?.utm_source || tracking?.gclid || tracking?.fbclid ? 'anuncio' : 'formulario_site'} className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-700 focus:outline-none">
            <option value="indicacao">Indicação de alguém</option>
            <option value="evento">Evento / congresso</option>
            <option value="formulario_site">Site / busca na internet</option>
            <option value="ligacao">Ligação</option>
            <option value="anuncio">Anúncio</option>
            <option value="outro">Outro</option>
          </select>
        </div>
      )}
      <div>
        <label className="block text-sm font-medium text-gray-700">Como podemos ajudar?</label>
        <textarea name="message" rows={3} className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-700 focus:outline-none" />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={busy} className="w-full rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">
        {busy ? 'Enviando...' : 'Enviar'}
      </button>
    </form>
  )
}
