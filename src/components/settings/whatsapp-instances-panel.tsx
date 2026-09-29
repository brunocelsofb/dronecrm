'use client'

import { useState, useCallback, useEffect } from 'react'
import { Wifi, WifiOff, RefreshCw, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface InstanceConfig {
  label?: string
  bot_enabled?: boolean
}

interface WhatsAppInstance {
  name: string            // chave interna (ex: "drone_whatsapp_v4")
  label: string           // nome de exibição (ex: "Bruno Barbosa")
  status: 'open' | 'close' | 'connecting' | string
  bot_enabled: boolean
}

interface Props {
  // evo_instance_aliases de organization_settings — suporta string pura (legado) e objeto (novo)
  instanceAliases: Record<string, InstanceConfig | string>
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeAliases(
  aliases: Record<string, InstanceConfig | string>
): Record<string, InstanceConfig> {
  const out: Record<string, InstanceConfig> = {}
  for (const [key, val] of Object.entries(aliases)) {
    if (typeof val === 'string') {
      out[key] = { label: val, bot_enabled: true }
    } else {
      out[key] = {
        label: val.label ?? key,
        bot_enabled: val.bot_enabled !== false,
      }
    }
  }
  return out
}

// ─── Componente principal ────────────────────────────────────────────────────

export function WhatsAppInstancesPanel({ instanceAliases }: Props) {
  const normalized = normalizeAliases(instanceAliases ?? {})

  // Estado local de instâncias (inclui bot_enabled para optimistic UI)
  const [instances, setInstances] = useState<Record<string, InstanceConfig>>(normalized)

  // Status de conexão por instância (buscado da Evolution API via rota interna)
  const [connectionStatus, setConnectionStatus] = useState<Record<string, string>>({})
  const [loadingStatus, setLoadingStatus] = useState<Record<string, boolean>>({})

  // Estado do toggle de bot por instância
  const [botSaving, setBotSaving] = useState<Record<string, boolean>>({})
  const [botErrors, setBotErrors] = useState<Record<string, string>>({})

  // ── Busca status de conexão ao montar ───────────────────────────────────
  useEffect(() => {
    const keys = Object.keys(instances)
    if (keys.length === 0) return

    // Marca todos como carregando
    setLoadingStatus(Object.fromEntries(keys.map(k => [k, true])))

    keys.forEach(async (instanceName) => {
      try {
        const res = await fetch(
          `/api/whatsapp/instance-status?instance=${encodeURIComponent(instanceName)}`
        )
        const data = await res.json()
        setConnectionStatus(prev => ({
          ...prev,
          [instanceName]: data?.status ?? 'unknown',
        }))
      } catch {
        setConnectionStatus(prev => ({ ...prev, [instanceName]: 'error' }))
      } finally {
        setLoadingStatus(prev => ({ ...prev, [instanceName]: false }))
      }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Toggle de bot por instância ─────────────────────────────────────────
  const toggleBot = useCallback(async (instanceKey: string, newValue: boolean) => {
    const previous = instances[instanceKey]?.bot_enabled

    // Optimistic update
    setInstances(prev => ({
      ...prev,
      [instanceKey]: { ...prev[instanceKey], bot_enabled: newValue },
    }))
    setBotSaving(prev => ({ ...prev, [instanceKey]: true }))
    setBotErrors(prev => ({ ...prev, [instanceKey]: '' }))

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
      // Reverte
      setInstances(prev => ({
        ...prev,
        [instanceKey]: { ...prev[instanceKey], bot_enabled: previous },
      }))
      setBotErrors(prev => ({
        ...prev,
        [instanceKey]: err?.message ?? 'Erro ao salvar',
      }))
    } finally {
      setBotSaving(prev => ({ ...prev, [instanceKey]: false }))
    }
  }, [instances])

  // ── Reiniciar conexão ────────────────────────────────────────────────────
  const [restarting, setRestarting] = useState<Record<string, boolean>>({})

  const restartInstance = useCallback(async (instanceKey: string) => {
    setRestarting(prev => ({ ...prev, [instanceKey]: true }))
    setConnectionStatus(prev => ({ ...prev, [instanceKey]: 'connecting' }))
    try {
      const res = await fetch('/api/whatsapp/restart-instance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instance: instanceKey }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      // Aguarda um momento e re-busca o status
      await new Promise(r => setTimeout(r, 3000))
      const statusRes = await fetch(
        `/api/whatsapp/instance-status?instance=${encodeURIComponent(instanceKey)}`
      )
      const data = await statusRes.json()
      setConnectionStatus(prev => ({ ...prev, [instanceKey]: data?.status ?? 'unknown' }))
    } catch {
      setConnectionStatus(prev => ({ ...prev, [instanceKey]: 'error' }))
    } finally {
      setRestarting(prev => ({ ...prev, [instanceKey]: false }))
    }
  }, [])

  const instanceKeys = Object.keys(instances)

  if (instanceKeys.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-200 py-10 text-center">
        <p className="text-sm text-gray-400">Nenhuma instância configurada.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {instanceKeys.map((key) => {
        const config = instances[key]
        const label = config.label ?? key
        const isConnected = connectionStatus[key] === 'open'
        const isConnecting =
          connectionStatus[key] === 'connecting' ||
          loadingStatus[key] === true ||
          restarting[key] === true
        const status = connectionStatus[key]
        const botEnabled = config.bot_enabled !== false
        const isBotSaving = botSaving[key] === true
        const botError = botErrors[key]

        return (
          <div
            key={key}
            className="group flex flex-col gap-3 rounded-2xl border border-gray-100 bg-white px-5 py-4 shadow-sm transition-shadow hover:shadow-md"
          >
            {/* Linha superior: info da instância + status de conexão */}
            <div className="flex items-center justify-between gap-4">
              {/* Info */}
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-sm font-semibold text-gray-900">
                  {label}
                </span>
                <span className="truncate font-mono text-[11px] text-gray-400">
                  {key}
                </span>
              </div>

              {/* Status de conexão + botão reiniciar */}
              <div className="flex shrink-0 items-center gap-2">
                {/* Badge de status */}
                {isConnecting ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Conectando…
                  </span>
                ) : isConnected ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                    <Wifi className="h-3 w-3" />
                    Conectado
                  </span>
                ) : status === 'error' ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-medium text-red-600">
                    <AlertCircle className="h-3 w-3" />
                    Erro
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-500">
                    <WifiOff className="h-3 w-3" />
                    {status === 'close' ? 'Desconectado' : status ?? 'Desconhecido'}
                  </span>
                )}

                {/* Botão reiniciar */}
                <button
                  onClick={() => restartInstance(key)}
                  disabled={isConnecting}
                  title="Reiniciar instância"
                  className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <RefreshCw
                    className={`h-4 w-4 ${restarting[key] ? 'animate-spin' : ''}`}
                  />
                </button>
              </div>
            </div>

            {/* Divisor */}
            <div className="h-px bg-gray-100" />

            {/* Linha inferior: toggle do bot */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-medium text-gray-700">
                  Bot de triagem
                </span>
                {botError && (
                  <span className="text-[11px] text-red-500">⚠ {botError}</span>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-2.5">
                {/* Badge de estado do bot */}
                <span
                  className={`
                    hidden sm:inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold transition-all duration-200
                    ${botEnabled
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-gray-100 text-gray-500'}
                  `}
                >
                  <span
                    className={`
                      inline-block h-1.5 w-1.5 rounded-full
                      ${botEnabled ? 'animate-pulse bg-emerald-500' : 'bg-gray-400'}
                    `}
                  />
                  {botEnabled ? 'Bot ativo' : 'Bot inativo'}
                </span>

                {/* Switch */}
                <button
                  role="switch"
                  aria-checked={botEnabled}
                  aria-label={`${botEnabled ? 'Desativar' : 'Ativar'} bot para ${label}`}
                  disabled={isBotSaving}
                  onClick={() => toggleBot(key, !botEnabled)}
                  className={`
                    relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full
                    border-2 border-transparent transition-colors duration-200 ease-in-out
                    focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1B556B] focus-visible:ring-offset-2
                    disabled:cursor-not-allowed disabled:opacity-60
                    ${botEnabled ? 'bg-[#1B556B]' : 'bg-gray-200'}
                  `}
                >
                  <span
                    className={`
                      pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-md
                      ring-0 transition-all duration-200 ease-in-out
                      ${botEnabled ? 'translate-x-5' : 'translate-x-0'}
                      ${isBotSaving ? 'opacity-60' : ''}
                    `}
                  />
                  {isBotSaving && (
                    <span className="absolute inset-0 flex items-center justify-center">
                      <svg
                        className="h-3 w-3 animate-spin text-white"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                        />
                      </svg>
                    </span>
                  )}
                </button>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
