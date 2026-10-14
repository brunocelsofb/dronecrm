'use server'

// Envio aprovado dos avisos de renovação criados pelo Copiloto IA.
// O agente (expiration-alerts) abre a atividade com metadata.approval='pending';
// aqui o consultor revisa o texto e o assunto, escolhe o WhatsApp e envia
// WhatsApp + e-mail juntos. O e-mail sai da conta do consultor dono do
// WhatsApp escolhido (Conexões → "Consultor deste WhatsApp").

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendContractWhatsApp } from '@/lib/actions/whatsapp'
import { sendEmailForUser, getEmailAccountInfo } from '@/lib/email/send'
import { isWhatsAppOptedOut } from '@/lib/whatsapp/guardrails'
import { isPrivateInstance } from '@/lib/whatsapp/private-instances'
import { renderRenewalTemplate, buildRenewalEmailHtml, resolveCommercialEmail } from '@/lib/agent/renewal-templates'
import { getContractTenantName } from '@/lib/agent/tenant-name'
import { resolveInternalSettings, parseEmailList, invalidEmails } from '@/lib/agent/internal-settings'
import { sendWhatsApp } from '@/lib/agent/briefing-core'
import { resolveTenantId } from '@/lib/tenant/context'

export type SendableInstance = {
  name: string
  label: string
  ownerUserId: string | null
  ownerName: string | null
  senderEmail: string | null     // e-mail conectado do consultor (null = não dá para enviar e-mail)
}

type AliasValue = string | { label?: string; private?: boolean; user_id?: string }

type SendResult = {
  ok?: true
  error?: string
  title?: string
  content?: string
  metadata?: Record<string, unknown>
}

// Traduz erros técnicos de envio para algo que o consultor consegue resolver
function friendlyEmailError(raw: string): string {
  if (/insufficient authentication scopes|ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficientPermissions/i.test(raw)) {
    return 'O e-mail do consultor foi conectado sem a permissão de enviar e-mails. ' +
      'Ele precisa ir em Minha Conta, desconectar e conectar o Gmail de novo, marcando "Enviar e-mail em seu nome".'
  }
  if (/invalid_grant|Token has been expired or revoked/i.test(raw)) {
    return 'A conexão do e-mail do consultor expirou ou foi revogada. Ele precisa conectar o Gmail de novo em Minha Conta.'
  }
  if (/Conta de e-mail não conectada/i.test(raw)) {
    return 'O consultor desse WhatsApp não tem e-mail conectado em Minha Conta.'
  }
  return raw.length > 300 ? `${raw.slice(0, 300)}…` : raw
}

function aliasLabel(name: string, v: AliasValue | undefined): string {
  return typeof v === 'string' ? v : v?.label ?? name
}

function aliasUser(v: AliasValue | undefined): string | null {
  return typeof v === 'object' && v?.user_id ? v.user_id : null
}

// Lista os WhatsApps que podem enviar ao cliente (exclui privados), com o
// consultor e o e-mail de envio de cada um, e sugere o do responsável.
export async function getSendableInstances(contractId: string): Promise<{
  instances: SendableInstance[]
  suggested: string | null
  ccEmail?: string | null
  ccEmails?: string[]
  error?: string
}> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { instances: [], suggested: null, error: 'Não autenticado.' }

  const admin = createAdminClient()
  const [{ data: org }, { data: contract }] = await Promise.all([
    admin.from('organization_settings').select('evo_instance_aliases, evo_instance_name, copilot_settings').eq('tenant_id', await resolveTenantId({ contractId })).maybeSingle(),
    admin.from('contracts').select('owner_id, current_assignee_id').eq('id', contractId).maybeSingle(),
  ])

  const aliases = (org?.evo_instance_aliases ?? {}) as Record<string, AliasValue>
  const publicEntries = Object.entries(aliases).filter(([, v]) => !(typeof v === 'object' && v?.private === true))

  const userIds = [...new Set(publicEntries.map(([, v]) => aliasUser(v)).filter(Boolean))] as string[]
  const [{ data: profiles }, { data: accounts }] = userIds.length
    ? await Promise.all([
        admin.from('profiles').select('id, full_name, job_title').in('id', userIds),
        admin.from('email_accounts').select('user_id, email').in('user_id', userIds),
      ])
    : [{ data: [] }, { data: [] }]
  const nameById = new Map((profiles ?? []).map((p: { id: string; full_name: string | null; job_title: string | null }) =>
    [p.id, p.full_name ? (p.job_title ? `${p.full_name} - ${p.job_title}` : p.full_name) : null]))
  const emailById = new Map((accounts ?? []).map((a: { user_id: string; email: string }) => [a.user_id, a.email]))

  const instances: SendableInstance[] = publicEntries.map(([name, v]) => {
    const uid = aliasUser(v)
    return {
      name,
      label: aliasLabel(name, v),
      ownerUserId: uid,
      ownerName: uid ? nameById.get(uid) ?? null : null,
      senderEmail: uid ? emailById.get(uid) ?? null : null,
    }
  })

  const principal = org?.evo_instance_name ?? null
  if (principal && !instances.some(i => i.name === principal)) {
    instances.unshift({ name: principal, label: principal, ownerUserId: null, ownerName: null, senderEmail: null })
  }

  // Sugestão: WhatsApp cujo consultor é o responsável do contrato
  const ownerId = contract?.owner_id ?? contract?.current_assignee_id ?? null
  const byOwner = ownerId ? instances.find(i => i.ownerUserId === ownerId) : null
  const suggested = byOwner?.name ?? principal ?? instances[0]?.name ?? null

  const ccEmail = resolveCommercialEmail((org?.copilot_settings as { commercial_email?: unknown } | null)?.commercial_email) || null
  // Cópia padrão: comercial + cópias extras de Configurações (editável na janela)
  const extra = resolveInternalSettings(org?.copilot_settings).extraCcEmails
  const ccEmails = parseEmailList([ccEmail ?? '', ...extra].join(','))
  return { instances, suggested, ccEmail, ccEmails }
}

