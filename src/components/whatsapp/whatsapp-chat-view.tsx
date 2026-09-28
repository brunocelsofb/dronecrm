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

function MediaContent({ mediaType, mediaUrl, mediaFilename, message }: {
  mediaType?: string | null
  mediaUrl?: string | null
  mediaFilename?: string | null
  message: string
}) {
  if (mediaType === 'image' && mediaUrl) {
    return (
      <div className="flex flex-col gap-1">
        <img src={mediaUrl} alt="Imagem" className="max-w-[220px] rounded-lg object-cover" loading="lazy" />
        {message && message !== '[Imagem]' && <span className="text-sm">{message}</span>}
      </div>
    )
  }
  if (mediaType === 'audio') {
    return mediaUrl ? (
      <audio controls className="max-w-[220px]">
        <source src={mediaUrl} />
        {message}
      </audio>
    ) : <span className="text-sm italic">{message}</span>
  }
  if (mediaType === 'video' && mediaUrl) {
    return (
      <video controls className="max-w-[220px] rounded-lg">
        <source src={mediaUrl} />
      </video>
    )
  }
  if (mediaType === 'document') {
    return mediaUrl ? (
      <a href={mediaUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm underline">
        <span>📎</span>
        <span>{mediaFilename ?? message}</span>
      </a>
    ) : <span className="text-sm italic">{message}</span>
  }
  return <span className="text-sm whitespace-pre-wrap break-words">{message}</span>
}

export function WhatsAppChatView({ messages, onDeleteMessage }: WhatsAppChatViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Mantemos apenas a rolagem estrita dentro do container (sem forçar a página)
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [messages])

  if (!messages || messages.length === 0) {
    return (
      <div className="absolute inset-0 flex flex-col bg-[#E5DDD5] items-center justify-center z-0">
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
    <div 
      ref={containerRef}
      className="absolute inset-0 flex flex-col bg-[#E5DDD5] overflow-x-hidden overflow-y-auto p-4 space-y-3 z-0"
    >
      {grouped.map((group) => (
        <div key={group.dateKey}>
          <div className="flex items-center justify-center my-3 z-10 relative">
            <span className="bg-[#e1f3fb] text-[#54656f] text-[11px] font-medium px-3 py-1 rounded-full shadow-sm">
              {group.dateLabel}
            </span>
          </div>

          {group.messages.map((msg) => {
            const isSent = msg.direction === 'enviado'
            const isBot = msg.triggered_automatically === true

            return (
              <div key={msg.id} className={`flex mb-1.5 z-10 relative ${isSent ? 'justify-end' : 'justify-start'}`}>
                <div className={`group relative max-w-[75%] rounded-lg px-3 py-2 shadow-sm ${isSent ? 'bg-[#dcf8c6] text-gray-900 rounded-tr-none' : 'bg-white text-gray-900 rounded-tl-none'}`}>
                  {isBot && (
                    <div className="mb-1 flex items-center gap-1">
                      <span className="text-[10px] font-semibold text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded">🤖 Bot</span>
                    </div>
                  )}
                  <MediaContent mediaType={msg.media_type} mediaUrl={msg.media_url} mediaFilename={msg.media_filename} message={msg.message} />
                  <div className="mt-1 flex items-center justify-end gap-1">
                    <span className="text-[10px] text-gray-400">{formatTime(msg.created_at)}</span>
                    <DeliveryTick status={msg.status} direction={msg.direction} />
                    {onDeleteMessage && (
                      <button onClick={() => onDeleteMessage(msg.id)} className="ml-1 hidden group-hover:inline-flex text-[10px] text-red-400 hover:text-red-600 transition-colors" title="Deletar mensagem">✕</button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ))}
      {/* Margem extra para não colar no rodapé */}
      <div className="h-4 flex-shrink-0" />
    </div>
  )
}
