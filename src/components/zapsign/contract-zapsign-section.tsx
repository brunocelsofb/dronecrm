'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { sendContractToZapSign, syncZapSignDocumentStatus } from '@/lib/actions/zapsign'

type Template = { id: string; name: string; type: string }
type ZapSignDoc = { id: string; name: string; status: string; sent_at: string | null; signed_at: string | null; pdf_url: string | null; signed_pdf_url: string | null }

const STATUS_LABEL: Record<string, string> = { pendente: 'Rascunho', enviado: '⏳ Aguardando assinatura', assinado: '✅ Assinado', recusado: '❌ Recusado', expirado: '🕐 Expirado', erro: '⚠️ Erro' }
const STATUS_COLOR: Record<string, string> = { pendente: 'bg-gray-100 text-gray-600', enviado: 'bg-yellow-100 text-yellow-700', assinado: 'bg-positive-100 text-positive-700', recusado: 'bg-red-100 text-red-700', expirado: 'bg-gray-100 text-gray-600', erro: 'bg-red-100 text-red-700' }

export function ContractZapSignSection({
  contractId, templates, documents, defaultContactName, defaultContactEmail, defaultContactPhone, isConnected,
}: {
  contractId: string; templates: Template[]; documents: ZapSignDoc[]
  defaultContactName: string | null; defaultContactEmail: string | null; defaultContactPhone: string | null; isConnected: boolean
}) {
  const router = useRouter()
  const [showForm, setShowForm] = useState(false)
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '')
  const [documentName, setDocumentName] = useState('')
  const [signers, setSigners] = useState([{ name: defaultContactName ?? '', email: defaultContactEmail ?? '', phone: defaultContactPhone ?? '', qualify: 'Contratante', sendWhatsApp: false }])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState<string | null>(null)

  function updateSigner(index: number, field: string, value: string | boolean) {
    setSigners((prev) => prev.map((s, i) => i === index ? { ...s, [field]: value } : s))
  }

  async function handleSend() {
    if (!templateId) return setError('Selecione um modelo.')
    if (!documentName.trim()) return setError('Dê um nome pra este documento.')
    if (signers.some((s) => !s.name || !s.email)) return setError('Preencha nome e e-mail de todos os signatários.')
    setBusy(true); setError(null)
    const result = await sendContractToZapSign(contractId, templateId, documentName, signers)
    setBusy(false)
    if (result.error) setError(result.error)
    else { setShowForm(false); router.refresh() }
  }

  async function handleSync(docId: string) {
    setSyncing(docId)
    await syncZapSignDocumentStatus(docId)
    setSyncing(null); router.refresh()
  }

  if (!isConnected) return (
    <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-4 text-sm text-yellow-900">
      Configure o token da ZapSign em <a href="/settings" className="underline">Configurações</a> antes de usar.
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-900">Contratos e Assinaturas</p>
        <button onClick={() => setShowForm((v) => !v)} className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-800">
          + Enviar pra ZapSign
        </button>
      </div>

      {showForm && (
        <div className="space-y-3 rounded-lg border border-brand-200 bg-brand-50 p-4">
          <div>
            <label className="block text-xs text-gray-500">Modelo</label>
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none">
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.type})</option>)}
            </select>
            {templates.length === 0 && <p className="mt-1 text-xs text-yellow-700">Nenhum modelo — crie em <a href="/zapsign" className="underline">Modelos ZapSign</a>.</p>}
          </div>
          <div>
            <label className="block text-xs text-gray-500">Nome do documento</label>
            <input value={documentName} onChange={(e) => setDocumentName(e.target.value)} placeholder="Ex: Contrato — Cliente XYZ" className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none" />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium text-gray-600">Signatários</p>
            {signers.map((s, i) => (
              <div key={i} className="grid grid-cols-2 gap-2 rounded-md border border-gray-200 bg-white p-3">
                <div><label className="block text-xs text-gray-500">Nome</label><input value={s.name} onChange={(e) => updateSigner(i, 'name', e.target.value)} className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-xs focus:border-brand-700 focus:outline-none" /></div>
                <div><label className="block text-xs text-gray-500">E-mail</label><input value={s.email} onChange={(e) => updateSigner(i, 'email', e.target.value)} type="email" className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-xs focus:border-brand-700 focus:outline-none" /></div>
                <div><label className="block text-xs text-gray-500">Telefone</label><input value={s.phone} onChange={(e) => updateSigner(i, 'phone', e.target.value)} placeholder="62999999999" className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-xs focus:border-brand-700 focus:outline-none" /></div>
                <div><label className="block text-xs text-gray-500">Qualificação</label><input value={s.qualify} onChange={(e) => updateSigner(i, 'qualify', e.target.value)} placeholder="Contratante, Testemunha..." className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-xs focus:border-brand-700 focus:outline-none" /></div>
                <div className="col-span-2 flex items-center gap-2">
                  <input type="checkbox" id={`wpp-${i}`} checked={s.sendWhatsApp} onChange={(e) => updateSigner(i, 'sendWhatsApp', e.target.checked)} />
                  <label htmlFor={`wpp-${i}`} className="text-xs text-gray-600">Enviar link por WhatsApp (R$ 0,50 cobrado pela ZapSign)</label>
                  {signers.length > 1 && <button type="button" onClick={() => setSigners((prev) => prev.filter((_, j) => j !== i))} className="ml-auto text-xs text-negative-600 hover:underline">Remover</button>}
                </div>
              </div>
            ))}
            <button type="button" onClick={() => setSigners((prev) => [...prev, { name: '', email: '', phone: '', qualify: '', sendWhatsApp: false }])} className="text-xs text-brand-700 hover:underline">+ Adicionar signatário</button>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button onClick={handleSend} disabled={busy} className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">{busy ? 'Enviando...' : 'Enviar pra assinatura'}</button>
            <button onClick={() => setShowForm(false)} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">Cancelar</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {documents.map((doc) => (
          <div key={doc.id} className="rounded-lg border border-gray-200 bg-white p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-gray-900">{doc.name}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_COLOR[doc.status] ?? 'bg-gray-100 text-gray-600'}`}>{STATUS_LABEL[doc.status] ?? doc.status}</span>
                  {doc.sent_at && <span className="text-xs text-gray-400">Enviado {new Date(doc.sent_at).toLocaleDateString('pt-BR')}</span>}
                  {doc.signed_at && <span className="text-xs text-gray-400">Assinado {new Date(doc.signed_at).toLocaleDateString('pt-BR')}</span>}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                {doc.pdf_url && <a href={doc.pdf_url} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-700 hover:underline">Ver PDF</a>}
                {doc.signed_pdf_url && <a href={doc.signed_pdf_url} target="_blank" rel="noopener noreferrer" className="text-xs text-positive-700 hover:underline">Baixar assinado</a>}
                {doc.status === 'enviado' && <button onClick={() => handleSync(doc.id)} disabled={syncing === doc.id} className="text-xs text-gray-500 hover:underline disabled:opacity-50">{syncing === doc.id ? 'Atualizando...' : 'Atualizar status'}</button>}
              </div>
            </div>
          </div>
        ))}
        {documents.length === 0 && <p className="text-sm text-gray-400">Nenhum contrato enviado pra assinatura ainda.</p>}
      </div>
    </div>
  )
}
