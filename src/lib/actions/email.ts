'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmailForUser, getEmailAccountInfo, wrapEmailHtml } from '@/lib/email/send'
import { verifySmtpConnection } from '@/lib/email/smtp'

export type ActionState = { error?: string }

export async function getConnectedEmailAccount(): Promise<{ email: string; connectedAt: string; connectionType: string } | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase.from('email_accounts').select('email, connected_at, connection_type').eq('user_id', user.id).maybeSingle()
  return data ? { email: data.email, connectedAt: data.connected_at, connectionType: data.connection_type } : null
}

// ------------------------------------------------------------
// Conexão via SMTP — alternativa ao Gmail, pra quem usa outro
// provedor de e-mail (Outlook, corporativo próprio, etc).
// ------------------------------------------------------------
export async function connectSmtpAccount(formData: FormData): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Usuário não autenticado.' }

  const email = (formData.get('email') as string)?.trim()
  const host = (formData.get('smtp_host') as string)?.trim()
  const port = Number(formData.get('smtp_port'))
  const username = (formData.get('smtp_username') as string)?.trim()
  const password = (formData.get('smtp_password') as string)
  const secure = formData.get('smtp_secure') === 'on'

  if (!email || !host || !port || !username || !password) {
    return { error: 'Preencha todos os campos (e-mail, servidor, porta, usuário e senha).' }
  }

  // Testa a conexão ANTES de salvar — evita salvar uma configuração
  // que não funciona e só descobrir isso na hora de mandar de verdade.
  const verify = await verifySmtpConnection({ host, port, username, password, secure })
  if (!verify.ok) return { error: `Não consegui conectar: ${verify.error}` }

  const adminClient = createAdminClient()

  // Busca o tenant_id do perfil — obrigatório pelo trigger set_tenant_id()
  const { data: profile } = await adminClient.from('profiles').select('tenant_id').eq('id', user.id).maybeSingle()
  if (!profile?.tenant_id) return { error: 'Perfil do utilizador não encontrado. Contacte o administrador.' }

  const { error } = await adminClient.from('email_accounts').upsert(
    {
      user_id:      user.id,
      tenant_id:    profile.tenant_id,
      email,
      connection_type: 'smtp',
      smtp_host:    host,
      smtp_port:    port,
      smtp_username: username,
      smtp_password: password,
      smtp_secure:  secure,
      connected_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  )
  if (error) return { error: error.message }

  revalidatePath('/minha-conta')
  return {}
}

export async function disconnectEmailAccount(): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Usuário não autenticado.' }

  await supabase.from('email_accounts').delete().eq('user_id', user.id)
  revalidatePath('/settings')
  revalidatePath('/minha-conta')
  return {}
}

// ------------------------------------------------------------
// Assinatura de e-mail — pessoal, cada usuário tem a sua, anexada
// automaticamente no fim de todo e-mail que a pessoa enviar.
// ------------------------------------------------------------
export async function getEmailSignature(): Promise<string> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return ''

  const { data } = await supabase.from('profiles').select('email_signature').eq('id', user.id).maybeSingle()
  return data?.email_signature ?? ''
}

export async function updateEmailSignature(signature: string): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Usuário não autenticado.' }

  const { error } = await supabase.from('profiles').update({ email_signature: signature }).eq('id', user.id)
  if (error) return { error: error.message }
  revalidatePath('/minha-conta')
  return {}
}

// ------------------------------------------------------------
// Templates de e-mail
// ------------------------------------------------------------
export async function createEmailTemplate(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Usuário não autenticado.' }

  const name = (formData.get('name') as string)?.trim()
  const subject = (formData.get('subject') as string)?.trim() || null
  const body = (formData.get('body') as string)?.trim()
  const context = (formData.get('context') as string) || 'contract'
  const channel = (formData.get('channel') as string) || 'email'
  const trigger_stage_id = (formData.get('trigger_stage_id') as string) || null

  if (!name || !body) return { error: 'Preencha nome e corpo da mensagem.' }
  if (channel === 'email' && !subject) return { error: 'Preencha o assunto do e-mail.' }

  const { error } = await supabase.from('email_templates').insert({ name, subject, body, context, channel, trigger_stage_id, created_by: user.id })
  if (error) return { error: error.message }

  revalidatePath('/email-templates')
  return {}
}

export async function deleteEmailTemplate(templateId: string) {
  const supabase = createAdminClient()
  await supabase.from('email_templates').delete().eq('id', templateId)
  revalidatePath('/email-templates')
}

function fillTemplateVariables(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '')
}

