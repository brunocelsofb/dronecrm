'use client'

import { useRef, useEffect, useState, useMemo } from 'react'
import { QUICK_REACTIONS } from '@/lib/whatsapp/chat'

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
  quoted_id?: string | null
  reactions?: { me?: string; them?: string } | null
  error_message?: string | null
}

interface WhatsAppChatViewProps {
  messages: Message[] | any[]
  contactName?: string | null
  contactPhone?: string | null
  onDeleteMessage?: (messageId: string) => void
  onSaveNote?: (messageId: string) => void
  // Opcionais (Central de WhatsApp): responder citando e reagir
  onReply?: (msg: any) => void
  onReact?: (msg: any, emoji: string) => void
}

// Labels automáticos que não devem aparecer como texto debaixo da mídia
const MEDIA_PLACEHOLDER_LABELS = new Set([
  '[Imagem]', '[Áudio]', '[Vídeo]', '[Documento]', '[Figurinha]', '[Contato]', '[Localização]', '[Localização ao vivo]'
])

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

function DeliveryTick({ status, direction, error }: { status?: string | null; direction: string; error?: string | null }) {
  if (direction !== 'enviado') return null
  if (status === 'falhou') {
    return <span className="ml-1 text-[10px] font-bold text-red-500" title={error ? `Não enviada: ${error}` : 'Não enviada'}>⚠</span>
  }
  if (status === 'lido' || status === 'read') {
    return <span className="ml-1 text-[10px] text-blue-400">✓✓</span>
  }
  if (status === 'entregue' || status === 'delivered') {
    return <span className="ml-1 text-[10px] text-gray-400">✓✓</span>
  }
  return <span className="ml-1 text-[10px] text-gray-400">✓</span>
}

