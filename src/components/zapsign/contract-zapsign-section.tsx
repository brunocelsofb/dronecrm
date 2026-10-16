'use client'

// Assinatura digital (ZapSign) dentro da aba "Contrato e aditivos".
// Dois caminhos: gerar pelo MODELO da ZapSign (contrato nosso, preenchido com
// os dados do CRM) ou enviar um PDF já anexado nesta aba. Quando todos assinam,
// o PDF assinado volta sozinho para a lista de documentos.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { sendForSignature, syncZapSignDocumentStatus, registerZapSignDocument, type SignatureSigner } from '@/lib/actions/zapsign'
import { getFileDownloadUrl } from '@/lib/actions/files'

type Template = { id: string; name: string; type: string }
type Signer = { name: string; email: string; status: string; sign_url: string; signed_at: string | null }
type ZapSignDoc = {
  id: string; name: string; status: string; sent_at: string | null; signed_at: string | null
  source: string; document_kind: string; signers: Signer[] | null; signed_file_id: string | null
}
type PdfDoc = { id: string; file_name: string; kind: 'contrato' | 'aditivo' }

const STATUS_LABEL: Record<string, string> = { pendente: 'Rascunho', enviado: '⏳ Aguardando assinatura', assinado: '✅ Assinado', recusado: '❌ Recusado', expirado: '🕐 Expirado', erro: '⚠️ Erro' }
const STATUS_COLOR: Record<string, string> = { pendente: 'bg-gray-100 text-gray-600', enviado: 'bg-warn-600/15 text-warn-700', assinado: 'bg-positive-100 text-positive-700', recusado: 'bg-negative-100 text-negative-700', expirado: 'bg-gray-100 text-gray-600', erro: 'bg-negative-100 text-negative-700' }
const input = 'mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-xs focus:border-brand-700 focus:outline-none'

