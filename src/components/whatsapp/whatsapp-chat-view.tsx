'use client'

import { useRef, useEffect } from 'react'

interface Message {
  id: string
  phone: string
  message: string
  direction: 'enviado' | 'recebido' | string
  status?: string | null
  created_at: string
  triggered_automatically?: boolean | null
  media_type?: string | null
  media_url?: string | null
  media_filename?: string | null
  zapi_message_id?: string | null
  sender_photo_url?: string | null
  delivery_status?: string | null
  unlinked_sender_name?: string | null
}

interface WhatsAppChatViewProps {
  messages: Message[] | any[]
  contactName?: string | null
  contactPhone?: string | null
  onDeleteMessage?: (messageId: string) => void
}

// Labels automáticos que não devem aparecer como texto debaixo da mídia
const MEDIA_PLACEHOLDER_LABELS = new Set([
  '[Imagem]', '[Áudio]', '[Vídeo]', '[Documento]', '[Figurinha]',
])

// ─── Contact Card ─────────────────────────────────────────────────────────────
// Parseado a partir de: "[Contato] Nome | telefone"  ou  "[Contato] Nome"
// Suporta múltiplos contactos separados por "; "
function parseContactEntries(message: string): Array<{ name: string; phone: string | null }> {
  // Remove o prefixo "[Contato] " ou "[Contatos] "
  const body = message.replace(/^\[Contatos?\]\s*/i, '')
  return body.split(';').map(entry => {
    const [namePart, phonePart] = entry.split('|').map(s => s.trim())
    return { name: namePart || 'Contato', phone: phonePart ?? null }
  })
}