function formatMessageWithLinks(text: string) {
  if (!text) return null
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

function MediaContent({ mediaType, mediaUrl, mediaFilename, message }: {
  mediaType?: string | null
  mediaUrl?: string | null
  mediaFilename?: string | null
  message: string
}) {
  const [isZoomed, setIsZoomed] = useState(false)
  const hasRealCaption = message && !MEDIA_PLACEHOLDER_LABELS.has(message)

  // ─── RENDERIZAÇÃO DA CHAMADA (LIGAÇÃO) ───────────────────────────────────
  const isCall = mediaType === 'call' || message?.startsWith('📞') || message?.startsWith('📹')
  if (isCall) {
    const isVideo = message?.includes('Vídeo') || message?.startsWith('📹')
    return (
      <div className="flex items-center gap-3 bg-red-50/80 p-3 rounded-md border border-red-100 mt-1 shadow-sm w-[220px]">
        <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0 text-red-500">
          <span className="text-xl">{isVideo ? '📹' : '📞'}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-red-700 leading-tight">Chamada Perdida</span>
          <span className="text-xs text-red-500">{isVideo ? 'Vídeo' : 'Voz'}</span>
        </div>
      </div>
    )
  }

  // ─── RENDERIZAÇÃO DO CARTÃO DE CONTACTO (C/ RETROCOMPATIBILIDADE) ─────────
  const isContact = mediaType === 'contact' || message?.startsWith('[Contato]') || message?.startsWith('[Contatos]')
  if (isContact) {
    let name = 'Contato'
    let phone = ''
    const rawText = (message || '').replace(/^\[Contatos?\]\s*/i, '')
    
    if (rawText.includes('|')) {
      const parts = rawText.split('|')
      name = parts[0].trim()
      phone = parts.slice(1).join('|').trim()
    } else {
      name = rawText.trim() || 'Contato'
    }

    return (
      <div className="flex flex-col w-[240px] bg-white/60 rounded-md border border-gray-200/70 overflow-hidden mt-1 shadow-sm">
        <div className="flex items-center gap-3 p-3">
          <div className="w-10 h-10 rounded-full bg-[#1B556B] flex items-center justify-center shrink-0 text-white">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
            </svg>
          </div>
          <div className="flex flex-col overflow-hidden">
            <span className="text-sm font-semibold text-gray-900 truncate">{name}</span>
            {phone && <span className="text-xs text-gray-500 font-mono truncate">{phone}</span>}
          </div>
        </div>
        {phone && (
          <div className="border-t border-gray-200/70 p-2 text-center bg-gray-50/50 hover:bg-gray-100 transition-colors">
            <a 
              href={`https://wa.me/${phone.replace(/\D/g,'')}`} 
              target="_blank" 
              rel="noopener noreferrer" 
              className="text-[13px] text-[#1B556B] font-semibold block w-full"
            >
              Conversar
            </a>
          </div>
        )}
      </div>
    )
  }

  // ─── RENDERIZAÇÃO DA LOCALIZAÇÃO ─────────────────────────────────────────
  const isLocation = mediaType === 'location' || message?.startsWith('[Localização')
  if (isLocation) {
    const locName = message.replace(/\[.*?\]\s*/, '') || 'Localização'
    return (
      <div className="flex items-center gap-2 text-sm text-blue-600 bg-white/50 p-2 rounded-md border border-gray-200/60 mt-1 shadow-sm">
        <span className="text-lg">📍</span>
        <a 
          href={`https://maps.google.com/?q=${encodeURIComponent(locName)}`} 
          target="_blank" 
          rel="noopener noreferrer" 
          className="hover:underline font-medium break-words"
        >
          {locName}
        </a>
      </div>
    )
  }

  // ─── RENDERIZAÇÃO DE IMAGEM COM ZOOM (NOVO) ────────────────────────────
  if (mediaType === 'image' && mediaUrl) {
    return (
      <>
        <div className="flex flex-col gap-1">
          <img
            src={mediaUrl}
            alt="Imagem"
            className="max-w-[220px] rounded-lg object-cover cursor-pointer hover:opacity-90 transition-opacity"
            loading="lazy"
            onClick={() => setIsZoomed(true)}
            title="Clique para ampliar"
          />
          {hasRealCaption && (
            <span className="text-sm whitespace-pre-wrap break-words">{formatMessageWithLinks(message)}</span>
          )}
        </div>

        {/* Modal de Zoom */}
        {isZoomed && (
          <div 
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 cursor-zoom-out"
            onClick={() => setIsZoomed(false)}
          >
            <img
              src={mediaUrl}
              alt="Imagem Ampliada"
              className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
            />
            <button 
              className="absolute top-6 right-6 text-white hover:text-gray-300 bg-white/10 hover:bg-white/20 rounded-full p-2 transition-colors"
              onClick={(e) => { e.stopPropagation(); setIsZoomed(false) }}
              title="Fechar zoom"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
              </svg>
            </button>
          </div>
        )}
      </>
    )
  }

  // ─── RENDERIZAÇÃO PADRÃO (ÁUDIO, VÍDEO, DOCUMENTO) ───────────────────────
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
    // Legenda de verdade (não o rótulo automático "[document] arquivo.pdf")
    const docCaption = hasRealCaption && mediaFilename && message !== mediaFilename && !/^\[(document|documento|video|audio|imagem|image)\]/i.test(message) ? message : null
    return mediaUrl ? (
      <div className="flex flex-col gap-1">
        <a
          href={mediaUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-sm text-blue-600 hover:underline break-words"
        >
          <span>📎</span>
          <span>{mediaFilename ?? (hasRealCaption ? message : 'Documento')}</span>
        </a>
        {docCaption && <span className="text-sm whitespace-pre-wrap break-words">{formatMessageWithLinks(docCaption)}</span>}
      </div>
    ) : <span className="text-sm italic">{mediaFilename ?? message}</span>
  }
  return <span className="text-sm whitespace-pre-wrap break-words">{formatMessageWithLinks(message)}</span>
}

function TrashIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
      <path fillRule="evenodd" d="M5 3.25V4H2.75a.75.75 0 0 0 0 1.5h.3l.815 6.518A2.25 2.25 0 0 0 6.108 14h3.784a2.25 2.25 0 0 0 2.243-1.982L12.95 5.5h.3a.75.75 0 0 0 0-1.5H11v-.75A2.25 2.25 0 0 0 8.75 1h-1.5A2.25 2.25 0 0 0 5 3.25Zm2.25-.75a.75.75 0 0 0-.75.75V4h3v-.75a.75.75 0 0 0-.75-.75h-1.5ZM6.05 6a.75.75 0 0 1 .787.713l.275 5.5a.75.75 0 0 1-1.498.075l-.275-5.5A.75.75 0 0 1 6.05 6Zm3.9 0a.75.75 0 0 1 .712.787l-.275 5.5a.75.75 0 0 1-1.498-.075l.275-5.5A.75.75 0 0 1 9.95 6Z" clipRule="evenodd" />
    </svg>
  )
}

