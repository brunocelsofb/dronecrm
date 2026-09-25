'use client'

import { useState } from 'react'
import { finishConversationWithNPS } from '@/lib/actions/whatsapp'

export function FinalizarNPSModal({
  isOpen,
  onClose,
  phone,
  contactName,
}: {
  isOpen: boolean
  onClose: () => void
  phone: string
  contactName: string
}) {
  const [sendNPS, setSendNPS] = useState(true)
  const [busy, setBusy] = useState(false)

  if (!isOpen) return null

  async function handleConfirm() {
    setBusy(true)
    await finishConversationWithNPS(phone, sendNPS)
    setBusy(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl border border-gray-100">
        <h3 className="text-base font-semibold text-gray-900">
          Finalizar Atendimento — {contactName}
        </h3>
        <p className="mt-1 text-xs text-gray-500">
          Você está prestes a encerrar esta conversa. Escolha se deseja enviar a pesquisa de avaliação de satisfação (NPS).
        </p>

        <div className="mt-4 rounded-md bg-gray-50 p-3 border border-gray-200">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={sendNPS}
              onChange={(e) => setSendNPS(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
            />
            <div>
              <p className="text-xs font-medium text-gray-800">Enviar pesquisa de satisfação (NPS)</p>
              <p className="text-[11px] text-gray-500">
                O bot enviará uma mensagem pedindo uma nota de 1 a 5 no WhatsApp do cliente.
              </p>
            </div>
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy}
            className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-800 disabled:opacity-50"
          >
            {busy ? 'Finalizando...' : 'Confirmar Encerramento'}
          </button>
        </div>
      </div>
    </div>
  )
}
