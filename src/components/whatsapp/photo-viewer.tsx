'use client'
// Foto do contato em tamanho grande (como ao tocar na foto no WhatsApp)
import { useEffect } from 'react'
import { createPortal } from 'react-dom'

export function PhotoViewer({ url, name, phone, onClose }: { url: string; name?: string | null; phone?: string | null; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  if (typeof document === 'undefined') return null
  // Portal no body; o clique não sobe para a lista (senão abriria a conversa)
  return createPortal(
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
      onClick={e => { e.stopPropagation(); onClose() }} role="dialog" aria-modal="true" aria-label={`Foto de ${name || phone || 'contato'}`}>
      <button type="button" onClick={e => { e.stopPropagation(); onClose() }} aria-label="Fechar"
        className="absolute right-6 top-6 rounded-full bg-white/10 p-2 text-white hover:bg-white/20">
        <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
      </button>
      <img src={url} alt="" referrerPolicy="no-referrer" onClick={e => e.stopPropagation()}
        className="max-h-[75vh] max-w-full rounded-lg object-contain shadow-2xl" />
      {(name || phone) && (
        <div className="mt-3 text-center text-white" onClick={e => e.stopPropagation()}>
          {name && <p className="text-base font-semibold">{name}</p>}
          {phone && <p className="text-sm text-white/70">{phone}</p>}
        </div>
      )}
    </div>,
    document.body,
  )
}
