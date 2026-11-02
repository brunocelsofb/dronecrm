'use client'
// Confirmação de mudança fora do processo: "Você tem certeza?" + digitar "mudar".
// O motivo é opcional (se escrito, vai para o histórico junto com quem mudou).
import { useState } from 'react'
import { OVERRIDE_WORD } from '@/lib/rules/renewal-process'

export function ProcessOverrideModal({ message, busy, error, onConfirm, onCancel }: {
  message: string; busy: boolean; error: string | null
  onConfirm: (o: { word: string; reason: string }) => void; onCancel: () => void
}) {
  const [word, setWord] = useState('')
  const [reason, setReason] = useState('')
  const [showReason, setShowReason] = useState(false)
  const ok = word.trim().toLowerCase() === OVERRIDE_WORD
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Você tem certeza?">
      <div className="w-full max-w-md overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="h-1.5 bg-warn-600" />
        <div className="space-y-3 px-6 pb-5 pt-6 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-warn-100 text-2xl text-warn-700" aria-hidden="true">⚠</span>
          <p className="text-lg font-semibold text-gray-800">Você tem certeza?</p>
          <p className="text-sm text-gray-600">{message} Para confirmar, digite a palavra <b>{OVERRIDE_WORD}</b> no campo abaixo.</p>
          <input value={word} onChange={e => setWord(e.target.value)} placeholder="Digite aqui…" aria-label={`Digite ${OVERRIDE_WORD}`} autoFocus
            onKeyDown={e => { if (e.key === 'Enter' && ok && !busy) onConfirm({ word, reason }) }}
            className="w-full rounded-md border border-gray-300 px-3 py-2.5 text-sm focus:border-warn-600 focus:outline-none" />
          {showReason
            ? <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} maxLength={500} placeholder="Motivo (opcional) — fica no histórico"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-warn-600 focus:outline-none" />
            : <button type="button" onClick={() => setShowReason(true)} className="text-xs text-gray-500 hover:text-gray-800 hover:underline">+ escrever o motivo (opcional)</button>}
          {error && <p className="text-xs text-negative-600">{error}</p>}
        </div>
        <div className="flex items-center justify-between border-t border-gray-100 px-6 py-4">
          <button type="button" onClick={onCancel} className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Cancelar</button>
          <button type="button" disabled={!ok || busy} onClick={() => onConfirm({ word, reason })}
            className="rounded-md bg-warn-600 px-4 py-2 text-sm font-semibold text-white hover:bg-warn-700 disabled:opacity-50">{busy ? 'Confirmando…' : 'Confirmar'}</button>
        </div>
      </div>
    </div>
  )
}
