'use client'

import { useState } from 'react'
import { updateWhatsAppBotSettings, toggleWhatsAppOnlineStatus, toggleTriagemEnabled } from '@/lib/actions/whatsapp'

export function WhatsAppBotSettingsForm({
  isOnline,
  welcomeMessage,
  welcomeMessageOnline,
  reminderMessage,
  dailyLimit = 5,
  companyName,
  triagemEnabled = true,
}: {
  isOnline: boolean
  welcomeMessage: string
  welcomeMessageOnline: string
  reminderMessage: string
  dailyLimit?: number
  companyName?: string
  triagemEnabled?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [onlineNow, setOnlineNow] = useState(isOnline)
  const [toggling, setToggling] = useState(false)
  const [triagemNow, setTriagemNow] = useState(triagemEnabled)
  const [togglingTriagem, setTogglingTriagem] = useState(false)

  async function handleToggleOnline() {
    setToggling(true)
    const result = await toggleWhatsAppOnlineStatus(!onlineNow)
    setToggling(false)
    if (!result.error) setOnlineNow(!onlineNow)
  }

  async function handleToggleTriagem() {
    setTogglingTriagem(true)
    const result = await toggleTriagemEnabled(!triagemNow)
    setTogglingTriagem(false)
    if (!result.error) setTriagemNow(!triagemNow)
  }

  async function handleSave(formData: FormData) {
    setBusy(true)
    setSaved(false)
    setError(null)
    const result = await updateWhatsAppBotSettings(formData)
    setBusy(false)
    if (result.error) setError(result.error)
    else setSaved(true)
  }

  return (
    <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-6">
      <div>
        <h3 className="text-sm font-medium text-gray-900">🤖 Bot de WhatsApp</h3>
        <p className="mt-0.5 text-xs text-gray-400">
          Mensagens automáticas enviadas para o primeiro contato de um número desconhecido. Use <code>{'{{empresa}}'}</code> e <code>{'{{link}}'}</code> como variáveis.
        </p>
      </div>

      {/* Toggle: Status online/offline */}
      <div className="flex items-center justify-between rounded-md bg-gray-50 px-3 py-2.5">
        <div>
          <p className="text-sm font-medium text-gray-800">{onlineNow ? '🟢 Estamos online' : '⚪ Estamos offline'}</p>          <p className="text-xs text-gray-400">Muda o tom da primeira mensagem automática — mais direto quando há equipe para responder na hora.</p>
        </div>
        <button
          onClick={handleToggleOnline}
          disabled={toggling}
          className={`rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${onlineNow ? 'bg-positive-600 text-white hover:bg-positive-700' : 'border border-gray-300 text-gray-700 hover:bg-gray-100'}`}
        >
          {toggling ? '...' : onlineNow ? 'Ficar offline' : 'Ficar online'}
        </button>
      </div>

      {/* Toggle: Triagem automática (kill switch) */}
      <div className="flex items-center justify-between rounded-md border border-gray-200 px-3 py-2.5">
        <div>
          <p className="text-sm font-medium text-gray-800">
            {triagemNow ? '🟢 Bot de triagem ativado' : '🔴 Bot de triagem desativado'}
          </p>
          <p className="text-xs text-gray-400">
            {triagemNow
              ? 'O bot envia menu, protocolo e confirmação automaticamente para novos contatos.'
              : 'Bot desativado — mensagens chegam normalmente, mas sem respostas automáticas.'}
          </p>
        </div>
        <button
          onClick={handleToggleTriagem}
          disabled={togglingTriagem}
          className={`rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${triagemNow ? 'bg-[#1B556B] text-white hover:bg-[#164659]' : 'border border-gray-300 text-gray-700 hover:bg-gray-100'}`}
        >
          {togglingTriagem ? '...' : triagemNow ? 'Desativar bot' : 'Ativar bot'}
        </button>
      </div>

      <form action={handleSave} className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-600">Mensagem de boas-vindas (quando OFFLINE)</label>
          <textarea name="whatsapp_welcome_message" defaultValue={welcomeMessage} rows={5} className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-mono focus:border-brand-700 focus:outline-none" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600">Mensagem de boas-vindas (quando ONLINE)</label>
          <textarea name="whatsapp_welcome_message_online" defaultValue={welcomeMessageOnline} rows={4} className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-mono focus:border-brand-700 focus:outline-none" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600">Mensagem de lembrete (24h depois, se não preencher)</label>
          <textarea name="whatsapp_reminder_message" defaultValue={reminderMessage} rows={4} className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-mono focus:border-brand-700 focus:outline-none" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600">Limite de mensagens automáticas por dia, por número</label>
          <input name="whatsapp_daily_auto_limit" type="number" min="1" max="20" defaultValue={dailyLimit} className="mt-1 w-24 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none" />
          <p className="mt-0.5 text-xs text-gray-400">Protege contra risco de bloqueio no WhatsApp — recomendado deixar 3 ou menos.</p>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <button type="submit" disabled={busy} className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">
          {busy ? 'Salvando...' : 'Salvar'}
        </button>
        {saved && <span className="ml-2 text-xs text-positive-700">Salvo!</span>}
      </form>
    </div>
  )
}
