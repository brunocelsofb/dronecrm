import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveTenantId } from '@/lib/tenant/context'

// Recebe e-mails de entrada roteados pelo Mailgun ("Routes") — extrai
// o código único do destinatário (parte antes do @) e vincula ao
// contrato certo.
//
// NOTA DE INCERTEZA: nunca testei isso contra o Mailgun de verdade —
// não temos domínio configurado ainda (decisão consciente). O formato
// do payload é o documentado publicamente em 2026, mas PRECISA ser
// validado com um teste real assim que houver domínio.
//
// Se decidirem usar outro provedor (SendGrid Inbound Parse, Postmark)
// no lugar do Mailgun, essa rota precisa de uma versão equivalente.

function verifyMailgunSignature(timestamp: string, token: string, signature: string, signingKey: string): boolean {
  const hmac = crypto.createHmac('sha256', signingKey).update(timestamp + token).digest('hex')
  return hmac === signature
}

export async function POST(request: Request) {
  const supabase = createAdminClient()

  const contentType = request.headers.get('content-type') ?? ''
  let fields: Record<string, string> = {}

  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData()
    for (const [key, value] of formData.entries()) {
      if (typeof value === 'string') fields[key] = value
    }
  } else {
    const text = await request.text()
    fields = Object.fromEntries(new URLSearchParams(text))
  }

  const { data: settings } = await supabase.from('organization_settings').select('mailgun_webhook_signing_key').eq('tenant_id', await resolveTenantId()).maybeSingle()
  if (settings?.mailgun_webhook_signing_key && fields.timestamp && fields.token && fields.signature) {
    const valid = verifyMailgunSignature(fields.timestamp, fields.token, fields.signature, settings.mailgun_webhook_signing_key)
    if (!valid) {
      return NextResponse.json({ error: 'Assinatura inválida.' }, { status: 401 })
    }
  }

  const recipient = fields.recipient ?? ''
  const code = recipient.split('@')[0]?.trim()
  const sender = fields.sender ?? fields.from ?? ''
  const subject = fields.subject ?? '(sem assunto)'
  const bodyHtml = fields['stripped-html'] || fields['body-html'] || `<p>${(fields['stripped-text'] || fields['body-plain'] || '').replace(/\n/g, '<br>')}</p>`

  if (!code) {
    return NextResponse.json({ error: 'Destinatário sem código.' }, { status: 400 })
  }

  const { data: contract } = await supabase.from('contracts').select('id, client_name').eq('inbound_email_code', code).maybeSingle()
  if (!contract) {
    return NextResponse.json({ ok: true, matched: false })
  }

  const { data: knownAccount } = await supabase.from('email_accounts').select('id').eq('email', sender).maybeSingle()
  const direction = knownAccount ? 'enviado' : 'recebido'

  await supabase.from('contract_emails').insert({
    contract_id: contract.id,
    from_email: sender,
    to_email: recipient,
    subject,
    body: bodyHtml,
    status: 'enviado',
    direction,
    triggered_automatically: false,
  })

  await supabase.from('activities').insert({
    contract_id: contract.id,
    type: 'email',
    content: direction === 'recebido' ? `E-mail recebido de ${sender}: "${subject}".` : `Cópia de e-mail enviado por fora do CRM registrada: "${subject}".`,
    metadata: { kind: direction === 'recebido' ? 'received' : 'sent', subject, from_email: sender, to_email: recipient, body: bodyHtml },
  })

  return NextResponse.json({ ok: true, matched: true })
}
