// Integração com o Gmail via OAuth2 + API REST — sem instalar o pacote
// "googleapis" (pesado), só chamadas fetch diretas nos endpoints do
// Google. Precisa de GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET
// configurados nas variáveis de ambiente.
//
// NOTA DE INCERTEZA: nunca testei esse fluxo de verdade contra a API
// real do Google nesse ambiente — a API é a que está documentada
// publicamente, mas confirme com o erro exato se algo falhar.

import { createAdminClient } from '@/lib/supabase/admin'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'
const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'

export function getGoogleOAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email',
    access_type: 'offline',
    prompt: 'consent',
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

export async function exchangeCodeForTokens(code: string, redirectUri: string) {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Falha ao trocar código por token: ${text}`)
  }

  return response.json() as Promise<{ access_token: string; refresh_token?: string; expires_in: number; scope?: string }>
}

export async function getGoogleUserEmail(accessToken: string): Promise<string> {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) throw new Error('Falha ao buscar e-mail da conta Google.')
  const data = await response.json()
  return data.email
}

async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; expires_in: number }> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: 'refresh_token',
    }),
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Falha ao renovar o token do Gmail: ${text}`)
  }
  return response.json()
}

// Garante um access_token válido pro usuário — renova sozinho se
// estiver vencido, e já salva o novo token no banco.
export async function getValidAccessToken(userId: string): Promise<{ accessToken: string; fromEmail: string } | null> {
  const supabase = createAdminClient()
  const { data: account } = await supabase.from('email_accounts').select('*').eq('user_id', userId).maybeSingle()
  if (!account) return null

  const isExpired = new Date(account.token_expiry).getTime() < Date.now() + 60_000
  if (!isExpired) return { accessToken: account.access_token, fromEmail: account.email }

  const refreshed = await refreshAccessToken(account.refresh_token)
  const newExpiry = new Date(Date.now() + refreshed.expires_in * 1000).toISOString()

  await supabase.from('email_accounts').update({ access_token: refreshed.access_token, token_expiry: newExpiry }).eq('user_id', userId)

  return { accessToken: refreshed.access_token, fromEmail: account.email }
}

// Monta o e-mail em formato MIME e manda pela API do Gmail — SAI DA
// CAIXA DA PESSOA de verdade (não de um servidor terceiro), fica salvo
// nos "Enviados" dela também.
export async function sendGmailMessage({
  accessToken,
  to,
  cc,
  bcc,
  replyTo,
  subject,
  htmlBody,
}: {
  accessToken: string
  to: string
  cc?: string
  bcc?: string
  replyTo?: string
  subject: string
  htmlBody: string
}): Promise<{ messageId: string }> {
  const mimeMessage = [
    `To: ${to}`,
    cc ? `Cc: ${cc}` : null,
    bcc ? `Bcc: ${bcc}` : null,
    replyTo ? `Reply-To: ${replyTo}` : null,
    `Subject: =?UTF-8?B?${Buffer.from(subject, 'utf-8').toString('base64')}?=`,
    'Content-Type: text/html; charset="UTF-8"',
    'MIME-Version: 1.0',
    '',
    htmlBody,
  ]
    .filter((line): line is string => line !== null)
    .join('\r\n')

  const encodedMessage = Buffer.from(mimeMessage)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

  const response = await fetch(GMAIL_SEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: encodedMessage }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Falha ao enviar e-mail pelo Gmail: ${text}`)
  }

  const data = await response.json()
  return { messageId: data.id }
}
