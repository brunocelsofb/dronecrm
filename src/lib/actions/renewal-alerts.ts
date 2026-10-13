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
import { sendEmailForUser, getEmailAccountInfo, wrapEmailHtml } from '@/lib/email/send'
import { isWhatsAppOptedOut } from '@/lib/whatsapp/guardrails'
import { isPrivateInstance } from '@/lib/whatsapp/private-instances'
import { renderRenewalTemplate, whatsappTextToEmailHtml } from '@/lib/agent/renewal-templates'

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
  error?: string
}> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { instances: [], suggested: null, error: 'Não autenticado.' }

  const admin = createAdminClient()
  const [{ data: org }, { data: contract }] = await Promise.all([
    admin.from('organization_settings').select('evo_instance_aliases, evo_instance_name').eq('id', 'default').maybeSingle(),
    admin.from('contracts').select('owner_id, current_assignee_id').eq('id', contractId).maybeSingle(),
  ])

  const aliases = (org?.evo_instance_aliases ?? {}) as Record<string, AliasValue>
  const publicEntries = Object.entries(aliases).filter(([, v]) => !(typeof v === 'object' && v?.private === true))

  const userIds = [...new Set(publicEntries.map(([, v]) => aliasUser(v)).filter(Boolean))] as string[]
  const [{ data: profiles }, { data: accounts }] = userIds.length
    ? await Promise.all([
        admin.from('profiles').select('id, full_name').in('id', userIds),
        admin.from('email_accounts').select('user_id, email').in('user_id', userIds),
      ])
    : [{ data: [] }, { data: [] }]
  const nameById = new Map((profiles ?? []).map((p: { id: string; full_name: string | null }) => [p.id, p.full_name]))
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

  return { instances, suggested }
}

