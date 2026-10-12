'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { disconnectEmailAccount, connectSmtpAccount } from '@/lib/actions/email'

export function EmailConnectionSettings({
  connectedEmail,
  connectedAt,
  connectionType,
}: {
  connectedEmail: string | null
  connectedAt: string | null
  connectionType: string | null
}) {
  const searchParams = useSearchParams()
  const justConnected = searchParams.get('email_connected') === '1'
  const oauthError = searchParams.get('email_error')
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<'gmail' | 'smtp'>('gmail')
  const [smtpError, setSmtpError] = useState<string | null>(null)

  async function handleDisconnect() {
    if (!confirm('Desconectar seu e-mail? Você não vai conseguir enviar e-mails pelo CRM até conectar de novo.')) return
    setBusy(true)
    await disconnectEmailAccount()
    setBusy(false)
    window.location.reload()
  }

  async function handleConnectSmtp(formData: FormData) {
    setBusy(true)
    setSmtpError(null)
    const result = await connectSmtpAccount(formData)
    setBusy(false)
    if (result.error) setSmtpError(result.error)
    else window.location.reload()
  }

  return (
    <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-6">
      <div>
        <h3 className="text-sm font-medium text-gray-900">📧 E-mail</h3>
        <p className="mt-0.5 text-xs text-gray-400">
          Conecte seu e-mail pra enviar direto do CRM — o envio sai da SUA caixa de verdade, fica salvo nos seus Enviados também.
        </p>
      </div>

      {justConnected && <p className="rounded-md bg-positive-100 px-3 py-2 text-sm text-positive-700">✅ Conectado com sucesso!</p>}
      {oauthError && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">Falha ao conectar: {oauthError}</p>}

      {connectedEmail ? (
        <div className="flex items-center justify-between rounded-md bg-gray-50 px-3 py-2">
          <div>
            <p className="text-sm font-medium text-gray-900">{connectedEmail}</p>
            <p className="text-xs text-gray-400">
              {connectionType === 'smtp' ? 'Via SMTP' : 'Via Gmail'} · Conectado {connectedAt ? `em ${new Date(connectedAt).toLocaleDateString('pt-BR')}` : ''}
            </p>
          </div>
          <button onClick={handleDisconnect} disabled={busy} className="text-xs text-negative-600 hover:underline disabled:opacity-50">
            {busy ? 'Desconectando...' : 'Desconectar'}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-2">
            <button
              onClick={() => setMode('gmail')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${mode === 'gmail' ? 'bg-brand-700 text-white' : 'border border-gray-300 text-gray-700'}`}
            >
              Gmail (recomendado)
            </button>
            <button
              onClick={() => setMode('smtp')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${mode === 'smtp' ? 'bg-brand-700 text-white' : 'border border-gray-300 text-gray-700'}`}
            >
              SMTP (outro provedor)
            </button>
          </div>

          {mode === 'gmail' ? (
            <a href="/api/auth/google/connect" className="inline-block rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800">
              Conectar meu Gmail
            </a>
          ) : (
            <form action={handleConnectSmtp} className="space-y-2 rounded-md border border-gray-200 bg-gray-50 p-3">
              {/* Guia rápido por provedor */}
              <details className="rounded-md border border-blue-100 bg-blue-50 p-2">
                <summary className="cursor-pointer text-xs font-medium text-blue-700">📋 Configurações por provedor (Outlook, Hotmail, corporativo…)</summary>
                <div className="mt-2 space-y-2 text-xs text-gray-700">
                  <div className="rounded border border-gray-200 bg-white p-2">
                    <p className="font-semibold text-gray-800">Outlook / Hotmail / Microsoft 365</p>
                    <p>Servidor: <code className="rounded bg-gray-100 px-1">smtp.office365.com</code></p>
                    <p>Porta: <code className="rounded bg-gray-100 px-1">587</code> · SSL/TLS: <strong>desmarcado</strong> (usa STARTTLS)</p>
                    <p>Usuário: seu e-mail completo · Senha: sua senha normal</p>
                  </div>
                  <div className="rounded border border-gray-200 bg-white p-2">
                    <p className="font-semibold text-gray-800">Gmail via SMTP (alternativa ao OAuth)</p>
                    <p>Servidor: <code className="rounded bg-gray-100 px-1">smtp.gmail.com</code></p>
                    <p>Porta: <code className="rounded bg-gray-100 px-1">587</code> · SSL/TLS: <strong>desmarcado</strong></p>
                    <p>Usuário: seu Gmail · Senha: <strong>senha de app</strong> (não a senha normal)</p>
                    <p className="mt-1 text-gray-500">Gere a senha de app em: <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" className="text-blue-600 underline">myaccount.google.com/apppasswords</a></p>
                  </div>
                  <div className="rounded border border-gray-200 bg-white p-2">
                    <p className="font-semibold text-gray-800">E-mail corporativo próprio</p>
                    <p>Peça ao seu administrador de TI: servidor SMTP, porta e se usa SSL.</p>
                    <p className="text-gray-500">Geralmente: porta <code className="rounded bg-gray-100 px-1">465</code> com SSL marcado, ou <code className="rounded bg-gray-100 px-1">587</code> sem SSL.</p>
                  </div>
                </div>
              </details>
              <div>
                <label className="block text-xs text-gray-500">Seu e-mail</label>
                <input name="email" type="email" required className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-gray-500">Servidor SMTP</label>
                  <input name="smtp_host" required placeholder="smtp.exemplo.com" className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500">Porta</label>
                  <input name="smtp_port" type="number" required defaultValue="587" className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500">Usuário</label>
                <input name="smtp_username" required className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none" />
              </div>
              <div>
                <label className="block text-xs text-gray-500">Senha (ou senha de app)</label>
                <input name="smtp_password" type="password" required className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none" />
              </div>
              <label className="flex items-center gap-2 text-xs text-gray-600">
                <input type="checkbox" name="smtp_secure" defaultChecked className="rounded border-gray-300" />
                Conexão segura (SSL/TLS) — desmarque só se seu provedor pedir explicitamente
              </label>
              {smtpError && <p className="text-xs text-red-600">{smtpError}</p>}
              <button type="submit" disabled={busy} className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">
                {busy ? 'Testando conexão...' : 'Conectar via SMTP'}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  )
}
