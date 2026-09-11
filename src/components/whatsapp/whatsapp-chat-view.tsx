'use client'

import { useState } from 'react'
import { deleteWhatsAppMessage } from '@/lib/actions/whatsapp'

type ChatMessage = {
  id: string
  direction: string
  message: string
  media_url: string | null
  media_type: string | null
  media_filename: string | null
  sender_photo_url: string | null
  delivery_status: string | null
  unlinked_sender_name?: string | null
  status: string
  error_message: string | null
  triggered_automatically: boolean
  created_at: string
  sent_by_name?: string | null
  is_forwarded?: boolean | null
  zapi_message_id?: string | null
}

const DELIVERY_TICK: Record<string, string> = { sent: '✓', delivered: '✓✓', read: '✓✓' }

function dayLabel(dateStr: string): string {
  const d = new Date(dateStr)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Hoje'
  if (d.toDateString() === yesterday.toDateString()) return 'Ontem'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function timeLabel(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function isSystemCaption(msg: string) {
  const lower = msg.toLowerCase().trim()
  return lower.startsWith('[imagem]') || 
         lower.startsWith('[vídeo]') || 
         lower.startsWith('[video]') || 
         lower.startsWith('[áudio]') || 
         lower.startsWith('[audio]') || 
         lower.startsWith('[documento]') || 
         lower.startsWith('[document]') || 
         lower.startsWith('[figurinha]')
}

function MediaContent({ mediaUrl, mediaType, mediaFilename }: { mediaUrl: string; mediaType: string; mediaFilename: string | null }) {
  if (mediaType === 'image') {
    return (
      <a href={mediaUrl} target="_blank" rel="noopener noreferrer">
        <img src={mediaUrl} alt="Imagem" className="max-w-[240px] rounded-md cursor-pointer hover:opacity-90" />
      </a>
    )
  }
  if (mediaType === 'audio') {
    return (
      <audio controls className="min-w-[220px] max-w-[280px] h-10 w-full">
        <source src={mediaUrl} type="audio/mp4" />
        <source src={mediaUrl} type="audio/mpeg" />
        <source src={mediaUrl} type="audio/ogg; codecs=opus" />
        <source src={mediaUrl} type="audio/ogg" />
        Seu navegador não suporta áudio.
      </audio>
    )
  }
  if (mediaType === 'video') {
    return <video controls src={mediaUrl} className="max-w-[240px] rounded-md" />
  }
  
  return (
    <a href={mediaUrl} target="_blank" rel="noopener noreferrer"
      className="flex items-center gap-2 rounded-lg bg-black/5 px-3 py-2 text-sm hover:bg-black/10 transition-colors">
      <span className="text-2xl">📎</span>
      <span className="underline truncate max-w-[180px]" title={mediaFilename ?? 'Arquivo'}>
        {mediaFilename ?? 'Arquivo'}
      </span>
    </a>
  )
}

function MessageAvatar({ isSent, m, senderName }: { isSent: boolean, m: ChatMessage, senderName: string | null | undefined }) {
  const [imgError, setImgError] = useState(false)

  const safeSenderName = senderName?.trim() || 'Usuário'
  const safeSentByName = m.sent_by_name?.trim() || '📱'

  const fallbackText = isSent
    ? (m.triggered_automatically ? '🤖' : (safeSentByName !== '📱' ? safeSentByName.charAt(0).toUpperCase() : '📱'))
    : safeSenderName.charAt(0).toUpperCase()

  return (
    <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold shadow-sm
      ${isSent ? 'bg-[#1B556B] text-white' : 'bg-blue-100 text-blue-700'}`}
      title={safeSenderName}>
      
      {!isSent && m.sender_photo_url && m.sender_photo_url.startsWith('http') && !imgError ? (
        <img 
          src={m.sender_photo_url} 
          alt={fallbackText} 
          className="h-full w-full rounded-full object-cover" 
          onError={() => setImgError(true)} 
        />
      ) : (
        <span>{fallbackText}</span>
      )}
    </div>
  )
}

export function WhatsAppChatView({ 
  messages, contactName, contactPhone, selectable = false, selectedIds = new Set(), onToggleSelect 
}: {
  messages: ChatMessage[]; contactName?: string | null; contactPhone?: string | null;
  selectable?: boolean; selectedIds?: Set<string>; onToggleSelect?: (id: string) => void;
}) {
  const chronological = [...messages].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  )

  const groups: { label: string; msgs: ChatMessage[] }[] = []
  for (const m of chronological) {
    const label = dayLabel(m.created_at)
    if (!groups.length || groups[groups.length - 1].label !== label) {
      groups.push({ label, msgs: [m] })
    } else {
      groups[groups.length - 1].msgs.push(m)
    }
  }

  return (
    <div className="flex flex-col gap-0.5 bg-[#e5ddd5] p-3 overflow-y-auto h-full">
      {chronological.length === 0 && (
        <p className="py-8 text-center text-sm text-gray-500">Nenhuma mensagem ainda.</p>
      )}

      {groups.map((group) => (
        <div key={group.label}>
          <div className="flex items-center justify-center my-3">
            <span className="rounded-full bg-[#e1f3fb] px-3 py-0.5 text-[11px] font-medium text-[#54656f] shadow-sm">
              {group.label}
            </span>
          </div>

          {group.msgs.map((m) => {
            const isSent = m.direction === 'enviado'
            const senderName = isSent
              ? (m.sent_by_name ?? (m.triggered_automatically ? 'Automação' : null))
              : (m.unlinked_sender_name ?? contactName)

            return (
              <div key={m.id} className={`group flex items-end gap-1 mb-1 ${isSent ? 'flex-row-reverse' : ''}`}>
                
                {selectable && (
                  <div className="flex items-center pb-1">
                    <input 
                      type="checkbox" 
                      checked={selectedIds.has(m.id)}
                      onChange={() => onToggleSelect?.(m.id)}
                      className={`w-4 h-4 cursor-pointer rounded border-gray-300 ${isSent ? 'mr-1' : 'ml-1'}`}
                    />
                  </div>
                )}

                <MessageAvatar isSent={isSent} m={m} senderName={senderName} />

                <div className={`relative max-w-[72%] rounded-lg px-3 pt-1.5 pb-2 text-sm shadow-sm
                  ${isSent ? 'bg-[#dcf8c6] rounded-tr-none' : 'bg-white rounded-tl-none'} text-gray-900`}>

                  <button
                    onClick={async () => {
                      if (!confirm('Excluir esta mensagem?')) return
                      await deleteWhatsAppMessage(m.id, (m as any).phone ?? contactPhone ?? '', m.zapi_message_id)
                    }}
                    className={`absolute opacity-0 group-hover:opacity-100 transition-opacity -top-2 text-[10px] text-red-400
                      hover:text-red-600 bg-white rounded-full w-5 h-5 flex items-center justify-center shadow z-10
                      ${isSent ? '-left-2' : '-right-2'}`}>
                    🗑
                  </button>

                  {m.is_forwarded && (
                    <p className="text-[10px] text-gray-400 italic mb-0.5">↪ Encaminhada</p>
                  )}

                  {senderName && (
                    <p className={`text-[11px] font-semibold mb-0.5
                      ${isSent ? 'text-[#1B556B]' : 'text-[#e67e22]'}`}>
                      {senderName}
                    </p>
                  )}

                  {m.media_url && m.media_type ? (
                    <>
                      <MediaContent mediaUrl={m.media_url} mediaType={m.media_type} mediaFilename={m.media_filename} />
                      {m.message && !isSystemCaption(m.message) && (
                        <p className="mt-1 whitespace-pre-wrap">{m.message}</p>
                      )}
                    </>
                  ) : (
                    <p className="whitespace-pre-wrap leading-snug">{m.message}</p>
                  )}

                  <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-gray-400 select-none">
                    {m.triggered_automatically && <span title="Automação">🤖</span>}
                    <span>{timeLabel(m.created_at)}</span>
                    {isSent && m.status === 'falhou' && (
                      <span className="text-red-500" title={m.error_message ?? ''}>✗</span>
                    )}
                    {isSent && m.delivery_status && m.status !== 'falhou' && (
                      <span className={m.delivery_status === 'read' ? 'text-blue-500' : ''}>
                        {DELIVERY_TICK[m.delivery_status] ?? ''}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
