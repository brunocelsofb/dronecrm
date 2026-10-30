'use client'

import { revealMessage } from '@/components/whatsapp/reveal-message'
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { LinkContactStep } from './link-contact-step'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { tenantStoragePath } from '@/lib/utils/storage'
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
import { ContactKindPicker } from '@/components/whatsapp/contact-kind-badge'
import { SaveNoteModal } from '@/components/whatsapp/save-note-modal'
import type { ContactKind } from '@/lib/whatsapp/contact-kind'
import { sendWhatsAppVoice, reactToWhatsAppMessage, markWhatsAppConversationRead, listQuickReplies, type QuickReply } from '@/lib/actions/whatsapp-chat'
import { applyReaction, slashQuery, matchQuickReplies, fillQuickReply, insertQuickReply, REVOKED_TYPE, revokedText } from '@/lib/whatsapp/chat'
import { EmojiPicker, useVoiceRecorder, mmss } from '@/components/whatsapp/composer-tools'
import { QuickRepliesModal } from '@/components/whatsapp/quick-replies-modal'
import { PhotoViewer } from '@/components/whatsapp/photo-viewer'

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
  zapi_message_id?: string | null
  quoted_id?: string | null
  reactions?: { me?: string; them?: string } | null
  instance_name?: string | null
}

