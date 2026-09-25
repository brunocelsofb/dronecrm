'use client'

import { useState } from 'react'
import {
  updateWhatsAppBotSettings,
  toggleWhatsAppOnlineStatus,
  toggleTriagemEnabled,
  saveTriagemMenuOptions,
} from '@/lib/actions/whatsapp'

export interface TriageOption {
  key: string
  label: string
  department: string
}

export function WhatsAppBotSettingsForm({
  isOnline,
  welcomeMessage,
  welcomeMessageOnline,
  reminderMessage,
  dailyLimit = 5,
  companyName,
  triagemEnabled = true,
  initialMenuOptions = [],
}: {
  isOnline: boolean
  welcomeMessage: string
  welcomeMessageOnline: string
  reminderMessage: string
  dailyLimit?: number
  companyName?: string
  triagemEnabled?: boolean
  initialMenuOptions?: TriageOption[]
}) {
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [onlineNow, setOnlineNow] = useState(isOnline)
  const [toggling, setToggling] = useState(false)
  const [triagemNow, setTriagemNow] = useState(triagemEnabled)
  const [togglingTriagem, setTogglingTriagem] = useState(false)

  // Estado das opções do menu de triagem
  const [menuOptions, setMenuOptions] = useState<TriageOption[]>(
    initialMenuOptions.length > 0
      ? initialMenuOptions
      : [
          { key: '1', label: 'Vendas', department: 'vendas' },
          { key: '2', label: 'Financeiro', department: 'financeiro' },
          { key: '3', label: 'Técnico', department: 'tecnico' },
        ]
  )
  const [savingOptions, setSavingOptions] = useState(false)
  const [optionsSaved, setOptionsSaved] = useState(false)

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

  function handleOptionChange(index: number, field: keyof TriageOption, value: string) {
    const updated = [...menuOptions]
    updated[index] = { ...updated[index], [field]: value }
    setMenuOptions(updated)
  }

  function handleAddOption() {
    const nextKey = String(menuOptions.length + 1)
    setMenuOptions([...menuOptions, { key: nextKey, label: '', department: '' }])
  }

  function handleRemoveOption(index: number) {
    const updated = menuOptions.filter((_, i) => i !== index)
    // Reorganiza as chaves numéricas (1, 2, 3...) automaticamente
    const reindexed = updated.map((opt, i) => ({ ...opt, key: String(i + 1) }))
    setMenuOptions(reindexed)
  }

  async function handleSaveOptions() {
    setSavingOptions(true)
    setOptionsSaved(false)
    const res = await saveTriagemMenuOptions(menuOptions)
    setSavingOptions(false)
    if (!res.error) {
      setOptionsSaved(true)
      setTimeout(() => setOptionsSaved(false), 3000)
    }
  }

  return (
    <div className="space-y-6">
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
            <p className="text-sm font-medium text-gray-800">{onlineNow ? '🟢 Estamos online' : '⚪ Estamos offline'}</p>
            <p className="text-xs text-gray-400">Muda o tom da primeira mensagem automática — mais direto quando há equipe para responder na hora.</p>
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
            <textarea name="whatsapp_welcome_message" defaultValue={welcomeMessage} rows={4} className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-mono focus:border-brand-700 focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600">Mensagem de boas-vindas (quando ONLINE)</label>
            <textarea name="whatsapp_welcome_message_online" defaultValue={welcomeMessageOnline} rows={3} className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-mono focus:border-brand-700 focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600">Mensagem de lembrete (24h depois, se não preencher)</label>
            <textarea name="whatsapp_reminder_message" defaultValue={reminderMessage} rows={3} className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-mono focus:border-brand-700 focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600">Limite de mensagens automáticas por dia, por número</label>
            <input name="whatsapp_daily_auto_limit" type="number" min="1" max="20" defaultValue={dailyLimit} className="mt-1 w-24 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none" />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button type="submit" disabled={busy} className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">
            {busy ? 'Salvando...' : 'Salvar Textos'}
          </button>
          {saved && <span className="ml-2 text-xs text-positive-700">Salvo!</span>}
        </form>
      </div>

      {/* EDITOR DINÂMICO DO MENU DE TRIAGEM */}
      <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-6">
        <div>
          <h3 className="text-sm font-medium text-gray-900">📋 Opções do Menu de Triagem</h3>
          <p className="mt-0.5 text-xs text-gray-400">
            Adicione, edite ou remova opções (1, 2, 3, 4, 5...) e mapeie para qual setor/departamento a conversa será direcionada.
          </p>
        </div>

        <div className="space-y-2">
          {menuOptions.map((opt, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <span className="w-8 text-center text-xs font-bold text-gray-500">{opt.key}.</span>
              <input
                type="text"
                placeholder="Ex: Vendas, Suporte..."
                value={opt.label}
                onChange={(e) => handleOptionChange(idx, 'label', e.target.value)}
                className="flex-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none"
              />
              <input
                type="text"
                placeholder="Setor (ex: vendas, financeiro)"
                value={opt.department}
                onChange={(e) => handleOptionChange(idx, 'department', e.target.value.toLowerCase().trim())}
                className="w-44 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => handleRemoveOption(idx)}
                className="rounded px-2 py-1.5 text-xs text-red-600 hover:bg-red-50"
              >
                Remover
              </button>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            onClick={handleAddOption}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            + Adicionar opção
          </button>

          <div className="flex items-center gap-2">
            {optionsSaved && <span className="text-xs text-positive-700 font-medium">Opções salvas!</span>}
            <button
              type="button"
              onClick={handleSaveOptions}
              disabled={savingOptions}
              className="rounded-md bg-[#1B556B] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#164659] disabled:opacity-50"
            >
              {savingOptions ? 'Salvando...' : 'Salvar Menu de Triagem'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