// ------------------------------------------------------------
// Envio de e-mail — manual ou automático. Sempre pela conta Gmail de
// quem enviou — se não tiver conectado, não tem como enviar.
// ------------------------------------------------------------
export async function sendContractEmail(
  contractId: string,
  toEmail: string,
  subject: string,
  body: string,
  templateId: string | null,
  ccEmail: string | null,
  bccEmail: string | null
): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Usuário não autenticado.' }

  if (!toEmail) return { error: 'Informe o e-mail do destinatário.' }

  const accountInfo = await getEmailAccountInfo(user.id)
  if (!accountInfo) {
    return { error: 'Você ainda não conectou nenhum e-mail (Gmail ou SMTP). Vá em Minha Conta e conecte antes de enviar.' }
  }

  const { data: profile } = await supabase.from('profiles').select('email_signature').eq('id', user.id).maybeSingle()

  // Reply-To pro endereço exclusivo da conta — é ISSO que faz a
  // resposta do cliente cair automaticamente no CRM (não é CC nem
  // CCO, que não seguem numa resposta). Inclui TAMBÉM o e-mail real de
  // quem mandou, separado por vírgula — sem isso, a resposta ia SÓ
  // pro endereço de rastreamento, sumindo da caixa pessoal de quem
  // enviou (Reply-To substitui, não soma, então precisa listar os dois).
  const { data: contractForReply } = await supabase.from('contracts').select('inbound_email_code').eq('id', contractId).maybeSingle()
  const { data: orgSettings } = await supabase.from('organization_settings').select('inbound_email_domain').eq('id', 'default').maybeSingle()
  const trackingAddress =
    orgSettings?.inbound_email_domain && contractForReply?.inbound_email_code
      ? `${contractForReply.inbound_email_code}@${orgSettings.inbound_email_domain}`
      : null
  const { data: senderAccount } = await supabase.from('email_accounts').select('email').eq('user_id', user.id).maybeSingle()
  const replyTo = trackingAddress
    ? senderAccount?.email
      ? `${senderAccount.email}, ${trackingAddress}`
      : trackingAddress
    : undefined

  // Cria o registro ANTES de enviar, pra já ter o token do pixel de
  // rastreamento de abertura embutido no corpo do e-mail.
  const trackingToken = crypto.randomUUID()
  const trackingPixelUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://crm-gestaocontratos-pi.vercel.app'}/api/email-track/${trackingToken}`
  const trackingPixelHtml = `<img src="${trackingPixelUrl}" width="1" height="1" style="display:none" alt="" />`
  const bodyWithExtras = wrapEmailHtml(body, profile?.email_signature ?? null, trackingPixelHtml)

  try {
    const result = await sendEmailForUser(user.id, toEmail, subject, bodyWithExtras, { cc: ccEmail ?? undefined, bcc: bccEmail ?? undefined, replyTo })

    await supabase.from('contract_emails').insert({
      contract_id: contractId,
      sent_by: user.id,
      from_email: result.fromEmail,
      to_email: toEmail,
      cc_email: ccEmail,
      bcc_email: bccEmail,
      subject,
      body,
      template_id: templateId,
      triggered_automatically: false,
      gmail_message_id: result.messageId,
      status: 'enviado',
      tracking_token: trackingToken,
    })

    await supabase.from('activities').insert({
      contract_id: contractId,
      user_id: user.id,
      type: 'email',
      content: `E-mail enviado pra ${toEmail}: "${subject}".`,
      metadata: { kind: 'sent', subject, from_email: result.fromEmail, to_email: toEmail, body },
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Falha ao enviar e-mail.'
    await supabase.from('contract_emails').insert({
      contract_id: contractId,
      sent_by: user.id,
      from_email: accountInfo.fromEmail,
      to_email: toEmail,
      subject,
      body,
      template_id: templateId,
      status: 'falhou',
      error_message: message,
    })
    return { error: message }
  }

  revalidatePath(`/contracts/${contractId}`)
  return {}
}

export async function buildEmailFromTemplate(
  templateId: string,
  contractId: string
): Promise<{ subject: string; body: string; toEmail: string | null } | null> {
  const supabase = createAdminClient()

  const { data: template } = await supabase.from('email_templates').select('subject, body').eq('id', templateId).maybeSingle()
  if (!template) return null

  const { data: contract } = await supabase.from('contracts').select('*').eq('id', contractId).maybeSingle()
  if (!contract) return null

  const { data: company } = contract.company_id
    ? await supabase.from('companies').select('name, trade_name, cnpj').eq('id', contract.company_id).maybeSingle()
    : { data: null }
  const { data: contact } = contract.contact_id
    ? await supabase.from('contacts').select('name, email').eq('id', contract.contact_id).maybeSingle()
    : { data: null }
  const { data: run } = await supabase
    .from('pipeline_runs')
    .select('value')
    .eq('contract_id', contractId)
    .eq('status', 'open')
    .maybeSingle()
  const { data: owner } = contract.owner_id
    ? await supabase.from('profiles').select('full_name').eq('id', contract.owner_id).maybeSingle()
    : { data: null }
  const { data: orgSettings } = await supabase.from('organization_settings').select('company_name, company_cnpj').eq('id', 'default').maybeSingle()

  const { data: customFieldDefs } = await supabase.from('custom_fields').select('id, field_key, field_type')
  const { data: customFieldValues } = await supabase.from('contract_custom_field_values').select('custom_field_id, value').eq('contract_id', contractId)
  const valueByFieldId = new Map((customFieldValues ?? []).map((v) => [v.custom_field_id, v.value]))
  const customVars: Record<string, string> = {}
  for (const field of customFieldDefs ?? []) {
    const rawValue = valueByFieldId.get(field.id) ?? ''
    // Campo de arquivo guarda só o caminho no Storage — vira um link
    // de verdade quando usado dentro de um e-mail.
    customVars[field.field_key] =
      field.field_type === 'file' && rawValue
        ? `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://crm-gestaocontratos-pi.vercel.app'}/api/email-assets/${rawValue}`
        : rawValue
  }

  const vars = {
    cliente: contract.client_name ?? '',
    empresa: company?.name ?? contract.client_name ?? '',
    contato: contact?.name ?? '',
    processo: contract.process_number ?? '',
    valor: run?.value ? Number(run.value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '',
    cnpj: company?.cnpj ?? '',
    minha_empresa: orgSettings?.company_name ?? '',
    minha_cnpj: orgSettings?.company_cnpj ?? '',
    responsavel: owner?.full_name ?? '',
    data_hoje: new Date().toLocaleDateString('pt-BR'),
    ...customVars,
  }

  return {
    subject: fillTemplateVariables(template.subject, vars),
    body: fillTemplateVariables(template.body, vars),
    toEmail: contact?.email ?? null,
  }
}

// ------------------------------------------------------------
// Envio automático de e-mail por template — reutilizada tanto pela
// automação "e-mail por etapa" (configurada direto no template) quanto
// pelas regras de automação mais amplas (Automações → ação "Enviar
// e-mail"). Usa o Gmail/SMTP do DONO DA CONTA; se ele não tiver
// conectado, só não envia — não trava o resto da automação.
// ------------------------------------------------------------
export async function sendAutomatedTemplateEmail(contractId: string, templateId: string): Promise<void> {
  const supabase = createAdminClient()

  const { data: contract } = await supabase.from('contracts').select('owner_id').eq('id', contractId).maybeSingle()
  if (!contract?.owner_id) return

  const filled = await buildEmailFromTemplate(templateId, contractId)
  if (!filled?.toEmail) return

  const accountInfo = await getEmailAccountInfo(contract.owner_id)
  if (!accountInfo) return

  const { data: ownerProfile } = await supabase.from('profiles').select('email_signature').eq('id', contract.owner_id).maybeSingle()
  const { data: contractCodeRow } = await supabase.from('contracts').select('inbound_email_code').eq('id', contractId).maybeSingle()
  const { data: orgSettingsRow } = await supabase.from('organization_settings').select('inbound_email_domain').eq('id', 'default').maybeSingle()
  const trackingAddress =
    orgSettingsRow?.inbound_email_domain && contractCodeRow?.inbound_email_code
      ? `${contractCodeRow.inbound_email_code}@${orgSettingsRow.inbound_email_domain}`
      : null
  const replyTo = trackingAddress ? `${accountInfo.fromEmail}, ${trackingAddress}` : undefined
  const trackingToken = crypto.randomUUID()
  const trackingPixelUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://crm-gestaocontratos-pi.vercel.app'}/api/email-track/${trackingToken}`
  const trackingPixelHtml = `<img src="${trackingPixelUrl}" width="1" height="1" style="display:none" alt="" />`
  const bodyWithExtras = wrapEmailHtml(filled.body, ownerProfile?.email_signature ?? null, trackingPixelHtml)

  try {
    const result = await sendEmailForUser(contract.owner_id, filled.toEmail, filled.subject, bodyWithExtras, { replyTo })
    await supabase.from('contract_emails').insert({
      contract_id: contractId,
      sent_by: contract.owner_id,
      from_email: result.fromEmail,
      to_email: filled.toEmail,
      subject: filled.subject,
      body: filled.body,
      template_id: templateId,
      triggered_automatically: true,
      gmail_message_id: result.messageId,
      status: 'enviado',
      tracking_token: trackingToken,
    })
    await supabase.from('activities').insert({
      contract_id: contractId,
      type: 'email',
      content: `E-mail automático enviado pra ${filled.toEmail}: "${filled.subject}".`,
      metadata: { kind: 'sent', subject: filled.subject, from_email: result.fromEmail, to_email: filled.toEmail, body: filled.body },
    })
  } catch (e) {
    await supabase.from('contract_emails').insert({
      contract_id: contractId,
      sent_by: contract.owner_id,
      from_email: accountInfo.fromEmail,
      to_email: filled.toEmail,
      subject: filled.subject,
      body: filled.body,
      template_id: templateId,
      triggered_automatically: true,
      status: 'falhou',
      error_message: e instanceof Error ? e.message : 'Falha desconhecida.',
    })
  }
}

// ------------------------------------------------------------
// Templates no CONTEXTO DE TICKET — variáveis diferentes das de
// contrato ({{ticket_numero}}, {{ticket_assunto}}, {{solicitante}}),
// usado quando a automação é disparada pelo módulo de Atendimento.
// ------------------------------------------------------------
export async function buildTicketEmailFromTemplate(
  templateId: string,
  ticketId: string
): Promise<{ subject: string; body: string; toEmail: string | null } | null> {
  const supabase = createAdminClient()

  const { data: template } = await supabase.from('email_templates').select('subject, body').eq('id', templateId).maybeSingle()
  if (!template) return null

  const { data: ticket } = await supabase.from('tickets').select('ticket_number, subject, requester_name, requester_email').eq('id', ticketId).maybeSingle()
  if (!ticket) return null

  const vars = {
    ticket_numero: ticket.ticket_number,
    ticket_assunto: ticket.subject,
    solicitante: ticket.requester_name,
  }

  return {
    subject: fillTemplateVariables(template.subject, vars),
    body: fillTemplateVariables(template.body, vars),
    toEmail: ticket.requester_email,
  }
}

// Envio automático de e-mail de ticket — quem manda é o RESPONSÁVEL
// do ticket, se já tiver e tiver Gmail/SMTP conectado; senão, cai pro
// primeiro usuário do time Comercial que tiver conectado (é o time
// que cuida do atendimento, por padrão de vocês). Se ninguém tiver
// conectado, só não envia.
export async function sendAutomatedTicketTemplateEmail(ticketId: string, templateId: string): Promise<void> {
  const supabase = createAdminClient()

  const { data: ticket } = await supabase.from('tickets').select('assigned_to, contract_id').eq('id', ticketId).maybeSingle()
  if (!ticket) return

  let senderId: string | null = null
  if (ticket.assigned_to) {
    const account = await getEmailAccountInfo(ticket.assigned_to)
    if (account) senderId = ticket.assigned_to
  }
  if (!senderId) {
    const { data: comercialProfiles } = await supabase.from('profiles').select('id').eq('department', 'comercial')
    for (const p of comercialProfiles ?? []) {
      const account = await getEmailAccountInfo(p.id)
      if (account) {
        senderId = p.id
        break
      }
    }
  }
  if (!senderId) return

  const filled = await buildTicketEmailFromTemplate(templateId, ticketId)
  if (!filled?.toEmail) return

  const { data: senderProfile } = await supabase.from('profiles').select('email_signature').eq('id', senderId).maybeSingle()
  const bodyWithSignature = wrapEmailHtml(filled.body, senderProfile?.email_signature ?? null, '')

  try {
    const result = await sendEmailForUser(senderId, filled.toEmail, filled.subject, bodyWithSignature)

    await supabase.from('ticket_messages').insert({
      ticket_id: ticketId,
      author_type: 'interno',
      author_id: senderId,
      author_name: 'Automação',
      message: `E-mail automático enviado: "${filled.subject}".`,
      is_internal_note: false,
    })

    if (ticket.contract_id) {
      await supabase.from('contract_emails').insert({
        contract_id: ticket.contract_id,
        sent_by: senderId,
        from_email: result.fromEmail,
        to_email: filled.toEmail,
        subject: filled.subject,
        body: filled.body,
        template_id: templateId,
        triggered_automatically: true,
        gmail_message_id: result.messageId,
        status: 'enviado',
      })
      await supabase.from('activities').insert({
        contract_id: ticket.contract_id,
        type: 'email',
        content: `E-mail automático de ticket enviado pra ${filled.toEmail}: "${filled.subject}".`,
        metadata: { kind: 'sent', subject: filled.subject, from_email: result.fromEmail, to_email: filled.toEmail, body: filled.body },
      })
    }
  } catch {
    // Falha no envio automático de ticket não deve travar o resto do
    // fluxo (vincular o ticket já aconteceu, o e-mail é um extra).
  }
}
