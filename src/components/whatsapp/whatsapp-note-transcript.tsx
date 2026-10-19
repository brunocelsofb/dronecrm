'use client'

// Nota salva da Central de WhatsApp: mostra a conversa como no WhatsApp,
// com quem falou e o áudio/imagem/documento tocável no histórico.

export type WhatsAppNoteMeta = {
  kind: 'whatsapp_note'
  phone: string
  contact_name: string | null
  comment: string | null
  messages: {
    id: string; at: string; side: 'contato' | 'empresa'; who: string; text: string
    media_type: string | null; media_url: string | null; media_filename: string | null
  }[]
}

export function isWhatsAppNote(meta: unknown): meta is WhatsAppNoteMeta {
  return !!meta && typeof meta === 'object' && (meta as { kind?: string }).kind === 'whatsapp_note'
    && Array.isArray((meta as { messages?: unknown }).messages)
}

const fmtPhone = (d: string) => {
  const l = d.length > 11 && d.startsWith('55') ? d.slice(2) : d
  return l.length === 11 ? `(${l.slice(0, 2)}) ${l.slice(2, 7)}-${l.slice(7)}` : l.length === 10 ? `(${l.slice(0, 2)}) ${l.slice(2, 6)}-${l.slice(6)}` : d
}
const when = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export function WhatsAppNoteTranscript({ meta }: { meta: WhatsAppNoteMeta }) {
  return (
    <div className="mt-1 space-y-2">
      <p className="text-xs text-gray-600">
        💬 Conversa com <b className="text-gray-900">{meta.contact_name ?? 'contato sem nome'}</b> · {fmtPhone(meta.phone)}
      </p>
      {meta.comment && <p className="whitespace-pre-wrap text-sm text-gray-900">{meta.comment}</p>}
      <div className="space-y-1.5 rounded-lg bg-gray-100 p-2.5">
        {meta.messages.map(m => {
          const mine = m.side === 'empresa'
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-lg px-2.5 py-1.5 shadow-sm ${mine ? 'bg-positive-100' : 'bg-white'}`}>
                <p className={`text-[11px] font-semibold ${mine ? 'text-positive-700' : 'text-brand-700'}`}>
                  {m.who}{mine ? '' : ' · contato'}
                </p>
                {m.media_type === 'audio' && m.media_url && (
                  <audio controls preload="none" src={m.media_url} className="mt-1 h-9 w-64 max-w-full" />
                )}
                {m.media_type === 'image' && m.media_url && (
                  <a href={m.media_url} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element -- mídia servida pela própria API do CRM */}
                    <img src={m.media_url} alt="Imagem da conversa" className="mt-1 max-h-48 rounded-md" />
                  </a>
                )}
                {m.media_type === 'video' && m.media_url && (
                  <video controls preload="none" src={m.media_url} className="mt-1 max-h-48 rounded-md" />
                )}
                {m.media_type && !['audio', 'image', 'video'].includes(m.media_type) && m.media_url && (
                  <a href={m.media_url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs font-medium text-brand-700 underline">
                    📄 {m.media_filename || 'Abrir arquivo'}
                  </a>
                )}
                {m.media_type && !m.media_url && <p className="text-xs italic text-gray-500">[{m.media_type}: arquivo indisponível]</p>}
                {m.text && <p className="whitespace-pre-wrap text-[13px] text-gray-900">{m.text}</p>}
                <p className="mt-0.5 text-right text-[10px] text-gray-500">{when(m.at)}</p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
