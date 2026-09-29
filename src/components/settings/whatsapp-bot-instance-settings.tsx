'use client'

// ============================================================
// Componente: WhatsAppBotInstanceSettings
//
// ONDE INJECTAR:
//   Procura no teu projecto o ficheiro de settings do WhatsApp.
//   Provavelmente é um dos seguintes:
//     - src/app/(dashboard)/settings/whatsapp/page.tsx
//     - src/app/(dashboard)/configuracoes/page.tsx
//     - src/components/settings/whatsapp-settings.tsx
//
//   Adiciona este componente como uma secção dentro dessa página:
//
//   import { WhatsAppBotInstanceSettings } from '@/components/settings/whatsapp-bot-instance-settings'
//   ...
//   <WhatsAppBotInstanceSettings instanceAliases={orgSettings.evo_instance_aliases} />
//
// PROPS:
//   instanceAliases — vem de organization_settings.evo_instance_aliases
//   Ex.: { "drone_whatsapp_v4": { label: "Bruno", bot_enabled: true }, ... }
// ============================================================

import { useState, useCallback } from 'react'

interface InstanceConfig {
  label?: string
  bot_enabled?: boolean
}

interface Props {
  instanceAliases: Record<string, InstanceConfig | string>
}

// Normaliza entradas antigas (string pura) e novas (objecto)
function normalize(aliases: Record<string, InstanceConfig | string>): Record<string, InstanceConfig> {
  const out: Record<string, InstanceConfig> = {}
  for (const [key, val] of Object.entries(aliases)) {
    if (typeof val === 'string') {
      out[key] = { label: val, bot_enabled: true }
    } else {
      out[key] = { label: val.label ?? key, bot_enabled: val.bot_enabled !== false }
    }
  }
  return out
}

export function WhatsAppBotInstanceSettings({ instanceAliases }: Props) {
  // Estado local — optimistic UI: actualiza imediatamente, reverte se falhar
  const [instances, setInstances] = useState<Record<string, InstanceConfig>>(
    () => normalize(instanceAliases)
  )
  // Guarda o estado de loading e erro por instância separadamente
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  const toggle = useCallback(async (instanceKey: string, newValue: boolean) => {
    const previous = instances[instanceKey]?.bot_enabled

    // 1. Optimistic update — interface reage imediatamente
    setInstances(prev => ({
      ...prev,
      [instanceKey]: { ...prev[instanceKey], bot_enabled: newValue },
    }))
    setSaving(prev => ({ ...prev, [instanceKey]: true }))
    setErrors(prev => ({ ...prev, [instanceKey]: '' }))

    try {
      const res = await fetch('/api/settings/whatsapp-instance', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instance: instanceKey, bot_enabled: newValue }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error ?? `HTTP ${res.status}`)
      }
    } catch (err: any) {
      // Reverte em caso de erro
      setInstances(prev => ({
        ...prev,
        [instanceKey]: { ...prev[instanceKey], bot_enabled: previous },
      }))
      setErrors(prev => ({
        ...prev,
        [instanceKey]: err?.message ?? 'Erro ao salvar',
      }))
    } finally {
      setSaving(prev => ({ ...prev, [instanceKey]: false }))
    }
  }, [instances])

  const keys = Object.keys(instances)

  if (keys.length === 0) {
    return (
      <p className="text-sm text-gray-500 py-4 text-center">
        Nenhuma instância configurada.
      </p>
    )
  }

  return (
    <div className="space-y-1">
      {keys.map((key, idx) => {
        const config = instances[key]
        const isEnabled = config.bot_enabled !== false
        const isSaving = saving[key] === true
        const errorMsg = errors[key]

        return (
          <div
            key={key}
            className="flex items-center justify-between rounded-xl px-4 py-3 transition-colors duration-150 hover:bg-gray-50 group"
            style={{
              // Stagger de entrada
              animationDelay: `${idx * 40}ms`,
            }}
          >
            {/* Info da instância */}
            <div className="flex flex-col min-w-0 gap-0.5">
              <span className="text-sm font-medium text-gray-900 truncate">
                {config.label ?? key}
              </span>
              <span className="text-xs text-gray-400 font-mono truncate">{key}</span>
              {errorMsg && (
                <span className="text-xs text-red-500 mt-0.5">⚠ {errorMsg}</span>
              )}
            </div>

            {/* Toggle + badge de estado */}
            <div className="flex items-center gap-3 shrink-0 ml-4">
              {/* Badge de estado */}
              <span
                className={`
                  hidden sm:inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold
                  transition-all duration-200
                  ${isEnabled
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-gray-100 text-gray-500'}
                `}
              >
                <span
                  className={`
                    inline-block w-1.5 h-1.5 rounded-full
                    ${isEnabled ? 'bg-emerald-500' : 'bg-gray-400'}
                    ${isEnabled ? 'animate-pulse' : ''}
                  `}
                />
                {isEnabled ? 'Bot ativo' : 'Bot inativo'}
              </span>

              {/* Switch */}
              <button
                role="switch"
                aria-checked={isEnabled}
                aria-label={`${isEnabled ? 'Desativar' : 'Ativar'} bot para ${config.label ?? key}`}
                disabled={isSaving}
                onClick={() => toggle(key, !isEnabled)}
                className={`
                  relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full
                  border-2 border-transparent transition-colors duration-200 ease-in-out
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1B556B] focus-visible:ring-offset-2
                  disabled:opacity-60 disabled:cursor-not-allowed
                  ${isEnabled ? 'bg-[#1B556B]' : 'bg-gray-200'}
                `}
              >
                <span
                  className={`
                    pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-md
                    ring-0 transition-all duration-200 ease-in-out
                    ${isEnabled ? 'translate-x-5' : 'translate-x-0'}
                    ${isSaving ? 'opacity-60' : ''}
                  `}
                />
                {/* Spinner de loading dentro do toggle */}
                {isSaving && (
                  <span className="absolute inset-0 flex items-center justify-center">
                    <svg
                      className="h-3 w-3 animate-spin text-white"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  </span>
                )}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
