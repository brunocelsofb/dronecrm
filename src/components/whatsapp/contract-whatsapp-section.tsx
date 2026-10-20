'use client'

import { revealMessage, isSealed } from '@/components/whatsapp/reveal-message'
import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { sendContractWhatsApp, buildWhatsAppFromTemplate, sendContractWhatsAppMedia, resolveContactNameByPhone, saveWhatsAppConversationAsNote } from '@/lib/actions/whatsapp'
import { WhatsAppChatView } from '@/components/whatsapp/whatsapp-chat-view'
import { createClient } from '@/lib/supabase/client'
import { sanitizeStorageFileName } from '@/lib/utils/storage'

type Template = { id: string; name: string }
type WhatsAppLog = {
  id: string
  phone: string
  message: string
  direction: string
  status: string
  triggered_automatically: boolean
  error_message: string | null
  created_at: string
  media_url: string | null
  media_type: string | null
  media_filename: string | null
  sender_photo_url: string | null
  delivery_status: string | null
  sent_by_name?: string | null
}

export function ContractWhatsAppSection({
  contractId,
  isConnected,
  templates,
  defaultPhone,
  messageLog,
}: {
  contractId: string
  isConnected: boolean
  templates: Template[]
  defaultPhone: string | null
  messageLog: WhatsAppLog[]
}) {
  const router = useRouter()
  const [messages, setMessages] = useState<WhatsAppLog[]>(messageLog)
  const processedIds = useRef(new Set<string>(messageLog.map(m => m.id)))

  function addMessage(msg: WhatsAppLog) {
    if (!msg || !msg.id) return
    if (processedIds.current.has(msg.id)) return
    
    processedIds.current.add(msg.id)
    setMessages(prev => {
      const all = [...prev, msg]
      
      // 1. Anti-Duplicação pelo ID do banco
      const uniqueById = new Map(all.map(m => [m.id, m]))
      
      // 2. Anti-Eco Visual (O segredo do sucesso: ignora a mesma mensagem enviada no mesmo minuto)
      const visualSeen = new Set<string>()
      const finalMessages = Array.from(uniqueById.values()).filter(m => {
        const timeKey = m.created_at ? m.created_at.slice(0, 16) : '' // Ex: 2026-08-26T09:15
        const key = `${m.direction}:${m.message}:${timeKey}`
        
        if (visualSeen.has(key)) return false
        visualSeen.add(key)
        return true
      })

      // Ordena certinho para não bagunçar o chat
      return finalMessages.sort((a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
    })
  }

  useEffect(() => {
    const phoneToUse = defaultPhone
    if (!phoneToUse) return
    const cleanPhone = phoneToUse.replace(/\D/g, '')
    const normalizedPhone = cleanPhone.length <= 11 ? `55${cleanPhone}` : cleanPhone
    fetch(`/api/whatsapp/conversation?phone=${encodeURIComponent(normalizedPhone)}`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        const phoneMessages: WhatsAppLog[] = d.messages ?? []
        phoneMessages.forEach(m => addMessage(m))
      })
      .catch(console.error)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const [availableInstances, setAvailableInstances] = useState<{ name: string; label: string }[]>([])
  const [selectedInstance, setSelectedInstance] = useState('')

  useEffect(() => {
    Promise.all([
      fetch('/api/settings/evo-instances', { credentials: 'include' }).then(r => r.json()),
      fetch('/api/settings/evo-aliases', { credentials: 'include' }).then(r => r.json()).catch(() => ({ aliases: {} })),
    ]).then(([instData, aliasData]) => {
      const aliases: Record<string, any> = aliasData.aliases ?? {}
      const list = (instData.instances ?? []).map((i: any) => {
        const name = i.instance?.instanceName ?? i.instanceName ?? i.name ?? ''
        const v = aliases[name]
        const label = !v ? name : typeof v === 'string' ? v : (v as any).label || name
        return { name, label }
      }).filter((i: any) => i.name)
      setAvailableInstances(list)
      if (list[0]) setSelectedInstance(list[0].name)
    }).catch(console.error)
  }, [])

  useEffect(() => {
    const cleanPhone = (defaultPhone ?? '').replace(/\D/g, '')
    if (!cleanPhone) return

    const supabase = createClient()
    const channel = supabase
      .channel(`whatsapp-oportunidade:${contractId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'contract_crm', table: 'contract_whatsapp_messages' },
        (payload) => {
          const msg = payload.new as WhatsAppLog
          if (!msg || !msg.id) return

          const matchContract = (msg as any).contract_id === contractId
          
          const msgPhone = (msg.phone ?? '').replace(/\D/g, '')
          const matchPhone = cleanPhone.length >= 8 && msgPhone.endsWith(cleanPhone.slice(-8))

          if (!matchContract && !matchPhone) return

          // O texto vem cifrado do banco: abre antes de mostrar (na atualização, mantém o já aberto)
          if (payload.eventType === 'INSERT') {
            void revealMessage(msg as WhatsAppLog & { message?: string | null }).then(m => addMessage(m as WhatsAppLog))
          } else if (payload.eventType === 'UPDATE') {
            const { message: sealed, ...rest } = msg as WhatsAppLog & { message?: string | null }
            const patch = isSealed(sealed) ? rest : msg
            setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, ...patch } : m))
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [contractId, defaultPhone])

  const conversationPhone = messages[0]?.phone ?? defaultPhone ?? ''
  const [phone, setPhone] = useState(defaultPhone ?? conversationPhone)
  const [message, setMessage] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resolvedName, setResolvedName] = useState<string | null>(null)
  const [showNoteBox, setShowNoteBox] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [noteSaved, setNoteSaved] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  // Controle visual do arquivo selecionado
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null)

  useEffect(() => {
    if (conversationPhone) resolveContactNameByPhone(conversationPhone).then(setResolvedName)
  }, [conversationPhone])

  async function handleTemplateChange(id: string) {
    setTemplateId(id)
    if (!id) return
    const filled = await buildWhatsAppFromTemplate(id, contractId)
    if (filled) {
      setMessage(filled.message)
      if (filled.phone) setPhone(filled.phone)
    }
  }

  // Lida com o envio principal (decide se manda só texto ou se manda anexo)
  async function handleSend() {
    // Se tem arquivo selecionado, prioriza o envio do anexo
    if (fileInputRef.current?.files?.[0]) {
      await handleFileUpload()
      return
    }

    // Se não tem arquivo, envia só texto
    if (!message.trim()) return
    setBusy(true); setError(null)

    const result = await sendContractWhatsApp(contractId, phone, message, templateId || null, selectedInstance || null)
    setBusy(false)

    if (result.error) {
      setError(result.error)
    } else {
      setMessage('')
      setTemplateId('')
      
      const res = result as any
      if (res.message || res.data) {
        addMessage((res.message || res.data) as WhatsAppLog)
      } else if (res.id) {
        addMessage(res as WhatsAppLog)
      }
    }
  }

  async function handleFileUpload() {
    const file = fileInputRef.current?.files?.[0]
    if (!file || !phone) {
      if (!phone) setError('Informe o telefone antes de enviar um arquivo.')
      return
    }
    setBusy(true)
    setError(null)

    const supabase = createClient()
    const storagePath = `whatsapp-media/${contractId}/${Date.now()}-${sanitizeStorageFileName(file.name)}`
    const { error: uploadError } = await supabase.storage.from('proposal-files').upload(storagePath, file)

    if (uploadError) {
      setBusy(false)
      setError(`Falha no upload: ${uploadError.message}`)
      return
    }

    const publicUrl = `${window.location.origin}/api/email-assets/${storagePath}`
    const mediaType = file.type.startsWith('image/') ? 'image' : (file.type.startsWith('video/') ? 'video' : (file.type.startsWith('audio/') ? 'audio' : 'document'))
    
    // Ignorando o tipo para forçar a aceitação do video/audio pela função
    const result = await sendContractWhatsAppMedia(contractId, phone, publicUrl, mediaType as any, file.name)

    setBusy(false)
    if (result.error) setError(result.error)
    else {
      if (fileInputRef.current) fileInputRef.current.value = ''
      setSelectedFileName(null)
      setMessage('') 
      
      const res = result as any
      if (res.message || res.data) {
        addMessage((res.message || res.data) as WhatsAppLog)
      } else if (res.id) {
        addMessage(res as WhatsAppLog)
      }
    }
  }

  function buildConversationSummary(): string {
    const chronological = [...messages].reverse()
    return chronological
      .map((m) => `${m.direction === 'enviado' ? 'Nós' : resolvedName ?? phone}: ${m.message}`)
      .join('\n')
  }

  async function handleSaveNote() {
    setBusy(true)
    const text = noteText.trim() || buildConversationSummary()
    await saveWhatsAppConversationAsNote(contractId, `[Conversa de WhatsApp salva]\n\n${text}`)
    setBusy(false)
    setNoteSaved(true)
    setShowNoteBox(false)
    setNoteText('')
    router.refresh()
  }

  if (!isConnected) {
    return (
      <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-4 text-sm text-yellow-900">
        WhatsApp ainda não está conectado — vá em{' '}
        <a href="/settings" className="underline">Configurações</a> e conecte o Z-API.
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0 p-2">
      <div className="shrink-0 flex items-center justify-between pb-2">
        <p className="text-xs text-gray-400">{messages.length} mensage{messages.length === 1 ? 'm' : 'ns'}</p>
        <div>
          <button onClick={() => setShowNoteBox((v) => !v)} className="text-xs text-brand-700 hover:underline">
            📝 Salvar conversa como nota
          </button>
          {noteSaved && <span className="ml-2 text-xs text-positive-700">Salvo no histórico!</span>}
        </div>
      </div>

      {showNoteBox && (
        <div className="space-y-2 rounded-lg border border-brand-200 bg-brand-50 p-3">
          <p className="text-xs text-gray-600">Deixa em branco pra salvar a conversa inteira, ou escreve um resumo:</p>
          <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={3} placeholder="Ex: Cliente confirmou interesse, aguardando aprovação do jurídico." className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none" />
          <button onClick={handleSaveNote} disabled={busy} className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-800 disabled:opacity-50">
            {busy ? 'Salvando...' : 'Salvar nota'}
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        <WhatsAppChatView messages={messages} contactName={resolvedName ?? 'Sem contato cadastrado'} contactPhone={conversationPhone} />
      </div>

      <div className="shrink-0 space-y-2 rounded-lg border border-gray-200 bg-white p-3 mt-2">
        <p className="text-sm font-medium text-gray-900">Enviar WhatsApp</p>
        {templates.length > 0 && (
          <div>
            <label className="block text-xs text-gray-500">Usar template (opcional)</label>
            <select value={templateId} onChange={(e) => handleTemplateChange(e.target.value)} className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none">
              <option value="">Escrever do zero...</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        )}
        {availableInstances.length > 1 && (
          <div>
            <label className="block text-xs text-gray-500">Remetente</label>
            <select value={selectedInstance} onChange={e => setSelectedInstance(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none">
              {availableInstances.map(i => <option key={i.name} value={i.name}>{i.label}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="block text-xs text-gray-500">Telefone</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="62999999999" className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none" />
        </div>
        
        {/* Nova Barra de Mensagem Estilo WhatsApp */}
        <div>
          <label className="block text-xs text-gray-500 mb-1">Mensagem</label>
          <div className="flex items-end gap-2 bg-white rounded-md border border-gray-300 p-1 focus-within:border-brand-700">
            
            {/* Botão de Anexo (Clipe) */}
            <label className={`cursor-pointer p-2 rounded-full transition-colors self-end mb-[2px]
              ${selectedFileName ? 'text-brand-600 bg-brand-50' : 'text-gray-500 hover:bg-gray-100'}`} 
              title="Anexar arquivo">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 transform -rotate-45">
                <path strokeLinecap="round" strokeLinejoin="round" d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13" />
              </svg>
              <input 
                ref={fileInputRef} 
                type="file" 
                className="hidden" 
                accept="image/*, video/*, audio/*, application/pdf, .doc, .docx, .xls, .xlsx" 
                onChange={(e) => {
                  if (e.target.files?.[0]) setSelectedFileName(e.target.files[0].name)
                  else setSelectedFileName(null)
                }}
              />
            </label>

            {/* Caixa de Texto */}
            <div className="flex-1 min-w-0 flex flex-col">
              {/* Mostrador do arquivo selecionado */}
              {selectedFileName && (
                <div className="flex items-center justify-between bg-brand-50 text-brand-700 text-xs px-2 py-1 rounded mb-1 mr-2 mt-1">
                  <span className="truncate flex-1">📎 {selectedFileName}</span>
                  <button 
                    type="button" 
                    onClick={() => {
                      if (fileInputRef.current) fileInputRef.current.value = ''
                      setSelectedFileName(null)
                    }}
                    className="ml-2 text-brand-700 hover:text-red-600 shrink-0 font-bold px-1"
                    title="Remover anexo">
                    ✕
                  </button>
                </div>
              )}
              
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={selectedFileName ? "Adicione uma legenda..." : "Escreva sua mensagem..."}
                onInput={(e) => {
                  const el = e.currentTarget
                  el.style.height = 'auto'
                  el.style.height = Math.min(el.scrollHeight, 160) + 'px'
                }}
                rows={1}
                className="w-full px-2 py-1.5 text-sm bg-transparent outline-none resize-none overflow-y-auto"
                style={{ minHeight: '34px', maxHeight: '160px' }}
              />
            </div>

            {/* Botão de Enviar Integrado */}
            <button 
              onClick={handleSend} 
              disabled={busy || (!message.trim() && !selectedFileName)} 
              className="p-2 mb-[2px] rounded-full bg-brand-700 text-white hover:bg-brand-800 disabled:opacity-50 disabled:bg-gray-300 disabled:text-gray-500 transition-colors shrink-0"
              title="Enviar mensagem">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                <path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" />
              </svg>
            </button>
          </div>
        </div>
        
        {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
        {busy && <p className="text-xs text-brand-600 mt-1">Enviando... aguarde.</p>}
      </div>
    </div>
  )
}
