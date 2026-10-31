// Conexão via SMTP — alternativa ao Gmail OAuth, funciona com
// qualquer provedor (Outlook, e-mail corporativo próprio, etc). Usa
// nodemailer.
//
// NOTA DE INCERTEZA: nunca testei isso contra um servidor SMTP real
// nesse ambiente. A biblioteca (nodemailer) é bem estabelecida, mas
// confirme com a mensagem de erro exata se a conexão falhar.
//
// NOTA DE SEGURANÇA: a senha SMTP fica salva cifrada (AES-256-GCM com
// SETTINGS_ENCRYPTION_KEY, ver lib/actions/email.ts e lib/email/send.ts);
// só o servidor abre na hora de enviar.

import nodemailer from 'nodemailer'

export async function verifySmtpConnection(config: {
  host: string
  port: number
  username: string
  password: string
  secure: boolean
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.username, pass: config.password },
    })
    await transporter.verify()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Falha ao conectar no servidor SMTP.' }
  }
}

export async function sendSmtpMessage({
  config,
  fromEmail,
  to,
  cc,
  bcc,
  replyTo,
  subject,
  htmlBody,
}: {
  config: { host: string; port: number; username: string; password: string; secure: boolean }
  fromEmail: string
  to: string
  cc?: string
  bcc?: string
  replyTo?: string
  subject: string
  htmlBody: string
}): Promise<{ messageId: string }> {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.username, pass: config.password },
  })

  const info = await transporter.sendMail({
    from: fromEmail,
    to,
    cc: cc || undefined,
    bcc: bcc || undefined,
    replyTo: replyTo || undefined,
    subject,
    html: htmlBody,
  })

  return { messageId: info.messageId }
}
