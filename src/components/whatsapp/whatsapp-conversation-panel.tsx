'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import {
  linkUnlinkedWhatsAppConversation,
  sendUnlinkedWhatsAppMessage,
  sendUnlinkedWhatsAppMedia,
  assignWhatsAppConversation,
  unassignWhatsAppConversation,
  archiveWhatsAppConversation,
  unarchiveWhatsAppConversation,
  saveUnlinkedContactName,
  deleteWhatsAppConversation,
  finishConversationWithNPS,
} from '@/lib/actions/whatsapp'
import { WhatsAppChatView } from '@/components/whatsapp/whatsapp-chat-view'
import { ConvertLeadModal } from '@/components/whatsapp/convert-lead-modal'

type Message = {
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
  unlinked_sender_name?: string | null
}

type ContractOption = { id: string; label: string }

// ── Modal de NPS inline ──────────────────────────────────────────────────────
function FinalizarNPSModal({
  phone,
  instanceName,
  onClose,
  onSuccess,
}: {
  phone: string
  instanceName?: string | null
  onClose: () => void
  onSuccess: () => void
}) {
  const [loading, setLoading] = useState(false)

  async function handleFinalize(sendNPS: boolean) {
    setLoading(true)
    const result = await finishConversationWithNPS(phone, instanceName, sendNPS)
    setLoading(false)
    if (result?.error) {
      alert(`Erro: ${result.error}`)
      return
    }
    onSuccess()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-sm rounded-xl bg-white shadow-xl p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-1">✅ Finalizar atendimento</h2>
        <p className="text-xs text-gray-500 mb-4">
          Deseja enviar uma pesquisa de satisfação (NPS) ao cliente antes de encerrar?
        </p>
        <div className="flex flex-col gap-2">
          <button
            onClick={() => handleFinalize(true)}
            disabled={loading}
            className="w-full rounded-lg bg-green-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            🌟 Finalizar e enviar NPS
          </button>
          <button
            onClick={() => handleFinalize(false)}
            disabled={loading}
            className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            🗃️ Finalizar sem NPS
          </button>
          <button
            onClick={onClose}
            disabled={loading}
            className="w-full rounded-lg px-4 py-2 text-xs text-gray-400 hover:text-gray-600 disabled:opacity-50"
          >
            Cancelar
          </button>
        </div>
        {loading && <p className="mt-3 text-center text-xs text-gray-400">Processando...</p>}
      </div>
    </div>
  )
}