export async function sendRenewalAlert(
  activityId: string,
  message: string,
  subject: string,
  instanceName: string,
): Promise<SendResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }
  if (!message.trim()) return { error: 'A mensagem está vazia.' }
  if (!subject.trim()) return { error: 'O assunto do e-mail está vazio.' }
  if (!instanceName) return { error: 'Escolha o WhatsApp de envio.' }

  const admin = createAdminClient()
  const { data: activity, error: aErr } = await admin
    .from('activities')
    .select('id, contract_id, status, metadata')
    .eq('id', activityId)
    .maybeSingle()
  if (aErr || !activity) return { error: 'Atividade não encontrada.' }
  if (!activity.contract_id) return { error: 'Atividade sem contrato.' }

  const meta = (activity.metadata ?? {}) as Record<string, unknown>
  if (meta.kind !== 'renewal_alert') return { error: 'Esta atividade não é um aviso de renovação.' }
  if (meta.approval !== 'pending') return { error: 'Este aviso já foi enviado ou descartado.' }
  const phone = typeof meta.target_phone === 'string' ? meta.target_phone : ''
  const toEmail = typeof meta.target_email === 'string' ? meta.target_email : ''
  if (!phone || !toEmail) return { error: 'O aviso precisa de WhatsApp e e-mail do contato. Cadastre os dois no contato.' }

  if (await isPrivateInstance(instanceName)) return { error: 'Esse WhatsApp é privado e não envia para clientes.' }
  if (await isWhatsAppOptedOut(phone)) return { error: 'O cliente pediu para não receber mensagens por WhatsApp (opt-out).' }

  // Consultor dono do WhatsApp → remetente do e-mail e assinatura
  const { data: org } = await admin
    .from('organization_settings').select('evo_instance_aliases, inbound_email_domain').eq('id', 'default').maybeSingle()
  const alias = ((org?.evo_instance_aliases ?? {}) as Record<string, AliasValue>)[instanceName]
  const ownerUserId = aliasUser(alias)
  if (!ownerUserId) {
    return { error: 'Esse WhatsApp não tem consultor definido. Defina em Configurações → Conexões.' }
  }
  const account = await getEmailAccountInfo(ownerUserId)
  if (!account) {
    return { error: 'O consultor desse WhatsApp ainda não conectou o e-mail em Minha Conta.' }
  }
  const consultor = aliasLabel(instanceName, alias)

  // Trava contra clique duplo: marca como "enviando" só se ainda estiver pendente
  const { data: locked } = await admin
    .from('activities')
    .update({ metadata: { ...meta, approval: 'sending' } })
    .eq('id', activityId)
    .eq('metadata->>approval', 'pending')
    .select('id')
  if (!locked?.length) return { error: 'Este aviso já está sendo enviado.' }

  const unlock = async (extra: Record<string, unknown>) => {
    await admin.from('activities').update({ metadata: { ...meta, ...extra, approval: 'pending' } }).eq('id', activityId)
    revalidatePath(`/contracts/${activity.contract_id}`)
  }

  const finalMessage = renderRenewalTemplate(message.trim(), { consultor }).replace(/\n{3,}/g, '\n\n').trim()
  const finalSubject = renderRenewalTemplate(subject.trim(), { consultor }).trim()

  // 1. E-mail primeiro (é o canal que mais falha por conta/permissão).
  //    Se uma tentativa anterior já enviou o e-mail, não reenvia.
  let emailSentAt = typeof meta.email_sent_at === 'string' ? meta.email_sent_at : null
  let fromEmail = typeof meta.email_from === 'string' ? meta.email_from : account.fromEmail
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
    const html = wrapEmailHtml(whatsappTextToEmailHtml(finalMessage), null, pixel)

    try {
      const res = await sendEmailForUser(ownerUserId, toEmail, finalSubject, html, { replyTo })
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
      const msg = e instanceof Error ? e.message : 'Falha ao enviar e-mail.'
      await admin.from('contract_emails').insert({
        contract_id: activity.contract_id,
        sent_by: user.id,
        from_email: account.fromEmail,
        to_email: toEmail,
        subject: finalSubject,
        body: finalMessage,
        status: 'falhou',
        error_message: msg,
      })
      await unlock({ last_error: `E-mail: ${msg}` })
      return { error: `Nada foi enviado — o e-mail falhou: ${msg}` }
    }
  }

  // 2. WhatsApp
  const wa = await sendContractWhatsApp(activity.contract_id, phone, finalMessage, null, instanceName, { signWithSender: false })
  if (wa.error) {
    await unlock({ last_error: `WhatsApp: ${wa.error}`, email_sent_at: emailSentAt, email_from: fromEmail })
    return { error: `O e-mail foi enviado, mas o WhatsApp falhou: ${wa.error}. Tente de novo — o e-mail não será reenviado.` }
  }

  // 3. Vira o registro do envio (é o que aparece no Histórico do contrato)
  const { data: sender } = await admin.from('profiles').select('full_name').eq('id', user.id).maybeSingle()
  const sentAt = new Date()
  const quando = sentAt.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).replace(',', ' às')
  const marco = meta.alert_level === 0 ? 'contrato vencido' : `${meta.alert_level} dias`
  const contato = typeof meta.contact_name === 'string' ? `${meta.contact_name} ` : ''
  const sentTitle = `Aviso de renovação (${marco}) enviado ao cliente`
  const sentContent =
    `📲✉️ Aviso de renovação (${marco}) enviado para ${contato}por WhatsApp (${phone}) e e-mail (${toEmail}) em ${quando}` +
    `${sender?.full_name ? `, por ${sender.full_name}` : ''}` +
    `, pelo WhatsApp e e-mail de ${consultor} (${fromEmail}).`

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
    last_error:    null,
  }

  await admin
    .from('activities')
    .update({ status: 'done', completed: true, title: sentTitle, content: sentContent, metadata: sentMeta })
    .eq('id', activityId)

  revalidatePath(`/contracts/${activity.contract_id}`)
  return { ok: true, title: sentTitle, content: sentContent, metadata: sentMeta }
}
