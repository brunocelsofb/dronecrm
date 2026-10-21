'use client'

import { useState } from 'react'
import { connectEvo, disconnectEvo, getEvoQrCodeAction, configureEvoWebhook } from '@/lib/actions/whatsapp'

type Props = {
  isConnected: boolean
  currentServerUrl: string | null
  currentInstanceName: string | null
  usesPlatformServer?: boolean   // servidor da plataforma: empresa só dá nome e lê o QR
  limitInfo?: string | null
}

export function WhatsAppSettingsForm({ isConnected, currentServerUrl, currentInstanceName, usesPlatformServer = false, limitInfo = null }: Props) {
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [loadingQr, setLoadingQr] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [formState, setFormState] = useState<{ error?: string } | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)

  async function handleGetQr(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    setLoadingQr(true); setQrCode(null); setStatus(null); setFormState(null)

    // Salva credenciais primeiro (instância privada não é salva como principal)
    const res = await connectEvo(fd)
    setFormState(res)
    if (res.error) { setLoadingQr(false); return }
    const isPrivate = res.privateInstance === true

    // Nome final (empresas no servidor compartilhado ganham prefixo)
    const instance = (res.instanceName as string | undefined) ?? (fd.get('evo_instance_name') as string).trim()
    fd.set('evo_instance_name', instance)

    try {
    // Busca QR Code via Server Action (evita CORS)
    const data = await getEvoQrCodeAction(fd)
    console.log('[evo qr] resposta:', data)
    if (data.error) setStatus(`❌ ${data.error}`)
    else if (data.base64) {
      setQrCode(data.base64)
      if (isPrivate) setStatus(`🔒 Instância privada "${instance}": só envio do briefing. Não vira a instância principal do CRM e nenhuma mensagem dela entra no CRM.`)
    }
    else if (data.status) setStatus(data.status)
    else setStatus('QR Code não disponível. Verifique se a instância está desconectada.')
    } catch (e: any) {
      setStatus(`Erro ao buscar QR Code: ${e.message}`)
    }
    setLoadingQr(false)
  }

  async function handleDisconnect() {
    if (!confirm('Desconectar o WhatsApp? O bot deixará de funcionar.')) return
    setDisconnecting(true)
    await disconnectEvo()
    setDisconnecting(false)
    window.location.reload()
  }

  return (
    <div className="space-y-6">
      {/* Status atual */}
      {isConnected && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-green-800">✅ WhatsApp conectado via Evolution API</p>
            <p className="text-xs text-green-600 mt-0.5">{usesPlatformServer ? 'principal' : currentServerUrl} · instância: {currentInstanceName}</p>
          </div>
          <button onClick={handleDisconnect} disabled={disconnecting}
            className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50">
            {disconnecting ? 'Desconectando...' : 'Desconectar'}
          </button>
        </div>
      )}

      {/* Formulário de configuração */}
      <form onSubmit={handleGetQr} className="space-y-4 rounded-xl border border-gray-200 bg-white p-6">
        <h3 className="text-sm font-semibold text-[#1B556B]">{usesPlatformServer ? 'Conectar um WhatsApp' : 'Configurações da Evolution API'}</h3>
        {usesPlatformServer && (
          <p className="text-xs text-gray-500">Dê um nome, clique em obter QR Code e leia com o WhatsApp do número. {limitInfo}</p>
        )}

{!usesPlatformServer && (
        <>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Server URL *</label>
          <input name="evo_server_url" required
            defaultValue={currentServerUrl ?? 'https://beautiful-energy-production-24fa.up.railway.app'}
            placeholder="https://seu-servidor.railway.app"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#1B556B] focus:outline-none" />
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">API Key (Global) *</label>
          <input name="evo_api_key" required type="password"
            placeholder="Sua AUTHENTICATION_API_KEY"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#1B556B] focus:outline-none" />
          <p className="mt-1 text-xs text-gray-400">Configure como variável de ambiente AUTHENTICATION_API_KEY no Railway.</p>
        </div>

        </>
        )}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">{usesPlatformServer ? 'Nome deste WhatsApp *' : 'Instance Name *'}</label>
          <input name="evo_instance_name" required
            defaultValue={usesPlatformServer ? '' : (currentInstanceName ?? 'drone_whatsapp')}
            placeholder={usesPlatformServer ? 'ex.: comercial, atendimento' : 'drone_whatsapp'}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#1B556B] focus:outline-none" />
        </div>

        <label className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 cursor-pointer">
          <input type="checkbox" name="evo_private" className="mt-0.5 h-4 w-4 accent-[#1B556B]" />
          <span className="text-sm text-gray-700">
            <span className="font-semibold">🔒 Instância privada</span>
            <span className="block text-xs text-gray-500 mt-0.5">
              Só para envio (ex.: briefing no seu WhatsApp pessoal). Não vira a instância principal,
              não recebe webhook e nenhuma mensagem dela entra no CRM. Pode ser desfeito depois na lista abaixo.
            </span>
          </span>
        </label>

        {formState?.error && (
          <p className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{formState.error}</p>
        )}

        <div className="flex gap-3">
          <button type="submit" disabled={loadingQr}
            className="rounded-lg bg-[#1B556B] px-5 py-2 text-sm font-semibold text-white hover:bg-[#164659] disabled:opacity-50">
            {loadingQr ? 'Conectando...' : '📱 Salvar e obter QR Code'}
          </button>
        </div>
      </form>

      {/* QR Code */}
      {qrCode && (
        <div className="rounded-xl border border-gray-200 bg-white p-6 text-center space-y-3">
          <p className="text-sm font-semibold text-[#1B556B]">Escaneie o QR Code com seu WhatsApp</p>
          <p className="text-xs text-gray-500">Abra o WhatsApp → Dispositivos vinculados → Vincular um dispositivo</p>
          <img src={qrCode.startsWith('data:') ? qrCode : `data:image/png;base64,${qrCode}`}
            alt="QR Code WhatsApp" className="mx-auto max-w-xs rounded-lg border" />
          <p className="text-xs text-gray-400">O QR Code expira em ~60 segundos. Recarregue se expirar.</p>
        </div>
      )}

      {status && (
        <p className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-sm text-blue-700">{status}</p>
      )}

      {/* Instrução de webhook */}
      <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 space-y-3">
        <p className="text-xs font-semibold text-gray-600">Webhook configurado automaticamente</p>
        <p className="text-xs text-gray-500">Cada número recebe um endereço com chave própria. Se as mensagens recebidas pararem de chegar, use o botão abaixo.</p>
        <button
          type="button"
          onClick={async () => {
            const res = await configureEvoWebhook()
            setStatus(res.error ? `❌ ${res.error}` : '✅ Webhook configurado com sucesso!')
          }}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          🔗 Reconfigurar webhook
        </button>
      </div>
    </div>
  )
}