export function WhatsAppConversationPanel({
  phone,
  displayName,
  leadId,
  messages,
  searchContracts,
  currentUserId,
  users,
  assignment,
  instanceName,
  initialIsArchived,
  onArchiveSuccess,
}: {
  phone: string
  displayName: string | null
  leadId: string | null
  messages: Message[]
  searchContracts: (query: string) => Promise<ContractOption[]>
  currentUserId: string
  users: { id: string; full_name: string }[]
  assignment: { assigned_to: string; assigned_to_name: string } | null
  instanceName?: string | null
  initialIsArchived?: boolean
  onArchiveSuccess?: (phone: string) => void
}) {
  const router = useRouter()
  const supabase = createClient()
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null)

  const [isArchived, setIsArchived] = useState(initialIsArchived ?? false)
  const [profilePicUrl, setProfilePicUrl] = useState<string | null>(null)
  const [localMessages, setLocalMessages] = useState<Message[]>(messages)
  const processedIds = useRef(new Set<string>(messages.map(m => m.id)))

  // ── Estado do modal NPS ────────────────────────────────────────────────────
  const [showNPSModal, setShowNPSModal] = useState(false)

  function addMessageSafe(msg: Message) {
    if (!msg?.id || processedIds.current.has(msg.id)) return
    processedIds.current.add(msg.id)
    setLocalMessages(prev => {
      const all = [...prev.filter(m => !m.id.startsWith('opt-')), msg]
      const uniqueById = new Map(all.map(m => [m.id, m]))
      const visualSeen = new Set<string>()
      return Array.from(uniqueById.values()).filter(m => {
        const key = `${m.direction}:${m.message}:${(m.created_at ?? '').slice(0, 16)}`
        if (visualSeen.has(key)) return false
        visualSeen.add(key)
        return true
      })
    })
  }

  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState(displayName ?? '')
  const [localDisplayName, setLocalDisplayName] = useState(displayName)

  useEffect(() => {
    setLocalDisplayName(displayName)
    setNameInput(displayName ?? '')
  }, [displayName])

  const [showAssignPicker, setShowAssignPicker] = useState(false)
  const [showLinkSearch, setShowLinkSearch] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ContractOption[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [availableInstances, setAvailableInstances] = useState<{ name: string; label: string }[]>([])
  const [selectedInstance, setSelectedInstance] = useState<string>(instanceName ?? '')

  useEffect(() => { setIsArchived(initialIsArchived ?? false) }, [initialIsArchived])

  useEffect(() => {
    setLocalMessages(prev => {
      const pendingOpt = prev.filter(m => m.id.startsWith('opt-'))
      if (pendingOpt.length === 0) return messages
      return [...messages, ...pendingOpt]
    })
  }, [messages])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [localMessages])

  useEffect(() => {
    const channel = supabase
      .channel(`wpp-${phone}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'contract_crm',
        table: 'contract_whatsapp_messages',
        filter: `phone=eq.${phone}`,
      }, (payload) => {
        const newMsg = payload.new as Message
        addMessageSafe(newMsg)
      })
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'contract_crm',
        table: 'contract_whatsapp_messages',
      }, (payload) => {
        const oldId = payload.old?.id
        if (oldId) setLocalMessages(prev => prev.filter(m => m.id !== oldId))
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [phone, supabase])

  useEffect(() => {
    fetch(`/api/whatsapp/profile-pic?phone=${encodeURIComponent(phone)}`)
      .then(r => r.json())
      .then(d => { if (d.url) setProfilePicUrl(d.url) })
      .catch(() => {})
  }, [phone])

  const loadInstances = useCallback(async () => {
    try {
      const [instRes, aliasRes] = await Promise.all([
        fetch('/api/settings/evo-instances'),
        fetch('/api/settings/evo-aliases'),
      ])
      const instData = await instRes.json()
      const aliasData = await aliasRes.json()
      const aliases: Record<string, any> = aliasData.aliases ?? {}
      const names = (instData.instances ?? [])
        .map((i: any) => i.name ?? i.instance?.instanceName ?? i.instanceName)
        .filter(Boolean)
        .map((name: string) => {
          const v = aliases[name]
          const label = !v ? name : typeof v === 'string' ? v : (v as any).label || name
          return { name, label }
        })
      setAvailableInstances(names)
      if (!selectedInstance && names.length > 0) setSelectedInstance(instanceName ?? names[0].name)
    } catch { }
  }, [instanceName])
  useEffect(() => { loadInstances() }, [loadInstances])
  useEffect(() => { setSelectedInstance(instanceName ?? '') }, [instanceName])

  async function handleClaim() {
    setBusy(true)
    await assignWhatsAppConversation(phone, currentUserId)
    setBusy(false)
    router.refresh()
  }

  async function handleFileUpload() {
    const file = fileInputRef.current?.files?.[0]
    if (!file) return

    setBusy(true)
    setError(null)

    const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_')
    const storagePath = `whatsapp-media/central/${Date.now()}-${safeName}`

    const { error: uploadError } = await supabase.storage.from('proposal-files').upload(storagePath, file)

    if (uploadError) {
      setBusy(false)
      setError(`Falha no upload: ${uploadError.message}`)
      return
    }

    const publicUrl = `${window.location.origin}/api/email-assets/${storagePath}`
    const mediaType = file.type.startsWith('image/') ? 'image' : (file.type.startsWith('video/') ? 'video' : (file.type.startsWith('audio/') ? 'audio' : 'document'))

    const result = await sendUnlinkedWhatsAppMedia(phone, publicUrl, mediaType as any, file.name, selectedInstance || instanceName || undefined)

    setBusy(false)
    if (result?.error) {
      setError(result.error)
    } else {
      if (fileInputRef.current) fileInputRef.current.value = ''
      setSelectedFileName(null)
      setReplyText('')
      router.refresh()
    }
  }

  async function handleReply() {
    if (fileInputRef.current?.files?.[0]) {
      await handleFileUpload()
      return
    }

    if (!replyText.trim()) return

    const optimistic: Message = {
      id: `opt-${Date.now()}`,
      phone, message: replyText, direction: 'enviado',
      status: 'enviado', triggered_automatically: false,
      error_message: null, created_at: new Date().toISOString(),
      media_url: null, media_type: null, media_filename: null,
      sender_photo_url: null, delivery_status: null,
    }
    setLocalMessages(prev => [...prev, optimistic])
    setReplyText('')

    const ta = document.querySelector('textarea[placeholder="Responder..."]') as HTMLTextAreaElement | null
    if (ta) ta.style.height = '34px'

    setBusy(true)
    const result = await sendUnlinkedWhatsAppMessage(phone, replyText, selectedInstance || instanceName || undefined)
    setBusy(false)

    if (result.error) {
      setError(result.error)
      setLocalMessages(prev => prev.filter(m => m.id !== optimistic.id))
    } else if (result.message) {
      setLocalMessages(prev => prev.map(m => m.id === optimistic.id ? { ...result.message, sent_by_name: result.message.sent_by_name ?? undefined } as Message : m))
    }
    router.refresh()
  }

  async function handleAssignTo(userId: string) {
    setBusy(true)
    await assignWhatsAppConversation(phone, userId)
    setBusy(false)
    setShowAssignPicker(false)
    router.refresh()
  }

  async function handleUnassign() {
    setBusy(true)
    await unassignWhatsAppConversation(phone)
    setBusy(false)
    router.refresh()
  }

  const [showConvertModal, setShowConvertModal] = useState(false)

  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return }
    const timeout = setTimeout(() => {
      fetch(`/api/whatsapp/link-account?q=${encodeURIComponent(query)}`, { credentials: 'include' })
        .then(r => r.json())
        .then(d => setResults(d.results ?? []))
        .catch(() => setResults([]))
    }, 300)
    return () => clearTimeout(timeout)
  }, [query])

  async function handleLink(contractId: string) {
    setBusy(true)
    setError(null)
    const result = await linkUnlinkedWhatsAppConversation(phone, contractId)
    setBusy(false)
    if (result.error) setError(result.error)
    else router.refresh()
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Modal NPS */}
      {showNPSModal && (
        <FinalizarNPSModal
          phone={phone}
          instanceName={selectedInstance || instanceName}
          onClose={() => setShowNPSModal(false)}
          onSuccess={() => {
            setShowNPSModal(false)
            setIsArchived(true)
            onArchiveSuccess?.(phone)
            router.push('/whatsapp')
            router.refresh()
          }}
        />
      )}

      <div className="flex-shrink-0 rounded-lg border border-gray-200 bg-white p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {profilePicUrl ? (
              <img src={profilePicUrl} alt="" className="h-9 w-9 rounded-full object-cover flex-shrink-0"
                onError={() => setProfilePicUrl(null)} />
            ) : (
              <div className="h-9 w-9 rounded-full bg-gray-200 flex items-center justify-center text-xs font-semibold text-gray-500 flex-shrink-0">
                {(displayName ?? phone).charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              {editingName ? (
                <form onSubmit={async (e) => {
                  e.preventDefault()
                  if (!nameInput.trim()) { setEditingName(false); return }
                  await saveUnlinkedContactName(phone, nameInput.trim())
                  setLocalDisplayName(nameInput.trim())
                  setEditingName(false)
                  router.refresh()
                }} className="flex items-center gap-1">
                  <input
                    autoFocus
                    value={nameInput}
                    onChange={e => setNameInput(e.target.value)}
                    onBlur={async () => {
                      if (nameInput.trim() && nameInput.trim() !== (localDisplayName ?? '')) {
                        await saveUnlinkedContactName(phone, nameInput.trim())
                        setLocalDisplayName(nameInput.trim())
                        router.refresh()
                      }
                      setEditingName(false)
                    }}
                    placeholder={phone}
                    className="rounded border border-[#1B556B] px-2 py-0.5 text-sm font-semibold focus:outline-none w-44"
                  />
                  <button type="submit" className="text-[#1B556B] text-xs font-semibold hover:underline">✓</button>
                  <button type="button" onClick={() => setEditingName(false)} className="text-gray-400 text-xs">✕</button>
                </form>
              ) : (
                <button
                  onClick={() => { setNameInput(localDisplayName ?? ''); setEditingName(true) }}
                  className="flex items-center gap-1.5 text-left hover:bg-gray-100 rounded px-1 -mx-1 py-0.5 transition-colors"
                >
                  <span className="text-sm font-semibold text-gray-900">
                    {localDisplayName ?? <span className="text-gray-400 italic font-normal text-xs">Sem nome — clique para editar</span>}
                  </span>
                  <span className="text-[10px] text-gray-300">✏️</span>
                </button>
              )}
              <p className="text-[10px] text-gray-400">{phone}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 justify-end">
            {leadId && (
              <span className="rounded-full px-2 py-0.5 text-[10px] font-medium bg-purple-100 text-purple-700">
                🎯 Lead
              </span>
            )}
            {availableInstances.length > 0 && (
              <select value={selectedInstance} onChange={e => setSelectedInstance(e.target.value)}
                className="rounded-full border border-[#1B556B]/30 bg-[#1B556B]/5 px-2 py-0.5 text-[10px] font-medium text-[#1B556B] focus:outline-none">
                {availableInstances.map(i => (
                  <option key={i.name} value={i.name}>📱 {i.label}</option>
                ))}
              </select>
            )}
            {assignment ? (
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <span className="rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-[10px] font-medium">
                  👤 {assignment.assigned_to === currentUserId ? 'Você' : assignment.assigned_to_name}
                </span>
                <div className="relative">
                  <button onClick={() => setShowAssignPicker(v => !v)}
                    className="rounded-full border border-gray-300 px-2 py-0.5 text-[10px] text-gray-500 hover:bg-gray-50">
                    🔄
                  </button>
                  {showAssignPicker && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setShowAssignPicker(false)} />
                      <div className="absolute right-0 top-6 z-20 min-w-[160px] rounded-md border border-gray-200 bg-white shadow-lg">
                      <p className="px-3 py-1.5 text-[10px] font-semibold text-gray-400 uppercase">Transferir para</p>
                      {users.filter(u => u.id !== assignment.assigned_to).map(u => (
                        <button key={u.id}
                          onClick={async () => { setShowAssignPicker(false); setBusy(true); await handleAssignTo(u.id); setBusy(false) }}
                          className="block w-full px-3 py-2 text-left text-xs hover:bg-gray-50">
                          {u.full_name}
                        </button>
                      ))}
                      <button onClick={async () => { setShowAssignPicker(false); setBusy(true); await handleUnassign(); setBusy(false) }}
                        className="block w-full border-t px-3 py-2 text-left text-xs text-red-500 hover:bg-red-50">
                        Liberar conversa
                      </button>
                    </div>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <button onClick={async () => { setBusy(true); await handleClaim(); setBusy(false) }}
                disabled={busy}
                className="rounded-full bg-[#1B556B] px-3 py-1 text-[10px] font-semibold text-white hover:bg-[#164659] disabled:opacity-50 flex-shrink-0">
                🙋‍♂️ Assumir
              </button>
            )}
          </div>
        </div>
          <div className="flex flex-wrap gap-2">
            {isArchived ? (
              <button
                onClick={async () => {
                  setBusy(true)
                  await unarchiveWhatsAppConversation(phone, instanceName ?? undefined)
                  setBusy(false)
                  setIsArchived(false)
                  router.push('/whatsapp')
                  router.refresh()
                }}
                disabled={busy}
                className="rounded-md border border-blue-200 px-2.5 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-50"
              >
                📤 Desarquivar
              </button>
            ) : (
            <>
            <button
              onClick={async () => {
                if (!confirm('Arquivar esta conversa? Ela sairá da lista sem enviar mensagem ao cliente.')) return
                setBusy(true)
                const result = await archiveWhatsAppConversation(phone, instanceName, false)
                setBusy(false)
                if (result?.error) { alert(`Erro: ${result.error}`); return }
                setIsArchived(true)
                onArchiveSuccess?.(phone)
                router.push('/whatsapp'); router.refresh()
              }}
              disabled={busy}
              className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              🗃️ Arquivar
            </button>
            {/* ── PONTO 4: Botão Finalizar → abre FinalizarNPSModal ── */}
            <button
              onClick={() => setShowNPSModal(true)}
              disabled={busy}
              className="rounded-md border border-green-200 px-2.5 py-1 text-xs font-medium text-green-700 hover:bg-green-50 disabled:opacity-50"
            >
              ✅ Finalizar
            </button>
            <button
              onClick={async () => {
                setBusy(true)
                const res = await fetch('/api/whatsapp/import-history', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ phone, instanceName: instanceName ?? undefined }),
                })
                const data = await res.json()
                setBusy(false)
                if (data.error) alert(`Erro: ${data.error}`)
                else { alert(`✅ ${data.imported} mensagens importadas!`); router.refresh() }
              }}
              disabled={busy}
              className="rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
            >
              📥 Importar histórico
            </button>
            <button
              onClick={async () => {
                if (!confirm('⚠️ Excluir TODA esta conversa? Isso remove todas as mensagens do banco. Não pode ser desfeito.')) return
                setBusy(true)
                await deleteWhatsAppConversation(phone)
                setBusy(false)
                router.push('/whatsapp')
                router.refresh()
              }}
              disabled={busy}
              className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-500 hover:bg-red-50 disabled:opacity-50"
            >
              🗑️ Excluir chat
            </button>
            <button
              onClick={async () => {
                if (!confirm(`Marcar ${phone} como opt-out? Esta pessoa não receberá mais mensagens automáticas.`)) return
                setBusy(true)
                await fetch('/api/whatsapp/optout', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ phone }),
                })
                setBusy(false)
              }}
              disabled={busy}
              className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              🚫 Opt-out
            </button>
            {leadId && (
              <>
                <Link href={`/leads/${leadId}`} className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">
                  Ver Lead completo
                </Link>
                <button onClick={() => setShowConvertModal(true)} disabled={busy}
                  className="rounded-md bg-positive-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-positive-700 disabled:opacity-50">
                  ✅ Converter em oportunidade
                </button>
              </>
            )}
            <button onClick={() => setShowLinkSearch((v) => !v)} className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">
              🔍 Vincular a conta existente
            </button>
            <button onClick={() => setShowConvertModal(true)}
              className="rounded-md border border-green-300 px-2.5 py-1 text-xs font-medium text-green-700 hover:bg-green-50">
              ➕ Criar oportunidade nova
            </button>
            </>
            )}
          </div>

        {showLinkSearch && (
          <div className="relative mt-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar conta pelo nome... (mín. 2 caracteres)"
              className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none"
              autoFocus
            />
            {query.length >= 2 && (
              <div className="absolute z-10 mt-1 w-full rounded-md border border-gray-200 bg-white shadow-md max-h-48 overflow-y-auto">
                {results.length > 0 ? results.map((r) => (
                  <button key={r.id} onClick={() => handleLink(r.id)} disabled={busy}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50 disabled:opacity-50 border-b border-gray-50 last:border-0">
                    {r.label}
                  </button>
                )) : (
                  <p className="px-3 py-2 text-xs text-gray-400">Nenhuma conta encontrada para "{query}"</p>
                )}
              </div>
            )}
          </div>
        )}
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <WhatsAppChatView messages={localMessages} contactName={displayName} contactPhone={phone} />
        <div ref={messagesEndRef} />
      </div>

      {isArchived ? (
        <div className="flex-shrink-0 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-center">
          <p className="text-sm text-gray-500">
            🔒 Atendimento finalizado. Se o cliente enviar uma nova mensagem, a conversa será reaberta automaticamente.
          </p>
          <button
            onClick={async () => {
              await unarchiveWhatsAppConversation(phone, instanceName ?? undefined)
              setIsArchived(false)
            }}
            className="mt-2 text-xs text-[#1B556B] hover:underline"
          >
            Reabrir conversa
          </button>
        </div>
      ) : (
        <div className="flex-shrink-0 space-y-2 rounded-lg border border-gray-200 bg-white p-3">

          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs text-gray-500 whitespace-nowrap">Responder via:</span>
            <select
              value={selectedInstance}
              onChange={e => setSelectedInstance(e.target.value)}
              className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-[#1B556B] focus:outline-none"
            >
              {availableInstances.length === 0 && (
                <option value={instanceName ?? ''}>{instanceName ?? 'Carregando...'}</option>
              )}
              {availableInstances.map(inst => (
                <option key={inst.name} value={inst.name}>{inst.label}</option>
              ))}
            </select>
          </div>

          <div className="flex items-end gap-2 bg-white rounded-md border border-gray-300 p-1 focus-within:border-[#1B556B]">

            <label className={`cursor-pointer p-2 rounded-full transition-colors self-end mb-[2px]
              ${selectedFileName ? 'text-[#1B556B] bg-[#1B556B]/10' : 'text-gray-500 hover:bg-gray-100'}`}
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

            <div className="flex-1 min-w-0 flex flex-col">
              {selectedFileName && (
                <div className="flex items-center justify-between bg-[#1B556B]/10 text-[#1B556B] text-xs px-2 py-1 rounded mb-1 mr-2 mt-1">
                  <span className="truncate flex-1">📎 {selectedFileName}</span>
                  <button
                    type="button"
                    onClick={() => {
                      if (fileInputRef.current) fileInputRef.current.value = ''
                      setSelectedFileName(null)
                    }}
                    className="ml-2 text-[#1B556B] hover:text-red-600 shrink-0 font-bold px-1"
                    title="Remover anexo">
                    ✕
                  </button>
                </div>
              )}

              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder={selectedFileName ? "Adicione uma legenda..." : "Responder..."}
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

            <button
              onClick={handleReply}
              disabled={busy || (!replyText.trim() && !selectedFileName)}
              className="p-2 mb-[2px] rounded-full bg-[#1B556B] text-white hover:bg-[#164659] disabled:opacity-50 disabled:bg-gray-300 disabled:text-gray-500 transition-colors shrink-0"
              title="Enviar mensagem">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                <path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" />
              </svg>
            </button>
          </div>

          {busy && <p className="text-xs text-[#1B556B] mt-1 text-right">Enviando... aguarde.</p>}

        </div>
      )}
      {showConvertModal && (
        <ConvertLeadModal phone={phone} leadId={leadId} displayName={localDisplayName} onClose={() => setShowConvertModal(false)} />
      )}
    </div>
  )
}