export async function sendRenewalAlert(
  activityId: string,
  message: string,
  subject: string,
  instanceName: string,
  ccText?: string,   // cópia editada na janela; ausente = padrão (comercial + extras)
): Promise<SendResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }
  if (!message.trim()) return { error: 'A mensagem está vazia.' }
  if (!subject.trim()) return { error: 'O assunto do e-mail está vazio.' }
  if (!instanceName) return { error: 'Escolha o WhatsApp de envio.' }
  if (ccText !== undefined) {
    const bad = invalidEmails(ccText)
    if (bad.length) return { error: `E-mail de cópia inválido: ${bad.join(', ')}` }
  }

  const admin = createAdminClient()
  const { data: activity, error: aErr } = await admin
    .from('activities')
    .select('id, contract_id, status, metadata')
    .eq('id', activityId)
    .maybeSingle()
  if (aErr || !activity) return { error: 'Atividade não encontrada.' }
  if (!activity.contract_id) return { error: 'Atividade sem contrato.' }

  const meta = (activity.metadata ?? {}) as Record<string, unknown>
  const isConfirmation = meta.kind === 'renewal_confirmation'
  if (meta.kind !== 'renewal_alert' && !isConfirmation) return { error: 'Esta atividade não é um aviso de renovação.' }
  if (meta.approval !== 'pending') return { error: 'Este aviso já foi enviado ou descartado.' }
  const phone = typeof meta.target_phone === 'string' ? meta.target_phone : ''
  const toEmail = typeof meta.target_email === 'string' ? meta.target_email : ''
  if (!phone || !toEmail) return { error: 'O aviso precisa de WhatsApp e e-mail do contato. Cadastre os dois no contato.' }

  if (await isPrivateInstance(instanceName)) return { error: 'Esse WhatsApp é privado e não envia para clientes.' }
  if (await isWhatsAppOptedOut(phone)) return { error: 'O cliente pediu para não receber mensagens por WhatsApp (opt-out).' }

  // Consultor dono do WhatsApp → remetente do e-mail e assinatura
  const { data: org } = await admin
    .from('organization_settings').select('evo_instance_aliases, inbound_email_domain').eq('tenant_id', await resolveTenantId({ contractId: activity.contract_id })).maybeSingle()
  const alias = ((org?.evo_instance_aliases ?? {}) as Record<string, AliasValue>)[instanceName]
  const ownerUserId = aliasUser(alias)
  if (!ownerUserId) {
    return { error: 'Esse WhatsApp não tem consultor definido. Defina em Configurações → Conexões.' }
  }
  const account = await getEmailAccountInfo(ownerUserId)
  if (!account) {
    return { error: 'O consultor desse WhatsApp ainda não conectou o e-mail em Minha Conta.' }
  }
  // {{consultor}} = consultor vinculado ao WhatsApp (o mesmo dono do e-mail de
  // envio), para assinatura e remetente sempre baterem. Sem nome, usa o rótulo.
  const { data: ownerProfile } = await admin
    .from('profiles').select('full_name, job_title').eq('id', ownerUserId).maybeSingle()
  const consultor = ownerProfile?.full_name
    ? (ownerProfile.job_title ? `${ownerProfile.full_name} - ${ownerProfile.job_title}` : ownerProfile.full_name)
    : aliasLabel(instanceName, alias)

  // Trava contra clique duplo: marca como "enviando" só se ainda estiver pendente
  const { data: locked } = await admin
    .from('activities')
    .update({ metadata: { ...meta, approval: 'sending' } })
    .eq('id', activityId)
    .eq('metadata->>approval', 'pending')
    .select('id')
  if (!locked?.length) return { error: 'Este aviso já está sendo enviado.' }

  // Volta para pendente guardando o erro (aparece na atividade). Sem
  // revalidatePath: recarregar a página fechava a janela antes de ler o erro.
  const unlock = async (extra: Record<string, unknown>) => {
    await admin.from('activities').update({
      metadata: { ...meta, ...extra, approval: 'pending', last_error_at: new Date().toISOString() },
    }).eq('id', activityId)
  }

  const finalMessage = renderRenewalTemplate(message.trim(), { consultor }).replace(/\n{3,}/g, '\n\n').trim()
  const finalSubject = renderRenewalTemplate(subject.trim(), { consultor }).trim()

  // 1. E-mail primeiro (é o canal que mais falha por conta/permissão).
  //    Se uma tentativa anterior já enviou o e-mail, não reenvia.
  let emailSentAt = typeof meta.email_sent_at === 'string' ? meta.email_sent_at : null
  let fromEmail = typeof meta.email_from === 'string' ? meta.email_from : account.fromEmail
  let ccEmail: string | null = typeof meta.email_cc === 'string' ? meta.email_cc : null
  if (!emailSentAt) {
    const { data: contractForReply } = await admin
      .from('contracts').select('inbound_email_code').eq('id', activity.contract_id).maybeSingle()
    const trackingAddress = org?.inbound_email_domain && contractForReply?.inbound_email_code
      ? `${contractForReply.inbound_email_code}@${org.inbound_email_domain}`
      : null
    const replyTo = trackingAddress ? `${account.fromEmail}, ${trackingAddress}` : undefined
    const trackingToken = crypto.randomUUID()
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://crm-gestaocontratos-pi.vercel.app'
    const pixel = `<img src="${appUrl}/api/email-track/${trackingToken}" width="1" height="1" style="display:none" alt="" />`
    // E-mail no formato "automático": faixa colorida, mensagem, detalhes do contrato e contato
    const [{ data: contractInfo }, { data: orgInfo }, tenantName] = await Promise.all([
      admin.from('contracts').select('process_number, client_name, valid_until, monthly_value').eq('id', activity.contract_id).maybeSingle(),
      admin.from('organization_settings').select('company_name, copilot_settings').eq('tenant_id', await resolveTenantId({ contractId: activity.contract_id })).maybeSingle(),
      getContractTenantName(admin, activity.contract_id),
    ])
    const commercialEmail = resolveCommercialEmail((orgInfo?.copilot_settings as { commercial_email?: unknown } | null)?.commercial_email)
    // Cópia: o que veio da janela; sem isso, comercial + extras de Configurações.
    // Nunca copia o próprio remetente.
    const ccList = ccText !== undefined
      ? parseEmailList(ccText)
      : parseEmailList([commercialEmail, ...resolveInternalSettings(orgInfo?.copilot_settings).extraCcEmails].join(','))
    const ccFiltered = ccList.filter(e => e.toLowerCase() !== account.fromEmail.toLowerCase() && e.toLowerCase() !== toEmail.toLowerCase())
    ccEmail = ccFiltered.length ? ccFiltered.join(', ') : null
    const validUntilIso = contractInfo?.valid_until ? String(contractInfo.valid_until).slice(0, 10) : null
    const todayBr = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10)
    const daysLeft = validUntilIso
      ? Math.round((new Date(`${validUntilIso}T12:00:00Z`).getTime() - new Date(`${todayBr}T12:00:00Z`).getTime()) / 86_400_000)
      : 0
    const html = buildRenewalEmailHtml({
      kind: isConfirmation ? 'confirmation' : 'alert',
      validFrom: typeof meta.valid_from === 'string' ? meta.valid_from.slice(0, 10).split('-').reverse().join('/') : null,
      level: typeof meta.alert_level === 'number' ? meta.alert_level : 0,
      daysUntilExpiry: daysLeft,
      messageText: finalMessage,
      contractNumber: contractInfo?.process_number ?? null,
      clientName: contractInfo?.client_name ?? '',
      validUntil: validUntilIso ? validUntilIso.split('-').reverse().join('/') : null,
      monthlyValue: contractInfo?.monthly_value != null
        ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(contractInfo.monthly_value))
        : null,
      consultorName: consultor,
      consultorEmail: account.fromEmail,
      commercialEmail,
      companyName: tenantName || orgInfo?.company_name?.trim() || 'Equipe Comercial',
    }).replace('</body>', `${pixel}</body>`)

    try {
      const res = await sendEmailForUser(ownerUserId, toEmail, finalSubject, html, { replyTo, ...(ccEmail ? { cc: ccEmail } : {}) })
      emailSentAt = new Date().toISOString()
      fromEmail = res.fromEmail
      await admin.from('contract_emails').insert({
        contract_id: activity.contract_id,
        sent_by: user.id,
        from_email: res.fromEmail,
        to_email: toEmail,
        subject: finalSubject,
        body: finalMessage,
        triggered_automatically: false,
        gmail_message_id: res.messageId,
        status: 'enviado',
        tracking_token: trackingToken,
      })
    } catch (e) {
      const technical = e instanceof Error ? e.message : 'Falha ao enviar e-mail.'
      const msg = friendlyEmailError(technical)
      await admin.from('contract_emails').insert({
        contract_id: activity.contract_id,
        sent_by: user.id,
        from_email: account.fromEmail,
        to_email: toEmail,
        subject: finalSubject,
        body: finalMessage,
        status: 'falhou',
        error_message: technical,
      })
      await unlock({ last_error: `E-mail: ${msg}` })
      return { error: `Nada foi enviado — o e-mail falhou: ${msg}` }
    }
  }

  // 2. WhatsApp
  const wa = await sendContractWhatsApp(activity.contract_id, phone, finalMessage, null, instanceName, { signWithSender: false })
  if (wa.error) {
    await unlock({ last_error: `WhatsApp: ${wa.error}`, email_sent_at: emailSentAt, email_from: fromEmail, email_cc: ccEmail })
    return { error: `O e-mail foi enviado, mas o WhatsApp falhou: ${wa.error}. Tente de novo — o e-mail não será reenviado.` }
  }

  // 3. Vira o registro do envio (é o que aparece no Histórico do contrato)
  const { data: sender } = await admin.from('profiles').select('full_name').eq('id', user.id).maybeSingle()
  const sentAt = new Date()
  const quando = sentAt.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).replace(',', ' às')
  const marco = isConfirmation ? 'renovação concluída' : meta.alert_level === 0 ? 'contrato vencido' : `${meta.alert_level} dias`
  const contato = typeof meta.contact_name === 'string' ? `${meta.contact_name} ` : ''
  const sentTitle = isConfirmation ? 'Confirmação de renovação enviada ao cliente' : `Aviso de renovação (${marco}) enviado ao cliente`
  const sentContent =
    `📲✉️ ${isConfirmation ? 'Confirmação de renovação (novo período)' : `Aviso de renovação (${marco})`} enviado para ${contato}por WhatsApp (${phone}) e e-mail (${toEmail}) em ${quando}` +
    `${sender?.full_name ? `, por ${sender.full_name}` : ''}` +
    `, pelo WhatsApp e e-mail de ${consultor} (${fromEmail})` +
    `${ccEmail ? `, com cópia para ${ccEmail}` : ''}.`

  const sentMeta: Record<string, unknown> = {
    ...meta,
    approval:      'sent',
    sent_at:       sentAt.toISOString(),
    sent_by:       user.id,
    sent_instance: instanceName,
    final_message: finalMessage,
    final_subject: finalSubject,
    email_sent_at: emailSentAt,
    email_from:    fromEmail,
    email_cc:      ccEmail,
    last_error:    null,
  }

  await admin
    .from('activities')
    .update({ status: 'done', completed: true, title: sentTitle, content: sentContent, metadata: sentMeta })
    .eq('id', activityId)

  // 4. Avisa o gestor no WhatsApp do briefing (Gerencial). Falha aqui não
  //    desfaz o envio ao cliente — só fica no log.
  try {
    const { data: ci } = await admin
      .from('contracts').select('process_number, client_name').eq('id', activity.contract_id).maybeSingle()
    const hora = sentAt.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
    const quem = sender?.full_name ?? consultor
    const oQue = isConfirmation ? 'a confirmação de renovação' : `o aviso de renovação (${marco})`
    const pelo = quem === consultor || consultor.startsWith(`${quem} -`) ? '' : ` pelo WhatsApp de ${consultor}`
    const managerText =
      `✅ *Enviado ao cliente*\n` +
      `${quem} enviou ${oQue}${pelo}.\n` +
      `Contrato: ${ci?.process_number ?? '—'} — ${ci?.client_name ?? ''}\n` +
      `Para: ${contato || 'contato '}(${phone} · ${toEmail})\n` +
      `WhatsApp + e-mail às ${hora}${ccEmail ? ` · cópia ${ccEmail}` : ''}`
    const r = await sendWhatsApp(managerText, await resolveTenantId({ contractId: activity.contract_id }))
    if (!r.sent) console.error('[renewal] aviso ao gestor falhou:', r.error)
  } catch (e) {
    console.error('[renewal] aviso ao gestor falhou:', e)
  }

  revalidatePath(`/contracts/${activity.contract_id}`)
  return { ok: true, title: sentTitle, content: sentContent, metadata: sentMeta }
}
