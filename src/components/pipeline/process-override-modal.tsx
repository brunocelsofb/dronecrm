'use client'
// Mudança de etapa fora do processo: mostra o porquê e pede MUDAR + motivo (fica registrado na oportunidade)
import { useState } from 'react'
import { OVERRIDE_WORD, MIN_REASON } from '@/lib/rules/renewal-process'

export function ProcessOverrideModal({ message, busy, error, onConfirm, onCancel }: {
  message: string; busy: boolean; error: string | null
  onConfirm: (o: { word: string; reason: string }) => void; onCancel: () => void
}) {
  const [word, setWord] = useState('')
  const [reason, setReason] = useState('')
  const ok = word.trim().toUpperCase() === OVERRIDE_WORD && reason.trim().length >= MIN_REASON
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Mudança fora do processo">
      <div className="w-full max-w-md space-y-3 rounded-lg bg-white p-5 shadow-xl">
        <p className="text-sm font-semibold text-warn-700">⚠ Mudança fora do processo</p>
        <p className="text-sm text-gray-700">{message}</p>
        <label className="block text-xs text-gray-700">Motivo (fica registrado com o seu nome na oportunidade)
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} maxLength={500}
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" placeholder="Ex.: cliente pediu para antecipar a negociação" />
        </label>
        <label className="block text-xs text-gray-700">Para confirmar, digite <b>{OVERRIDE_WORD}</b>
          <input value={word} onChange={e => setWord(e.target.value)} placeholder={OVERRIDE_WORD} aria-label={`Digite ${OVERRIDE_WORD}`}
            className="mt-1 w-40 rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
        </label>
        {error && <p className="text-xs text-negative-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-md px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100">Cancelar</button>
          <button type="button" disabled={!ok || busy} onClick={() => onConfirm({ word, reason })}
            className="rounded-md bg-warn-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{busy ? 'Mudando…' : 'Mudar mesmo assim'}</button>
        </div>
      </div>
    </div>
  )
}
