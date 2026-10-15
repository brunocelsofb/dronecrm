'use client'

import { useState } from 'react'
import { updateInboundEmailSettings } from '@/lib/actions/settings'

const WEBHOOK_URL = 'https://crm-gestaocontratos-pi.vercel.app/api/email-inbound/mailgun'

export function InboundEmailSettingsForm({
  currentDomain,
  hasSigningKey,
}: {
  currentDomain: string
  hasSigningKey: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showSteps, setShowSteps] = useState(false)

  const isSandbox = currentDomain.includes('sandbox') && currentDomain.includes('mailgun')
  const isConfigured = !!currentDomain && !isSandbox

  async function handleSave(formData: FormData) {
    setBusy(true); setSaved(false); setError(null)
    const result = await updateInboundEmailSettings(formData)
    setBusy(false)
    if (result.error) setError(result.error)
    else setSaved(true)
  }

  const inputStyle = { width: '100%', padding: '7px 10px', fontSize: 12, borderRadius: 8, border: '0.5px solid #d1d8e8', background: '#f8f9fb', color: '#1a1f36', outline: 'none' }
  const labelStyle: React.CSSProperties = { display: 'block', fontSize: 10, color: '#8892a4', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 4 }

  return (
    <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #e8edf5', padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <p style={{ fontSize: 13, fontWeight: 500, color: '#1a1f36', margin: 0 }}>📥 Recebimento de e-mail</p>
          <p style={{ fontSize: 11, color: '#8892a4', marginTop: 3 }}>
            Cada oportunidade ganha um endereço exclusivo — respostas do cliente caem automaticamente no CRM.
          </p>
        </div>
        <span style={{
          padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 500,
          background: isConfigured ? '#e3f5f1' : isSandbox ? '#fbeee5' : '#f6e9ea',
          color: isConfigured ? '#1f8c7d' : isSandbox ? '#c2683d' : '#8e4550'
        }}>
          {isConfigured ? '✅ Configurado' : isSandbox ? '⚠ Sandbox (só envia)' : '❌ Não configurado'}
        </span>
      </div>

      {/* Alerta de sandbox */}
      {isSandbox && (
        <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, background: '#fbeee5', border: '0.5px solid #ffe596', fontSize: 12, color: '#c2683d' }}>
          <strong>Por que as respostas não chegam ao CRM:</strong> o domínio atual é um sandbox do Mailgun (<code style={{ fontSize: 11 }}>{currentDomain}</code>). O sandbox <strong>não suporta recebimento</strong> — só envio. Para receber respostas dos clientes é obrigatório usar um domínio próprio verificado.
        </div>
      )}

      {/* Passo a passo */}
      <button onClick={() => setShowSteps(s => !s)}
        style={{ fontSize: 12, color: '#1b556b', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 16 }}>
        {showSteps ? '▲ Ocultar' : '▼ Ver'} como configurar passo a passo
      </button>

      {showSteps && (
        <div style={{ marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            { n: 1, title: 'Ter um domínio próprio', desc: 'Ex: orbis.com.br — precisa ter acesso ao painel DNS do domínio (Registro.br, Cloudflare, etc.).' },
            { n: 2, title: 'Criar conta no Mailgun', desc: 'mailgun.com → Add Domain → use um subdomínio: mail.orbis.com.br (não use o domínio principal).' },
            { n: 3, title: 'Adicionar registros DNS', desc: 'O Mailgun mostra os registros MX, SPF e DKIM. Copie e adicione no painel DNS do seu domínio. Aguarde verificação (pode levar até 24h).' },
            { n: 4, title: 'Configurar o webhook de recebimento', desc: `No Mailgun → Receiving → Create Route → escolha "Match Recipient" com * → Action: Forward → cole a URL abaixo:`, extra: WEBHOOK_URL },
            { n: 5, title: 'Copiar a chave de assinatura', desc: 'No Mailgun → API Keys → HTTP webhook signing key → copie e cole no campo abaixo.' },
            { n: 6, title: 'Preencher e salvar', desc: 'Coloque o subdomínio (mail.orbis.com.br) e a chave nos campos abaixo e salve. A partir daí, respostas dos clientes caem no CRM.' },
          ].map(step => (
            <div key={step.n} style={{ display: 'flex', gap: 12 }}>
              <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#1a1f36', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, flexShrink: 0 }}>
                {step.n}
              </div>
              <div>
                <p style={{ fontSize: 12, fontWeight: 500, color: '#1a1f36', margin: 0 }}>{step.title}</p>
                <p style={{ fontSize: 11, color: '#52514e', marginTop: 2 }}>{step.desc}</p>
                {step.extra && (
                  <code style={{ display: 'block', marginTop: 4, padding: '4px 8px', borderRadius: 6, background: '#f1f3f8', fontSize: 11, color: '#524e9c', wordBreak: 'break-all' }}>
                    {step.extra}
                  </code>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Formulário */}
      <form action={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={labelStyle}>Subdomínio de recebimento (Mailgun)</label>
          <input name="inbound_email_domain" defaultValue={currentDomain}
            placeholder="mail.orbis.com.br" style={inputStyle} />
          <p style={{ fontSize: 10, color: '#b0b8c8', marginTop: 4 }}>
            Exemplo: mail.orbis.com.br — NÃO use o sandbox do Mailgun aqui.
          </p>
        </div>
        <div>
          <label style={labelStyle}>Chave de assinatura do Mailgun (HTTP webhook signing key)</label>
          <input name="mailgun_webhook_signing_key" type="password"
            placeholder={hasSigningKey ? '••••••••••••••••' : 'Cole a chave do Mailgun → API Keys → HTTP webhook signing key'}
            style={inputStyle} />
          <p style={{ fontSize: 10, color: '#b0b8c8', marginTop: 4 }}>
            {hasSigningKey ? '✅ Chave salva.' : '⚠ Sem isso, o CRM aceita qualquer e-mail sem verificar autenticidade.'}
          </p>
        </div>

        {error && <p style={{ fontSize: 12, color: '#8e4550' }}>{error}</p>}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button type="submit" disabled={busy}
            style={{ padding: '8px 20px', fontSize: 13, fontWeight: 500, borderRadius: 8, border: 'none', background: '#1a1f36', color: '#fff', cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1 }}>
            {busy ? 'Salvando...' : 'Salvar configuração'}
          </button>
          {saved && <span style={{ fontSize: 12, color: '#1f8c7d' }}>✅ Salvo</span>}
        </div>
      </form>
    </div>
  )
}