function ContactCard({ message, isSent }: { message: string; isSent: boolean }) {
  const entries = parseContactEntries(message)

  return (
    <div className="flex flex-col gap-2 min-w-[200px]">
      {entries.map((entry, idx) => (
        <div
          key={idx}
          className={`
            flex items-center gap-3 rounded-xl px-3 py-2.5
            ${isSent ? 'bg-[#c5e8a8]' : 'bg-gray-50'}
            border ${isSent ? 'border-[#b0d890]' : 'border-gray-200'}
          `}
        >
          {/* Avatar */}
          <div className="shrink-0 w-10 h-10 rounded-full bg-[#1B556B] flex items-center justify-center shadow-sm">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" className="w-5 h-5">
              <path fillRule="evenodd" d="M7.5 6a4.5 4.5 0 1 1 9 0 4.5 4.5 0 0 1-9 0ZM3.751 20.105a8.25 8.25 0 0 1 16.498 0 .75.75 0 0 1-.437.695A18.683 18.683 0 0 1 12 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 0 1-.437-.695Z" clipRule="evenodd" />
            </svg>
          </div>

          {/* Info */}
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-semibold text-gray-900 leading-tight truncate">
              {entry.name}
            </span>
            {entry.phone && (
              <span className="text-xs text-gray-500 font-mono mt-0.5">
                +{entry.phone}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
// ─────────────────────────────────────────────────────────────────────────────

function formatTime(dateStr: string) {
  try {
    return new Date(dateStr).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

function formatDateLabel(dateStr: string) {
  try {
    const date = new Date(dateStr)
    const today = new Date()
    const yesterday = new Date()
    yesterday.setDate(today.getDate() - 1)

    if (date.toDateString() === today.toDateString()) return 'Hoje'
    if (date.toDateString() === yesterday.toDateString()) return 'Ontem'
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch {
    return ''
  }
}

function getDateKey(dateStr: string) {
  try {
    return new Date(dateStr).toDateString()
  } catch {
    return dateStr
  }
}

function DeliveryTick({ status, direction }: { status?: string | null; direction: string }) {
  if (direction !== 'enviado') return null
  if (status === 'lido' || status === 'read') {
    return <span className="ml-1 text-[10px] text-blue-400">✓✓</span>
  }
  if (status === 'entregue' || status === 'delivered') {
    return <span className="ml-1 text-[10px] text-gray-400">✓✓</span>
  }
  return <span className="ml-1 text-[10px] text-gray-400">✓</span>
}

// ─── NOVO: Função para formatar links ──────────────────────────────────
function formatMessageWithLinks(text: string) {
  if (!text) return null
  // Regex para identificar URLs que começam com http ou https
  const urlRegex = /(https?:\/\/[^\s]+)/g
  const parts = text.split(urlRegex)

  return (
    <>
      {parts.map((part, i) => {
        if (part.match(urlRegex)) {
          return (
            <a
              key={i}
              href={part}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 hover:text-blue-700 underline break-words"
            >
              {part}
            </a>
          )
        }
        return <span key={i}>{part}</span>
      })}
    </>
  )
}
// ────────────────────────────────────────────────────────────────────────

function MediaContent({ mediaType, mediaUrl, mediaFilename, message, isSent }: {
  mediaType?: string | null
  mediaUrl?: string | null
  mediaFilename?: string | null
  message: string
  isSent: boolean
}) {
  const hasRealCaption = message && !MEDIA_PLACEHOLDER_LABELS.has(message)

  // ── Contact Card — também cobre mensagens antigas sem media_type ─────────
  const isContact =
    mediaType === 'contact' ||
    message?.startsWith('[Contato]') ||
    message?.startsWith('[Contatos]')
  if (isContact) {
    return <ContactCard message={message} isSent={isSent} />
  }
  // ─────────────────────────────────────────────────────────────────────────

  // ── Chamada perdida ───────────────────────────────────────────────────────
  if (mediaType === 'call') {
    const isVideo = message?.includes('Vídeo') || message?.includes('video')
    return (
      <div className="flex items-center gap-2 text-sm text-gray-600">
        <span className="text-base">{isVideo ? '📹' : '📞'}</span>
        <span className="italic">{message}</span>
      </div>
    )
  }
  // ─────────────────────────────────────────────────────────────────────────

  if (mediaType === 'image' && mediaUrl) {
    return (
      <div className="flex flex-col gap-1">
        <img
          src={mediaUrl}
          alt="Imagem"
          className="max-w-[220px] rounded-lg object-cover"
          loading="lazy"
        />
        {hasRealCaption && (
          <span className="text-sm whitespace-pre-wrap break-words">{formatMessageWithLinks(message)}</span>
        )}
      </div>
    )
  }
  if (mediaType === 'audio') {
    return mediaUrl ? (
      <audio controls className="max-w-[220px]">
        <source src={mediaUrl} />
      </audio>
    ) : <span className="text-sm italic">{message}</span>
  }
  if (mediaType === 'video' && mediaUrl) {
    return (
      <div className="flex flex-col gap-1">
        <video controls className="max-w-[220px] rounded-lg">
          <source src={mediaUrl} />
        </video>
        {hasRealCaption && (
          <span className="text-sm whitespace-pre-wrap break-words">{formatMessageWithLinks(message)}</span>
        )}
      </div>
    )
  }
  if (mediaType === 'document') {
    return mediaUrl ? (
      <a
        href={mediaUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 text-sm text-blue-600 hover:underline break-words"
      >
        <span>📎</span>
        <span>{mediaFilename ?? (hasRealCaption ? message : 'Documento')}</span>
      </a>
    ) : <span className="text-sm italic">{mediaFilename ?? message}</span>
  }
  return <span className="text-sm whitespace-pre-wrap break-words">{formatMessageWithLinks(message)}</span>
}

function TrashIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      className="w-3 h-3"
    >
      <path
        fillRule="evenodd"
        d="M5 3.25V4H2.75a.75.75 0 0 0 0 1.5h.3l.815 6.518A2.25 2.25 0 0 0 6.108 14h3.784a2.25 2.25 0 0 0 2.243-1.982L12.95 5.5h.3a.75.75 0 0 0 0-1.5H11v-.75A2.25 2.25 0 0 0 8.75 1h-1.5A2.25 2.25 0 0 0 5 3.25Zm2.25-.75a.75.75 0 0 0-.75.75V4h3v-.75a.75.75 0 0 0-.75-.75h-1.5ZM6.05 6a.75.75 0 0 1 .787.713l.275 5.5a.75.75 0 0 1-1.498.075l-.275-5.5A.75.75 0 0 1 6.05 6Zm3.9 0a.75.75 0 0 1 .712.787l-.275 5.5a.75.75 0 0 1-1.498-.075l.275-5.5A.75.75 0 0 1 9.95 6Z"
        clipRule="evenodd"
      />
    </svg>
  )
}

export function WhatsAppChatView({ messages, onDeleteMessage }: WhatsAppChatViewProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  if (!messages || messages.length === 0) {
    return (
      <div className="absolute inset-0 bg-[#E5DDD5] flex items-center justify-center">
        <p className="text-sm text-gray-500">Nenhuma mensagem ainda.</p>
      </div>
    )
  }

  const grouped: { dateKey: string; dateLabel: string; messages: any[] }[] = []
  for (const msg of messages) {
    const dk = getDateKey(msg.created_at)
    const last = grouped[grouped.length - 1]
    if (last && last.dateKey === dk) {
      last.messages.push(msg)
    } else {
      grouped.push({ dateKey: dk, dateLabel: formatDateLabel(msg.created_at), messages: [msg] })
    }
  }

  return (
    <div className="absolute inset-0 bg-[#E5DDD5] overflow-y-auto p-4 space-y-3">
      {grouped.map((group) => (
        <div key={group.dateKey}>
          <div className="flex items-center justify-center my-3">
            <span className="bg-[#e1f3fb] text-[#54656f] text-[11px] font-medium px-3 py-1 rounded-full shadow-sm">
              {group.dateLabel}
            </span>
          </div>

          {group.messages.map((msg) => {
            const isSent = msg.direction === 'enviado'
            const isBot = msg.triggered_automatically === true

            return (
              <div
                key={msg.id}
                className={`flex mb-1.5 ${isSent ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`
                    group relative max-w-[75%] rounded-lg px-3 py-2 shadow-sm
                    ${isSent
                      ? 'bg-[#dcf8c6] text-gray-900 rounded-tr-none'
                      : 'bg-white text-gray-900 rounded-tl-none'
                    }
                  `}
                >
                  {isBot && (
                    <div className="mb-1 flex items-center gap-1">
                      <span className="text-[10px] font-semibold text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded">
                        🤖 Bot
                      </span>
                    </div>
                  )}

                  <MediaContent
                    mediaType={msg.media_type}
                    mediaUrl={msg.media_url}
                    mediaFilename={msg.media_filename}
                    message={msg.message}
                    isSent={isSent}
                  />

                  <div className="mt-1 flex items-center justify-end gap-1">
                    <span className="text-[10px] text-gray-400">
                      {formatTime(msg.created_at)}
                    </span>
                    <DeliveryTick status={msg.status} direction={msg.direction} />

                    {onDeleteMessage && (
                      <button
                        onClick={() => onDeleteMessage(msg.id)}
                        className="
                          ml-1 p-0.5 rounded
                          opacity-0 group-hover:opacity-100
                          text-gray-400 hover:text-red-500 hover:bg-red-50
                          transition-all duration-150
                        "
                        title="Apagar mensagem"
                        aria-label="Apagar mensagem"
                      >
                        <TrashIcon />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