export function ContractZapSignSection({
  contractId, templates, documents, pdfDocs, signedFilePaths, defaultContactName, defaultContactEmail, defaultContactPhone, isConnected, clientName,
}: {
  contractId: string; templates: Template[]; documents: ZapSignDoc[]; pdfDocs: PdfDoc[]; signedFilePaths: Record<string, string>
  defaultContactName: string | null; defaultContactEmail: string | null; defaultContactPhone: string | null; isConnected: boolean; clientName: string
}) {
  const router = useRouter()
  const [showForm, setShowForm] = useState(false)
  const [source, setSource] = useState<'modelo' | 'pdf'>(templates.length ? 'modelo' : 'pdf')
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '')
  const [fileId, setFileId] = useState(pdfDocs[0]?.id ?? '')
  const [kind, setKind] = useState<'contrato' | 'aditivo'>('contrato')
  const [documentName, setDocumentName] = useState(`Contrato — ${clientName}`)
  const [signers, setSigners] = useState<SignatureSigner[]>([{ name: defaultContactName ?? '', email: defaultContactEmail ?? '', phone: defaultContactPhone ?? '', qualify: 'Contratante', sendWhatsApp: false }])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [showRegister, setShowRegister] = useState(false)
  const [regLink, setRegLink] = useState('')
  const [regName, setRegName] = useState(`Contrato — ${clientName}`)
  const [regKind, setRegKind] = useState<'contrato' | 'aditivo'>('contrato')

  async function handleRegister() {
    setError(null); setBusy(true)
    try {
      const r = await registerZapSignDocument({ contractId, link: regLink, name: regName, kind: regKind })
      if (r.error) { setError(r.error); return }
      setShowRegister(false); setRegLink('')
      router.refresh()
    } catch {
      setError('Não foi possível registrar agora (falha de conexão). Tente de novo.')
    } finally {
      setBusy(false)
    }
  }

  const selectedFile = pdfDocs.some(f => f.id === fileId) ? fileId : (pdfDocs[0]?.id ?? '')

  function updateSigner(index: number, field: keyof SignatureSigner, value: string | boolean) {
    setSigners(prev => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)))
  }

  function pickKind(k: 'contrato' | 'aditivo') {
    setKind(k)
    setDocumentName(n => (n === `Contrato — ${clientName}` || n === `Aditivo — ${clientName}` ? `${k === 'contrato' ? 'Contrato' : 'Aditivo'} — ${clientName}` : n))
  }

  async function handleSend() {
    setError(null)
    setBusy(true)
    try {
      const r = await sendForSignature({ contractId, source, templateId, fileId: selectedFile, kind, documentName, signers })
      if (r.error) { setError(r.error); return }
      setShowForm(false)
      router.refresh()
    } catch {
      setError('Não foi possível enviar agora (falha de conexão). Tente de novo.')
    } finally {
      setBusy(false)
    }
  }

  async function handleSync(docId: string) {
    setSyncing(docId); setError(null)
    const r = await syncZapSignDocumentStatus(docId)
    if (r.error) setError(r.error)
    setSyncing(null); router.refresh()
  }

  async function openSigned(fileId: string) {
    const path = signedFilePaths[fileId]
    if (!path) return
    const r = await getFileDownloadUrl(path)
    if ('url' in r && r.url) window.open(r.url, '_blank')
    else setError('Não foi possível abrir o PDF assinado.')
  }

  async function copyLink(url: string) {
    try { await navigator.clipboard.writeText(url); setCopied(url); setTimeout(() => setCopied(null), 2000) } catch { window.prompt('Copie o link:', url) }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-gray-900">✍️ Assinatura digital (ZapSign)</p>
          <p className="text-xs text-gray-500">Envie o documento pela ZapSign e registre o link aqui: quando todos assinarem, o PDF assinado entra na lista acima e o consultor recebe a tarefa de dar ganho.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => { setShowRegister(v => !v); setShowForm(false) }} className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-800">
            {showRegister ? 'Fechar' : '+ Registrar documento da ZapSign'}
          </button>
          {isConnected && (
            <button onClick={() => { setShowForm(v => !v); setShowRegister(false) }} title="Cria o documento direto do CRM (exige Plano de API da ZapSign)" className="rounded-md border border-brand-700 px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-100">
              {showForm ? 'Fechar' : 'Criar pelo CRM (Plano de API)'}
            </button>
          )}
        </div>
      </div>

      {showRegister && (
        <div className="space-y-3 rounded-xl border border-brand-100 bg-brand-100/40 p-4">
          <ol className="list-decimal space-y-0.5 pl-4 text-xs text-gray-700">
            <li>Na ZapSign, crie e envie o documento normalmente.</li>
            <li>Copie o link do documento (ou o link de assinatura de um signatário) e cole abaixo.</li>
          </ol>
          <div>
            <label className="block text-xs text-gray-500">Link do documento na ZapSign</label>
            <input value={regLink} onChange={e => setRegLink(e.target.value)} placeholder="https://app.zapsign.com.br/…" className={input} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs text-gray-500">Nome do documento</label>
              <input value={regName} onChange={e => setRegName(e.target.value)} className={input} />
            </div>
            <div>
              <p className="text-xs text-gray-500">Tipo</p>
              <div className="mt-2 flex gap-3 text-xs text-gray-700">
                <label className="flex items-center gap-1.5"><input type="radio" checked={regKind === 'contrato'} onChange={() => { setRegKind('contrato'); setRegName(n => n.replace(/^Aditivo — /, 'Contrato — ')) }} /> Contrato</label>
                <label className="flex items-center gap-1.5"><input type="radio" checked={regKind === 'aditivo'} onChange={() => { setRegKind('aditivo'); setRegName(n => n.replace(/^Contrato — /, 'Aditivo — ')) }} /> Aditivo</label>
              </div>
            </div>
          </div>
          {error && <p role="alert" className="text-xs text-negative-700">{error}</p>}
          <button onClick={handleRegister} disabled={busy || !regLink.trim()} className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">{busy ? 'Registrando…' : 'Registrar'}</button>
          <p className="text-[11px] text-gray-500">Para o retorno automático, o Admin ativa uma vez em Configurações → ZapSign → “Avisos de assinatura sem Plano de API”.</p>
        </div>
      )}

      {showForm && isConnected && (
        <div className="space-y-3 rounded-xl border border-brand-100 bg-brand-100/40 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium text-gray-600">1. O que assinar</p>
              <div className="mt-1 flex flex-col gap-1 text-xs text-gray-700">
                <label className="flex items-center gap-2"><input type="radio" checked={source === 'modelo'} onChange={() => setSource('modelo')} /> Gerar pelo modelo da ZapSign (contrato nosso)</label>
                <label className="flex items-center gap-2"><input type="radio" checked={source === 'pdf'} onChange={() => setSource('pdf')} /> PDF já anexado nesta aba</label>
              </div>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-600">Tipo</p>
              <div className="mt-1 flex gap-3 text-xs text-gray-700">
                <label className="flex items-center gap-1.5"><input type="radio" checked={kind === 'contrato'} onChange={() => pickKind('contrato')} /> Contrato</label>
                <label className="flex items-center gap-1.5"><input type="radio" checked={kind === 'aditivo'} onChange={() => pickKind('aditivo')} /> Aditivo</label>
              </div>
            </div>
          </div>

          {source === 'modelo' ? (
            <div>
              <label className="block text-xs text-gray-500">Modelo</label>
              <select value={templateId} onChange={e => setTemplateId(e.target.value)} className={input}>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name} ({t.type})</option>)}
              </select>
              {templates.length === 0
                ? <p className="mt-1 text-xs text-warn-700">Nenhum modelo cadastrado — um administrador cadastra em <a href="/zapsign" className="underline">Modelos ZapSign</a>.</p>
                : <p className="mt-1 text-[11px] text-gray-500">O CRM preenche as variáveis do modelo com os dados deste contrato (cliente, CNPJ, valor, vigência…).</p>}
            </div>
          ) : (
            <div>
              <label className="block text-xs text-gray-500">PDF</label>
              {pdfDocs.length ? (
                <select value={selectedFile} onChange={e => setFileId(e.target.value)} className={input}>
                  {pdfDocs.map(f => <option key={f.id} value={f.id}>{f.kind === 'aditivo' ? 'Aditivo' : 'Contrato'} · {f.file_name}</option>)}
                </select>
              ) : <p className="mt-1 text-xs text-warn-700">Anexe o PDF acima (como Contrato ou Aditivo) e volte aqui.</p>}
            </div>
          )}

          <div>
            <label className="block text-xs text-gray-500">Nome do documento</label>
            <input value={documentName} onChange={e => setDocumentName(e.target.value)} className={input} />
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-gray-600">2. Quem assina <span className="font-normal text-gray-500">(a ZapSign envia o link por e-mail)</span></p>
            {signers.map((s, i) => (
              <div key={i} className="grid grid-cols-1 gap-2 rounded-md border border-gray-200 bg-white p-3 sm:grid-cols-2">
                <div><label className="block text-xs text-gray-500">Nome</label><input value={s.name} onChange={e => updateSigner(i, 'name', e.target.value)} className={input} /></div>
                <div><label className="block text-xs text-gray-500">E-mail</label><input value={s.email} onChange={e => updateSigner(i, 'email', e.target.value)} type="email" className={input} /></div>
                <div><label className="block text-xs text-gray-500">Celular (com DDD)</label><input value={s.phone ?? ''} onChange={e => updateSigner(i, 'phone', e.target.value)} placeholder="62999999999" className={input} /></div>
                <div><label className="block text-xs text-gray-500">Assina como</label><input value={s.qualify ?? ''} onChange={e => updateSigner(i, 'qualify', e.target.value)} placeholder="Contratante, Contratada, Testemunha…" className={input} /></div>
                <div className="flex items-center gap-2 sm:col-span-2">
                  <input type="checkbox" id={`wpp-${i}`} checked={!!s.sendWhatsApp} onChange={e => updateSigner(i, 'sendWhatsApp', e.target.checked)} />
                  <label htmlFor={`wpp-${i}`} className="text-xs text-gray-600">Também enviar o link por WhatsApp (cobrado pela ZapSign)</label>
                  {signers.length > 1 && <button type="button" onClick={() => setSigners(prev => prev.filter((_, j) => j !== i))} className="ml-auto text-xs text-negative-600 hover:underline">Remover</button>}
                </div>
              </div>
            ))}
            <button type="button" onClick={() => setSigners(prev => [...prev, { name: '', email: '', phone: '', qualify: '', sendWhatsApp: false }])} className="text-xs font-medium text-brand-700 hover:underline">+ Adicionar signatário</button>
          </div>

          {error && <p role="alert" className="text-xs text-negative-700">{error}</p>}
          <div className="flex gap-2">
            <button onClick={handleSend} disabled={busy} className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">{busy ? 'Enviando…' : '3. Enviar para assinatura'}</button>
            <button onClick={() => setShowForm(false)} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">Cancelar</button>
          </div>
        </div>
      )}
      {error && !showForm && !showRegister && <p role="alert" className="text-xs text-negative-700">{error}</p>}

      <div className="space-y-2">
        {documents.map(doc => (
          <div key={doc.id} className="rounded-lg border border-gray-200 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">{doc.name}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_COLOR[doc.status] ?? 'bg-gray-100 text-gray-600'}`}>{STATUS_LABEL[doc.status] ?? doc.status}</span>
                  <span className="text-[11px] text-gray-500">{doc.document_kind === 'aditivo' ? 'Aditivo' : 'Contrato'} · {doc.source === 'manual' ? 'enviado pela ZapSign' : doc.source === 'pdf' ? 'PDF anexado' : 'modelo ZapSign'}</span>
                  {doc.sent_at && <span className="text-[11px] text-gray-400">Enviado {new Date(doc.sent_at).toLocaleDateString('pt-BR')}</span>}
                  {doc.signed_at && <span className="text-[11px] text-gray-400">Assinado {new Date(doc.signed_at).toLocaleDateString('pt-BR')}</span>}
                </div>
              </div>
              <div className="flex shrink-0 gap-3">
                {doc.signed_file_id && signedFilePaths[doc.signed_file_id] && (
                  <button onClick={() => openSigned(doc.signed_file_id!)} className="text-xs font-medium text-positive-700 hover:underline">Baixar assinado</button>
                )}
                {doc.source !== 'manual' && isConnected && (doc.status === 'enviado' || (doc.status === 'assinado' && !doc.signed_file_id)) && (
                  <button onClick={() => handleSync(doc.id)} disabled={syncing === doc.id} className="text-xs text-gray-600 hover:underline disabled:opacity-50">
                    {syncing === doc.id ? 'Atualizando…' : 'Atualizar status'}
                  </button>
                )}
              </div>
            </div>
            {(doc.signers ?? []).length > 0 && (
              <ul className="mt-2 space-y-1 border-t border-gray-100 pt-2">
                {(doc.signers ?? []).map((s, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2 text-xs">
                    <span className={s.status === 'signed' ? 'text-positive-700' : 'text-gray-700'}>{s.status === 'signed' ? '✓' : '○'} {s.name}</span>
                    <span className="text-gray-400">{s.email}</span>
                    {s.status !== 'signed' && doc.status === 'enviado' && s.sign_url && (
                      <button onClick={() => copyLink(s.sign_url)} className="text-brand-700 hover:underline">{copied === s.sign_url ? 'Link copiado' : 'Copiar link de assinatura'}</button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {documents.length === 0 && <p className="text-xs text-gray-400">Nenhum documento enviado para assinatura ainda.</p>}
      </div>
    </div>
  )
}