// Trecho da mensagem citada, dentro do balão (como no WhatsApp)
function QuotedBlock({ quoted, isSent, onJump }: { quoted: any | null; isSent: boolean; onJump?: () => void }) {
  const who = !quoted ? '' : quoted.direction === 'enviado' ? 'Você' : (quoted.unlinked_sender_name || 'Contato')
  const raw = String(quoted?.message ?? '')
  const text = quoted?.media_type === 'image' && MEDIA_PLACEHOLDER_LABELS.has(raw) ? '📷 Foto'
    : quoted?.media_type === 'audio' ? '🎤 Áudio'
    : quoted?.media_type === 'video' && MEDIA_PLACEHOLDER_LABELS.has(raw) ? '🎥 Vídeo'
    : quoted?.media_type === 'document' ? `📄 ${quoted.media_filename ?? 'Documento'}`
    : raw.replace(/^\*[^*]{1,80}:\*\s*/, '')
  return (
    <button type="button" onClick={onJump} disabled={!quoted}
      className={`mb-1 block w-full rounded-md border-l-4 px-2 py-1 text-left ${isSent ? 'border-positive-600 bg-black/5' : 'border-brand-700 bg-gray-100'} ${quoted ? 'cursor-pointer hover:bg-black/10' : 'cursor-default'}`}>
      <span className={`block text-[11px] font-semibold ${quoted?.direction === 'enviado' ? 'text-positive-700' : 'text-brand-700'}`}>{quoted ? who : 'Mensagem citada'}</span>
      <span className="line-clamp-2 block text-xs text-gray-600">{quoted ? text || '…' : 'Mensagem fora do histórico carregado'}</span>
    </button>
  )
}