// Texto curto de uma mensagem (barra "respondendo a…")
function previewOf(m: Message): string {
  if (m.media_type === 'audio') return '🎤 Áudio'
  if (m.media_type === 'image') return /^\[(imagem|Imagem)\]$/.test(m.message ?? '') ? '📷 Foto' : `📷 ${m.message}`
  if (m.media_type === 'video') return '🎥 Vídeo'
  if (m.media_type === 'document') return `📄 ${m.media_filename ?? 'Documento'}`
  return String(m.message ?? '').replace(/^\*[^*]{1,80}:\*\s*/, '')
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
  contactKind,
  onKindChange,
  links = [],
  onLinked,
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
  contactKind?: { kind: ContactKind; manual: boolean } | null
  onKindChange?: () => void
  links?: { contractId: string; label: string; number: string | null; companyName: string | null }[]
  onLinked?: () => void
}) {
  const router = useRouter()
  const supabase = createClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null)

  const [isArchived, setIsArchived] = useState(initialIsArchived ?? false)
  const [noteFor, setNoteFor] = useState<string | null>(null)
  const [profilePicUrl, setProfilePicUrl] = useState<string | null>(null)
  const [showPhoto, setShowPhoto] = useState(false)
  const [localMessages, setLocalMessages] = useState<Message[]>(messages)
  const processedIds = useRef(new Set<string>(messages.map(m => m.id)))
  // Sempre do passado para o presente (mensagens importadas ou atrasadas chegam fora de ordem)
  const orderedMessages = useMemo(
    () => [...localMessages].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
    [localMessages],
  )

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
        // Mídia entra na chave: dois áudios ou fotos no mesmo minuto não são a mesma mensagem
        const key = `${m.direction}:${m.message}:${m.media_url ?? ''}:${(m.created_at ?? '').slice(0, 16)}`
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
  const [linkTarget, setLinkTarget] = useState<string | null>(null)
  const [linkInfo, setLinkInfo] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ContractOption[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Responder citando, arquivo colado/arrastado, emojis, áudio e respostas rápidas
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [pendingPreview, setPendingPreview] = useState<string | null>(null)
  const [showEmoji, setShowEmoji] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const voice = useVoiceRecorder()
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([])
  const [showQuickModal, setShowQuickModal] = useState(false)
  const [slashIndex, setSlashIndex] = useState(0)
  const [slashClosed, setSlashClosed] = useState(false)
  const me = users.find(u => u.id === currentUserId)
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
    const channel = supabase
      .channel(`wpp-${phone}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'contract_crm',
        table: 'contract_whatsapp_messages',
        filter: `phone=eq.${phone}`,
      }, (payload) => {
        const newMsg = payload.new as Message
        // O texto vem cifrado do banco: abre antes de mostrar
        void revealMessage(newMsg).then(addMessageSafe)
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'contract_crm',
        table: 'contract_whatsapp_messages',
        filter: `phone=eq.${phone}`,
      }, (payload) => {
        // Tiques, reações e citação mudam sem recarregar (o texto não vem: está cifrado)
        const n = payload.new as Partial<Message>
        if (!n?.id) return
        // Apagada para todos: troca o conteúdo pelo aviso na hora
        if (n.media_type === REVOKED_TYPE) {
          setLocalMessages(prev => prev.map(m => m.id === n.id ? {
            ...m, media_type: REVOKED_TYPE, media_url: null, media_filename: null, reactions: {}, message: revokedText(m.direction),
          } : m))
          return
        }
        setLocalMessages(prev => prev.map(m => m.id === n.id ? {
          ...m,
          delivery_status: n.delivery_status ?? m.delivery_status,
          status: n.status ?? m.status,
          reactions: n.reactions ?? m.reactions,
          quoted_id: n.quoted_id ?? m.quoted_id,
          zapi_message_id: n.zapi_message_id ?? m.zapi_message_id,
        } : m))
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

  // Conversa aberta = lida (zera o contador e manda os tiques azuis ao contato)
  const readInstance = instanceName ?? null
  const inboundCount = useMemo(() => localMessages.filter(m => m.direction === 'recebido').length, [localMessages])
  const firstRead = useRef(true)
  useEffect(() => { firstRead.current = true }, [phone, readInstance])
  useEffect(() => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
    const t = setTimeout(() => {
      void markWhatsAppConversationRead(phone, readInstance).then(r => {
        if (r.ok && firstRead.current) { firstRead.current = false; router.refresh() }
      })
    }, firstRead.current ? 300 : 1500)
    return () => clearTimeout(t)
  }, [phone, readInstance, inboundCount, router])
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') void markWhatsAppConversationRead(phone, readInstance) }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [phone, readInstance])

  useEffect(() => { void listQuickReplies().then(setQuickReplies).catch(() => {}) }, [])

  // Prévia da foto colada/arrastada
  useEffect(() => {
    if (!pendingFile || !pendingFile.type.startsWith('image/')) { setPendingPreview(null); return }
    const url = URL.createObjectURL(pendingFile)
    setPendingPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [pendingFile])

  // Trocou de conversa: limpa o que estava sendo escrito para a anterior
  useEffect(() => { setReplyTo(null); setPendingFile(null); setShowEmoji(false) }, [phone])

  useEffect(() => {
    fetch(`/api/whatsapp/profile-pic?phone=${encodeURIComponent(phone)}${instanceName ? `&instance=${encodeURIComponent(instanceName)}` : ''}`)
      .then(r => r.json())
      .then(d => setProfilePicUrl(typeof d?.url === 'string' ? d.url : null))
      .catch(() => setProfilePicUrl(null))
  }, [phone, instanceName])

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

  function clearAttachment() {
    if (fileInputRef.current) fileInputRef.current.value = ''
    setPendingFile(null)
    setSelectedFileName(null)
  }

  function attachFile(file: File | null | undefined) {
    if (!file) return
    if (file.size > 60 * 1024 * 1024) { setError('Arquivo grande demais (máximo 60 MB).'); return }
    setPendingFile(file)
    setSelectedFileName(file.name || 'imagem-colada.png')
    setError(null)
    textareaRef.current?.focus()
  }

  async function uploadToStorage(file: Blob, name: string): Promise<string | null> {
    const safeName = name.replace(/[^a-zA-Z0-9.-]/g, '_')
    const storagePath = await tenantStoragePath(supabase, `whatsapp-media/central/${Date.now()}-${safeName}`)
    const { error: uploadError } = await supabase.storage.from('proposal-files').upload(storagePath, file, { contentType: file.type || undefined })
    if (uploadError) { setError(`Falha no upload: ${uploadError.message}`); return null }
    return `${window.location.origin}/api/email-assets/${storagePath}`
  }

  async function handleFileUpload() {
    const file = pendingFile ?? fileInputRef.current?.files?.[0]
    if (!file) return

    setBusy(true)
    setError(null)

    const fileName = file.name || `imagem-${Date.now()}.png`
    const publicUrl = await uploadToStorage(file, fileName)
    if (!publicUrl) { setBusy(false); return }
    const mediaType = file.type.startsWith('image/') ? 'image' : (file.type.startsWith('video/') ? 'video' : (file.type.startsWith('audio/') ? 'audio' : 'document'))

    // O texto digitado vai como legenda, e a citação junto
    const result = await sendUnlinkedWhatsAppMedia(phone, publicUrl, mediaType as any, fileName, selectedInstance || instanceName || undefined,
      { caption: replyText, quotedRowId: replyTo?.id ?? null })

    setBusy(false)
    if (result?.error) {
      setError(result.error)
    } else {
      clearAttachment()
      setReplyText('')
      setReplyTo(null)
      router.refresh()
    }
  }

  // Áudio gravado: sobe e manda como mensagem de voz
  async function handleSendVoice() {
    const clip = await voice.stop()
    if (!clip) { voice.setError('Áudio curto demais.'); return }
    setBusy(true); setError(null)
    const url = await uploadToStorage(clip.blob, `voz-${Date.now()}.${clip.ext}`)
    if (!url) { setBusy(false); return }
    const r = await sendWhatsAppVoice(phone, url, selectedInstance || instanceName || null, replyTo?.id ?? null)
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    setReplyTo(null)
    if (r.message) addMessageSafe(r.message as Message)
    router.refresh()
  }

  // Reação: aparece na hora; volta se o WhatsApp recusar
  async function handleReact(msg: Message, emoji: string) {
    const before = msg.reactions ?? {}
    setLocalMessages(prev => prev.map(m => m.id === msg.id ? { ...m, reactions: applyReaction(before, 'me', emoji) } : m))
    const r = await reactToWhatsAppMessage(msg.id, emoji)
    if (!r.ok) {
      setError(r.error)
      setLocalMessages(prev => prev.map(m => m.id === msg.id ? { ...m, reactions: before } : m))
    }
  }

  // Respostas rápidas: "/" no campo abre a lista
  const slash = slashClosed ? null : slashQuery(replyText)
  const slashMatches = slash === null ? [] : matchQuickReplies(quickReplies, slash)
  useEffect(() => { setSlashIndex(0) }, [slash])
  function pickQuickReply(q: QuickReply) {
    const text = fillQuickReply(q.body, { nome: localDisplayName, atendente: me?.full_name ?? null })
    setReplyText(t => insertQuickReply(t, text))
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (el) { el.focus(); el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 160) + 'px' }
    })
  }

  function insertEmoji(e: string) {
    const el = textareaRef.current
    if (!el) { setReplyText(t => t + e); return }
    const start = el.selectionStart ?? replyText.length, end = el.selectionEnd ?? replyText.length
    const next = replyText.slice(0, start) + e + replyText.slice(end)
    setReplyText(next)
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + e.length, start + e.length) })
  }

  function onComposerKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (slashMatches.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIndex(i => (i + 1) % slashMatches.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSlashIndex(i => (i - 1 + slashMatches.length) % slashMatches.length); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickQuickReply(slashMatches[Math.min(slashIndex, slashMatches.length - 1)]); return }
      if (e.key === 'Escape') { e.preventDefault(); setSlashClosed(true); return }
    }
    if (e.key === 'Escape' && replyTo) { setReplyTo(null); return }
    // Enter envia; Shift+Enter quebra a linha (como no WhatsApp Web)
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (!busy && (replyText.trim() || selectedFileName)) void handleReply()
    }
  }

  function onComposerPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const file = Array.from(e.clipboardData?.files ?? []).find(f => f.type.startsWith('image/'))
    if (file) { e.preventDefault(); attachFile(file) }
  }

  async function handleReply() {
    if (pendingFile || fileInputRef.current?.files?.[0]) {
      await handleFileUpload()
      return
    }

    if (!replyText.trim()) return

    const quoting = replyTo
    const optimistic: Message = {
      id: `opt-${Date.now()}`,
      phone, message: replyText, direction: 'enviado',
      status: 'enviado', triggered_automatically: false,
      error_message: null, created_at: new Date().toISOString(),
      media_url: null, media_type: null, media_filename: null,
      sender_photo_url: null, delivery_status: null,
      quoted_id: quoting?.zapi_message_id ?? null,
    }
    setLocalMessages(prev => [...prev, optimistic])
    setReplyText('')
    setReplyTo(null)
    setSlashClosed(false)

    const ta = textareaRef.current
    if (ta) ta.style.height = '34px'

    setBusy(true)
    const result = await sendUnlinkedWhatsAppMessage(phone, optimistic.message, selectedInstance || instanceName || undefined, { quotedRowId: quoting?.id ?? null })
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


  async function handleDeleteMessage(id: string) {
    // Remove optimisticamente do state local antes da confirmação do servidor
    setLocalMessages(prev => prev.filter(m => m.id !== id))
    try {
      await supabase
        .from('contract_whatsapp_messages')
        .delete()
        .eq('id', id)
    } catch (e) {
      console.error('[whatsapp] erro ao apagar mensagem:', e)
    }
  }

  return (
    // CORRECÇÃO: flex-1 min-w-0 overflow-hidden garantem que o painel não vaza sobre a sidebar
    <div className="flex flex-col w-full h-full min-w-0 min-h-0 overflow-hidden">
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {profilePicUrl ? (
              <img src={profilePicUrl} alt="Foto do contato" referrerPolicy="no-referrer" title="Ver foto" onClick={() => setShowPhoto(true)} className="h-9 w-9 cursor-zoom-in rounded-full object-cover flex-shrink-0 hover:ring-2 hover:ring-brand-700/30"
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
              {links.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {links.map(l => (
                    <Link key={l.contractId} href={`/contracts/${l.contractId}`} title="Abrir a oportunidade"
                      className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-medium text-brand-700 hover:underline">
                      🔗 {l.label}{l.number ? ` · ${l.number}` : ''}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 justify-end">
            {contactKind && (
              <ContactKindPicker key={phone} phone={phone} kind={contactKind.kind} manual={contactKind.manual} onChange={() => onKindChange?.()} />
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
                const data = await res.json().catch(() => ({ error: 'Resposta inválida do servidor.' }))
                setBusy(false)
                if (data.error) alert(`Erro: ${data.error}`)
                else if (!data.found) alert(data.message ?? 'Nenhuma mensagem encontrada.')
                else { alert(`Encontradas ${data.found} mensagens: ${data.imported} novas importadas, ${data.existing} já estavam no CRM.`); router.refresh() }
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
                  <button key={r.id} onClick={() => { setLinkTarget(r.id); setQuery('') }} disabled={busy}
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
        {linkTarget && (
          <LinkContactStep
            phone={phone}
            contractId={linkTarget}
            suggestedName={localDisplayName}
            onCancel={() => setLinkTarget(null)}
            onDone={(msg) => {
              setLinkTarget(null); setShowLinkSearch(false); setLinkInfo(msg)
              onLinked?.(); router.refresh()
            }}
          />
        )}
        {linkInfo && <p className="mt-2 text-xs text-positive-700">✓ {linkInfo}</p>}
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </div>

      {/* Área do chat — fosso com padding + borda arredondada contém o fundo bege e a scrollbar */}
      <div className="flex-1 min-h-0 min-w-0 overflow-hidden relative bg-gray-50 p-2 lg:p-3">
        <div className="w-full h-full relative rounded-xl overflow-hidden border border-gray-200 shadow-inner">
          <WhatsAppChatView
            messages={orderedMessages}
            contactName={displayName}
            contactPhone={phone}
            onDeleteMessage={handleDeleteMessage}
            onSaveNote={(id: string) => setNoteFor(id)}
            onReply={isArchived ? undefined : (m: Message) => { setReplyTo(m); textareaRef.current?.focus() }}
            onReact={handleReact}
          />
        </div>
      </div>

      {isArchived ? (
        <div className="flex-shrink-0 border-t border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-amber-800 font-medium">
              🔒 Atendimento arquivado/finalizado — respostas do cliente reabrirão automaticamente.
            </p>
            <button
              onClick={async () => {
                setBusy(true)
                await unarchiveWhatsAppConversation(phone, instanceName ?? undefined)
                setBusy(false)
                setIsArchived(false)
                router.refresh()
              }}
              disabled={busy}
              className="flex-shrink-0 rounded-md border border-amber-400 bg-white px-3 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
            >
              📤 Desarquivar
            </button>
          </div>
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

          {/* Respondendo a… (citação) */}
          {replyTo && (
            <div className="flex items-stretch gap-2 rounded-md bg-gray-50 p-1.5">
              <div className={`min-w-0 flex-1 rounded border-l-4 px-2 py-1 ${replyTo.direction === 'enviado' ? 'border-positive-600' : 'border-brand-700'}`}>
                <p className={`text-[11px] font-semibold ${replyTo.direction === 'enviado' ? 'text-positive-700' : 'text-brand-700'}`}>
                  Respondendo a {replyTo.direction === 'enviado' ? 'você' : (localDisplayName || 'contato')}
                </p>
                <p className="truncate text-xs text-gray-600">{previewOf(replyTo)}</p>
              </div>
              <button type="button" onClick={() => setReplyTo(null)} className="px-2 text-gray-400 hover:text-gray-700" aria-label="Cancelar resposta" title="Cancelar (Esc)">✕</button>
            </div>
          )}

          {/* Respostas rápidas ("/") */}
          {slashMatches.length > 0 && (
            <div role="listbox" aria-label="Respostas rápidas" className="max-h-52 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-md">
              {slashMatches.map((q, i) => (
                <button key={q.id} type="button" role="option" aria-selected={i === slashIndex}
                  onMouseDown={e => { e.preventDefault(); pickQuickReply(q) }}
                  onMouseEnter={() => setSlashIndex(i)}
                  className={`block w-full px-3 py-1.5 text-left ${i === slashIndex ? 'bg-brand-50' : 'hover:bg-gray-50'}`}>
                  <span className="text-xs font-semibold text-brand-700">/{q.shortcut}</span>
                  <span className="ml-2 line-clamp-1 text-xs text-gray-600">{q.body}</span>
                </button>
              ))}
            </div>
          )}
          {slash !== null && !slashMatches.length && (
            <p className="px-1 text-[11px] text-gray-400">
              {quickReplies.length ? 'Nenhuma resposta rápida com esse atalho.' : 'Nenhuma resposta rápida ainda.'}{' '}
              <button type="button" onClick={() => setShowQuickModal(true)} className="font-medium text-brand-700 hover:underline">Criar</button>
            </p>
          )}

          <div
            className={`relative flex items-end gap-1 bg-white rounded-md border p-1 focus-within:border-[#1B556B] ${dragOver ? 'border-dashed border-[#1B556B] bg-[#1B556B]/5' : 'border-gray-300'}`}
            onDragOver={e => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setDragOver(true) } }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); attachFile(e.dataTransfer?.files?.[0]) }}
          >
            {voice.recording ? (
              <div className="flex flex-1 items-center gap-3 px-2 py-1.5">
                <button type="button" onClick={() => voice.cancel()} className="rounded-full p-2 text-gray-500 hover:bg-red-50 hover:text-red-600" title="Descartar áudio" aria-label="Descartar áudio">🗑</button>
                <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" aria-hidden="true" />
                <span className="font-mono text-sm text-gray-700" aria-live="polite">{mmss(voice.seconds)}</span>
                <span className="flex-1 text-xs text-gray-400">Gravando…</span>
                <button type="button" onClick={handleSendVoice} disabled={busy}
                  className="rounded-full bg-[#1B556B] p-2 text-white hover:bg-[#164659] disabled:opacity-50" title="Enviar áudio" aria-label="Enviar áudio">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" /></svg>
                </button>
              </div>
            ) : (
            <>
            <div className="relative self-end mb-[2px]">
              <button type="button" onClick={() => setShowEmoji(v => !v)}
                className={`p-2 rounded-full transition-colors ${showEmoji ? 'text-[#1B556B] bg-[#1B556B]/10' : 'text-gray-500 hover:bg-gray-100'}`}
                title="Emojis" aria-label="Emojis" aria-expanded={showEmoji}>
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M15.182 15.182a4.5 4.5 0 0 1-6.364 0M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75Zm-.375 0h.008v.015h-.008V9.75Zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75Zm-.375 0h.008v.015h-.008V9.75Z" /></svg>
              </button>
              {showEmoji && <EmojiPicker onPick={insertEmoji} onClose={() => setShowEmoji(false)} />}
            </div>

            <label className={`cursor-pointer p-2 rounded-full transition-colors self-end mb-[2px]
              ${selectedFileName ? 'text-[#1B556B] bg-[#1B556B]/10' : 'text-gray-500 hover:bg-gray-100'}`}
              title="Anexar arquivo (ou cole/arraste uma imagem)">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 transform -rotate-45">
                <path strokeLinecap="round" strokeLinejoin="round" d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13" />
              </svg>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept="image/*, video/*, audio/*, application/pdf, .doc, .docx, .xls, .xlsx"
                onChange={(e) => {
                  if (e.target.files?.[0]) attachFile(e.target.files[0])
                  else clearAttachment()
                }}
              />
            </label>

            <button type="button" onClick={() => setShowQuickModal(true)}
              className="p-2 mb-[2px] self-end rounded-full text-gray-500 hover:bg-gray-100" title="Respostas rápidas (digite / no campo)" aria-label="Respostas rápidas">
              ⚡
            </button>

            <div className="flex-1 min-w-0 flex flex-col">
              {selectedFileName && (
                <div className="flex items-center gap-2 bg-[#1B556B]/10 text-[#1B556B] text-xs px-2 py-1 rounded mb-1 mr-2 mt-1">
                  {pendingPreview && <img src={pendingPreview} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />}
                  <span className="truncate flex-1">📎 {selectedFileName}</span>
                  <button
                    type="button"
                    onClick={clearAttachment}
                    className="ml-2 text-[#1B556B] hover:text-red-600 shrink-0 font-bold px-1"
                    title="Remover anexo">
                    ✕
                  </button>
                </div>
              )}

              <textarea
                ref={textareaRef}
                value={replyText}
                onChange={(e) => { setReplyText(e.target.value); setSlashClosed(false) }}
                onKeyDown={onComposerKeyDown}
                onPaste={onComposerPaste}
                placeholder={selectedFileName ? "Adicione uma legenda..." : "Digite uma mensagem (/ para respostas rápidas)"}
                aria-label="Mensagem"
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

            {!replyText.trim() && !selectedFileName ? (
              <button
                type="button"
                onClick={() => void voice.start()}
                disabled={busy}
                className="p-2 mb-[2px] rounded-full bg-[#1B556B] text-white hover:bg-[#164659] disabled:opacity-50 transition-colors shrink-0"
                title="Gravar áudio" aria-label="Gravar áudio">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path d="M8.25 4.5a3.75 3.75 0 1 1 7.5 0v8.25a3.75 3.75 0 1 1-7.5 0V4.5Z" /><path d="M6 10.5a.75.75 0 0 1 .75.75v1.5a5.25 5.25 0 1 0 10.5 0v-1.5a.75.75 0 0 1 1.5 0v1.5a6.751 6.751 0 0 1-6 6.709v2.291h3a.75.75 0 0 1 0 1.5h-7.5a.75.75 0 0 1 0-1.5h3v-2.291a6.751 6.751 0 0 1-6-6.709v-1.5A.75.75 0 0 1 6 10.5Z" /></svg>
              </button>
            ) : (
            <button
              onClick={handleReply}
              disabled={busy || (!replyText.trim() && !selectedFileName)}
              className="p-2 mb-[2px] rounded-full bg-[#1B556B] text-white hover:bg-[#164659] disabled:opacity-50 disabled:bg-gray-300 disabled:text-gray-500 transition-colors shrink-0"
              title="Enviar mensagem (Enter)">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                <path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" />
              </svg>
            </button>
            )}
            </>
            )}
          </div>
          {voice.error && <p className="text-xs text-red-600">{voice.error}</p>}
          <p className="hidden text-[10px] text-gray-400 md:block">Enter envia · Shift+Enter quebra a linha · cole ou arraste imagens · / abre as respostas rápidas</p>

          {busy && <p className="text-xs text-[#1B556B] mt-1 text-right">Enviando... aguarde.</p>}

        </div>
      )}
      {showConvertModal && (
        <ConvertLeadModal phone={phone} leadId={leadId} displayName={localDisplayName} onClose={() => setShowConvertModal(false)} />
      )}
      {showPhoto && profilePicUrl && (
        <PhotoViewer url={profilePicUrl} name={localDisplayName} phone={phone} onClose={() => setShowPhoto(false)} />
      )}
      {showQuickModal && (
        <QuickRepliesModal replies={quickReplies} onChange={setQuickReplies} onClose={() => setShowQuickModal(false)} />
      )}
      {noteFor && (
        <SaveNoteModal phone={phone} messages={orderedMessages as any} initialId={noteFor} onClose={() => setNoteFor(null)} />
      )}
    </div>
  )
}
