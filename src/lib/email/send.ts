// Ponto único de envio de e-mail — decide sozinho se usa Gmail (OAuth)
// ou SMTP, dependendo de como a pessoa conectou a conta.

import { createAdminClient } from '@/lib/supabase/admin'
import { getValidAccessToken, sendGmailMessage } from '@/lib/email/gmail'
import { sendSmtpMessage } from '@/lib/email/smtp'
import { decryptSecret, encryptSecret } from '@/lib/ai/tenant-key'

// Senha SMTP: guardada cifrada ("v1:…"). Senha antiga em texto puro ainda funciona e
// é cifrada na primeira vez que for usada.
async function openSmtpPassword(db: ReturnType<typeof createAdminClient>, userId: string, stored: string): Promise<string> {
  if (/^v1:[^:]+:[^:]+:[^:]+$/.test(stored)) {
    try { return decryptSecret(stored) } catch { /* não era cifrada: segue como texto */ }
  }
  try { await db.from('email_accounts').update({ smtp_password: encryptSecret(stored) }).eq('user_id', userId) } catch { /* tenta de novo no próximo envio */ }
  return stored
}

export type EmailAccountInfo = { connectionType: 'oauth_google' | 'smtp'; fromEmail: string }

// Envolve o corpo + assinatura com um tamanho de fonte e fonte
// explícitos — sem isso, cada cliente de e-mail (Gmail, Outlook,
// etc.) aplica o próprio padrão, que costuma sair pequeno demais.
export function wrapEmailHtml(body: string, signature: string | null, trackingPixelHtml: string): string {
  // Se o body já contém tags HTML, usamos diretamente (não fazemos escape).
  // Se é texto puro, convertemos \n em <br> para preservar parágrafos.
  const looksLikeHtml = /<[a-z][\s\S]*>/i.test(body)
  const htmlBody = looksLikeHtml
    ? body
    : body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r\n|\r|\n/g, '<br>')
  const signatureBlock = signature
    ? `<br><br><div style="font-size: 13px; color: #444;">${signature}</div>`
    : ''
  return `<div style="font-family: Arial, Helvetica, sans-serif; font-size: 15px; line-height: 1.6; color: #1a1a1a;">${htmlBody}${signatureBlock}</div>${trackingPixelHtml}`
}

export async function getEmailAccountInfo(userId: string): Promise<EmailAccountInfo | null> {
  const supabase = createAdminClient()
  const { data: account } = await supabase.from('email_accounts').select('connection_type, email').eq('user_id', userId).maybeSingle()
  if (!account) return null
  return { connectionType: account.connection_type, fromEmail: account.email }
}

export async function sendEmailForUser(
  userId: string,
  to: string,
  subject: string,
  htmlBody: string,
  options?: { cc?: string; bcc?: string; replyTo?: string }
): Promise<{ messageId: string; fromEmail: string }> {
  const supabase = createAdminClient()
  const { data: account } = await supabase.from('email_accounts').select('*').eq('user_id', userId).maybeSingle()
  if (!account) throw new Error('Conta de e-mail não conectada.')

  if (account.connection_type === 'smtp') {
    if (!account.smtp_host || !account.smtp_port || !account.smtp_username || !account.smtp_password) {
      throw new Error('Configuração SMTP incompleta.')
    }
    const result = await sendSmtpMessage({
      config: {
        host: account.smtp_host,
        port: account.smtp_port,
        username: account.smtp_username,
        password: await openSmtpPassword(supabase, userId, account.smtp_password),
        secure: account.smtp_secure,
      },
      fromEmail: account.email,
      to,
      cc: options?.cc,
      bcc: options?.bcc,
      replyTo: options?.replyTo,
      subject,
      htmlBody,
    })
    return { messageId: result.messageId, fromEmail: account.email }
  }

  const oauthAccount = await getValidAccessToken(userId)
  if (!oauthAccount) throw new Error('Conta Gmail não conectada ou token inválido.')
  const result = await sendGmailMessage({
    accessToken: oauthAccount.accessToken,
    to,
    cc: options?.cc,
    bcc: options?.bcc,
    replyTo: options?.replyTo,
    subject,
    htmlBody,
  })
  return { messageId: result.messageId, fromEmail: oauthAccount.fromEmail }
}