export function WhatsAppChatView({ messages, onDeleteMessage, onSaveNote, onReply, onReact }: WhatsAppChatViewProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [pickerFor, setPickerFor] = useState<string | null>(null)

  // Desce para o fim só quando chega mensagem nova (reação ou tique não mexem na rolagem)
  const lastId = messages?.length ? messages[messages.length - 1]?.id : null
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lastId, messages?.length])

  // Mensagens pelo id do WhatsApp, para mostrar a citada
  const byWid = useMemo(() => {
    const m = new Map<string, any>()
    for (const x of messages ?? []) if (x?.zapi_message_id) m.set(x.zapi_message_id, x)
    return m
  }, [messages])

  function jumpTo(id: string) {
    const el = boxRef.current?.querySelector(`[data-msg-id="${CSS.escape(id)}"]`) as HTMLElement | null
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('ring-2', 'ring-warn-600')
    setTimeout(() => el.classList.remove('ring-2', 'ring-warn-600'), 1400)
  }

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
    <div ref={boxRef} className="absolute inset-0 bg-[#E5DDD5] overflow-y-auto p-4 space-y-3">
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
            const quoted = msg.quoted_id ? byWid.get(msg.quoted_id) ?? null : null
            const reactions = [msg.reactions?.them, msg.reactions?.me].filter(Boolean) as string[]
            const canReact = !!onReact && !!msg.zapi_message_id && !String(msg.id).startsWith('opt-')

            return (
              <div
                key={msg.id}
                className={`flex ${reactions.length ? 'mb-4' : 'mb-1.5'} ${isSent ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  data-msg-id={msg.id}
                  className={`
                    group relative max-w-[75%] rounded-lg px-3 py-2 shadow-sm transition-shadow
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

                  {msg.quoted_id && (
                    <QuotedBlock quoted={quoted} isSent={isSent} onJump={quoted ? () => jumpTo(quoted.id) : undefined} />
                  )}

                  <MediaContent
                    mediaType={msg.media_type}
                    mediaUrl={msg.media_url}
                    mediaFilename={msg.media_filename}
                    message={msg.message}
                  />

                  <div className="mt-1 flex items-center justify-end gap-1">
                    <span className="text-[10px] text-gray-400">
                      {formatTime(msg.created_at)}
                    </span>
                    <DeliveryTick status={msg.status === 'falhou' ? 'falhou' : (msg.delivery_status ?? msg.status)} direction={msg.direction} error={msg.error_message} />

                    {onReply && !String(msg.id).startsWith('opt-') && (
                      <button
                        onClick={() => onReply(msg)}
                        className="ml-1 rounded p-0.5 text-[11px] text-gray-400 opacity-0 transition-all duration-150 hover:bg-gray-100 hover:text-gray-700 group-hover:opacity-100 focus:opacity-100"
                        title="Responder citando esta mensagem"
                        aria-label="Responder"
                      >
                        ↩
                      </button>
                    )}

                    {canReact && (
                      <button
                        onClick={() => setPickerFor(v => (v === msg.id ? null : msg.id))}
                        className="ml-0.5 rounded p-0.5 text-[11px] text-gray-400 opacity-0 transition-all duration-150 hover:bg-gray-100 group-hover:opacity-100 focus:opacity-100"
                        title="Reagir"
                        aria-label="Reagir"
                        aria-expanded={pickerFor === msg.id}
                      >
                        😊
                      </button>
                    )}

                    {onSaveNote && (
                      <button
                        onClick={() => onSaveNote(msg.id)}
                        className="ml-1 rounded p-0.5 text-[11px] text-gray-400 opacity-0 transition-all duration-150 hover:bg-brand-100 hover:text-brand-700 group-hover:opacity-100 focus:opacity-100"
                        title="Salvar como nota na oportunidade / empresa"
                        aria-label="Salvar como nota"
                      >
                        📌
                      </button>
                    )}

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

                  {pickerFor === msg.id && (
                    <>
                      <div className="fixed inset-0 z-20" onClick={() => setPickerFor(null)} />
                      <div className={`absolute bottom-full z-30 mb-1 flex gap-0.5 rounded-full border border-gray-200 bg-white px-1.5 py-1 shadow-lg ${isSent ? 'right-0' : 'left-0'}`}
                        role="menu" aria-label="Escolha uma reação">
                        {QUICK_REACTIONS.map(e => (
                          <button key={e} type="button" role="menuitem"
                            onClick={() => { setPickerFor(null); onReact?.(msg, msg.reactions?.me === e ? '' : e) }}
                            className={`rounded-full px-1 text-lg leading-none transition-transform hover:scale-125 ${msg.reactions?.me === e ? 'bg-gray-100' : ''}`}
                            title={msg.reactions?.me === e ? 'Tirar reação' : `Reagir com ${e}`}>
                            {e}
                          </button>
                        ))}
                      </div>
                    </>
                  )}

                  {reactions.length > 0 && (
                    <button type="button"
                      onClick={() => canReact && setPickerFor(msg.id)}
                      className={`absolute -bottom-3 ${isSent ? 'right-2' : 'left-2'} flex items-center gap-0.5 rounded-full border border-gray-200 bg-white px-1.5 text-sm leading-5 shadow-sm`}
                      title={[msg.reactions?.them ? `Contato: ${msg.reactions.them}` : '', msg.reactions?.me ? `Você: ${msg.reactions.me}` : ''].filter(Boolean).join(' · ')}>
                      {[...new Set(reactions)].join('')}
                      {reactions.length > 1 && <span className="text-[10px] text-gray-500">{reactions.length}</span>}
                    </button>
                  )}
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
