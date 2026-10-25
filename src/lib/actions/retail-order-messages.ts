'use server'

// ─── Varejo: revisar e enviar as mensagens do pedido ──────────────────────────
// O Drone deixa o rascunho de cada etapa; aqui a equipe envia (WhatsApp pelo Drone
// ou pelo próprio celular, e-mail opcional), refaz pelo modelo ou descarta.
// Também: marcar separado, rastreio e os modelos de texto da loja.

import { revalidatePath } from 'next/cache'
import { hasFeature } from '@/lib/auth/access'
import { requireTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { getSupportSession } from '@/lib/tenant/support'
import { cleanText } from '@/lib/retail/products'
import { getTenantEvoCreds } from '@/lib/whatsapp/tenant-evo'
import { sendEvoTextMessage } from '@/lib/whatsapp/evolution'
import { isWhatsAppOptedOut } from '@/lib/whatsapp/guardrails'
import { isPrivateInstance } from '@/lib/whatsapp/private-instances'
import { sendEmailForUser, wrapEmailHtml } from '@/lib/email/send'
import { addOrderEvent, recordOrderStage, renderOrderMessage } from '@/lib/retail/order-messages-server'
import { cleanTrackingUrl, isMessageStage, MESSAGE_STAGES, readTemplates, type MessageTemplates } from '@/lib/retail/order-messages'

type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function guard(adminOnly = false): Promise<{ tenantId: string; userId: string } | { error: string }> {
  const access = await hasFeature('varejo')
  if (!access) return { error: 'Sem acesso ao módulo Varejo.' }
  if (await getSupportSession()) return { error: 'Acesso de suporte é só leitura.' }
  if (adminOnly && !access.isAdmin) return { error: 'Só o administrador muda os modelos.' }
  return { tenantId: await requireTenantId(), userId: access.userId }
}

const stageLabel = (s: string) => MESSAGE_STAGES.find(x => x.id === s)?.label ?? s
function friendlyEmailError(raw: string): string {
  if (/insufficient authentication scopes|ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficientPermissions/i.test(raw)) return 'Seu Gmail foi conectado sem a permissão de enviar e-mails. Conecte de novo em Minha Conta.'
  if (/invalid_grant|Token has been expired or revoked/i.test(raw)) return 'A conexão do seu e-mail expirou. Conecte de novo em Minha Conta.'
  if (/Conta de e-mail não conectada/i.test(raw)) return 'Você ainda não conectou seu e-mail em Minha Conta.'
  return raw.length > 300 ? `${raw.slice(0, 300)}…` : raw
}

export type SendInput = {
  wa: string; subject: string; email: string
  whatsapp: 'drone' | 'manual' | 'none'   // manual = a pessoa abriu o WhatsApp no aparelho e enviou de lá
  instance?: string | null
  sendEmail: boolean
}

export async function sendRetailOrderMessage(messageId: string, input: SendInput): Promise<Result<{ warning?: string }>> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  if (!UUID.test(messageId)) return { ok: false, error: 'Mensagem inválida.' }
  const wa = String(input.wa ?? '').trim().slice(0, 4000)
  const subject = String(input.subject ?? '').trim().slice(0, 200)
  const body = String(input.email ?? '').trim().slice(0, 8000)
  if (input.whatsapp === 'none' && !input.sendEmail) return { ok: false, error: 'Escolha ao menos um canal (WhatsApp ou e-mail).' }
  if (input.whatsapp !== 'none' && !wa) return { ok: false, error: 'A mensagem de WhatsApp está vazia.' }
  if (input.sendEmail && (!subject || !body)) return { ok: false, error: 'Preencha o assunto e o texto do e-mail.' }

  const db = await createScopedAdmin(g.tenantId)
  const { data: m } = await db.from('retail_order_messages').select('id, order_id, stage, status').eq('id', messageId).maybeSingle()
  if (!m) return { ok: false, error: 'Mensagem não encontrada.' }
  if (m.status === 'enviada') return { ok: false, error: 'Esta mensagem já foi enviada.' }
  const { data: o } = await db.from('retail_orders').select('id, retail_customers(phone, email)').eq('id', m.order_id).maybeSingle()
  const cust = (o as unknown as { retail_customers: { phone: string | null; email: string | null } | null } | null)?.retail_customers ?? null
  if (input.whatsapp !== 'none' && !cust?.phone) return { ok: false, error: 'A cliente está sem WhatsApp. Cadastre em Clientes.' }
  if (input.sendEmail && !cust?.email) return { ok: false, error: 'A cliente está sem e-mail. Cadastre em Clientes.' }

  // Trava contra clique duplo
  const { data: locked } = await db.from('retail_order_messages').update({ status: 'enviada', updated_at: new Date().toISOString() })
    .eq('id', messageId).neq('status', 'enviada').select('id')
  if (!locked?.length) return { ok: false, error: 'Esta mensagem já está sendo enviada.' }
  const unlock = async (err: string) => { await db.from('retail_order_messages').update({ status: 'pendente', last_error: err, wa_text: wa, email_subject: subject, email_body: body }).eq('id', messageId) }

  const channels: string[] = []
  // 1. WhatsApp pelo Drone (instância da loja)
  if (input.whatsapp === 'drone') {
    const instance = cleanText(input.instance, 120)
    if (!instance) { await unlock('Escolha o WhatsApp de envio.'); return { ok: false, error: 'Escolha o WhatsApp de envio.' } }
    const { data: org } = await db.from('organization_settings').select('evo_instance_name, evo_instance_aliases').eq('tenant_id', g.tenantId).maybeSingle()
    const mine = [org?.evo_instance_name, ...Object.keys((org?.evo_instance_aliases ?? {}) as Record<string, unknown>)].filter(Boolean)
    if (!mine.includes(instance) || await isPrivateInstance(instance, g.tenantId)) { await unlock('WhatsApp de envio inválido.'); return { ok: false, error: 'Esse WhatsApp não pode enviar para clientes.' } }
    if (await isWhatsAppOptedOut(cust!.phone!)) { await unlock('Cliente pediu para não receber WhatsApp.'); return { ok: false, error: 'A cliente pediu para não receber mensagens por WhatsApp.' } }
    const creds = await getTenantEvoCreds(g.tenantId)
    if (!creds) { await unlock('Servidor do WhatsApp não configurado.'); return { ok: false, error: 'Servidor do WhatsApp não configurado.' } }
    try {
      await sendEvoTextMessage({ ...creds, instanceName: instance, phone: cust!.phone!, message: wa })
      channels.push('whatsapp_drone')
    } catch (e) {
      const err = e instanceof Error ? e.message.slice(0, 300) : 'Falha no WhatsApp.'
      await unlock(`WhatsApp: ${err}`)
      return { ok: false, error: `Nada foi enviado: o WhatsApp falhou (${err}).` }
    }
  } else if (input.whatsapp === 'manual') {
    channels.push('whatsapp_manual')
  }

  // 2. E-mail (opcional), da conta de quem está enviando
  let warning: string | undefined
  if (input.sendEmail) {
    try {
      await sendEmailForUser(g.userId, cust!.email!, subject, wrapEmailHtml(body, null, ''))
      channels.push('email')
    } catch (e) {
      const err = friendlyEmailError(e instanceof Error ? e.message : 'Falha no e-mail.')
      if (!channels.length) { await unlock(`E-mail: ${err}`); return { ok: false, error: `Nada foi enviado: o e-mail falhou. ${err}` } }
      warning = `O WhatsApp foi, mas o e-mail falhou: ${err}`
    }
  }

  const now = new Date().toISOString()
  await db.from('retail_order_messages').update({
    status: 'enviada', wa_text: wa, email_subject: subject, email_body: body, email_to: input.sendEmail ? cust?.email ?? null : null,
    sent_channels: channels, sent_by: g.userId, sent_at: now, last_error: warning ?? null, updated_at: now,
  }).eq('id', messageId)
  const how = channels.map(c => (c === 'email' ? 'e-mail' : c === 'whatsapp_drone' ? 'WhatsApp pelo Drone' : 'WhatsApp do celular')).join(' + ')
  await addOrderEvent(db, m.order_id as string, 'mensagem', { note: `${stageLabel(m.stage as string)}: enviada (${how})`, userId: g.userId })
  revalidatePath(`/varejo/pedidos/${m.order_id}`); revalidatePath('/varejo/funil'); revalidatePath('/varejo/pedidos')
  return { ok: true, ...(warning ? { warning } : {}) }
}

export async function discardRetailOrderMessage(messageId: string): Promise<Result> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  if (!UUID.test(messageId)) return { ok: false, error: 'Mensagem inválida.' }
  const db = await createScopedAdmin(g.tenantId)
  const { data: m } = await db.from('retail_order_messages').update({ status: 'descartada', updated_at: new Date().toISOString() })
    .eq('id', messageId).eq('status', 'pendente').select('order_id, stage').maybeSingle()
  if (!m) return { ok: false, error: 'Mensagem não está mais pendente.' }
  await addOrderEvent(db, m.order_id as string, 'mensagem', { note: `${stageLabel(m.stage as string)}: não enviada (descartada)`, userId: g.userId })
  revalidatePath(`/varejo/pedidos/${m.order_id}`); revalidatePath('/varejo/funil')
  return { ok: true }
}

// Refaz o rascunho pelo modelo (ex.: depois de informar o rastreio ou mudar o frete)
export async function redoRetailOrderMessage(messageId: string): Promise<Result<{ wa: string; subject: string; email: string }>> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  if (!UUID.test(messageId)) return { ok: false, error: 'Mensagem inválida.' }
  const db = await createScopedAdmin(g.tenantId)
  const { data: m } = await db.from('retail_order_messages').select('id, order_id, stage, status').eq('id', messageId).maybeSingle()
  if (!m || !isMessageStage(m.stage)) return { ok: false, error: 'Mensagem não encontrada.' }
  const r = await renderOrderMessage(db, g.tenantId, m.order_id as string, m.stage)
  if (!r) return { ok: false, error: 'Pedido não encontrado.' }
  await db.from('retail_order_messages').update({ wa_text: r.wa, email_subject: r.subject, email_body: r.email, email_to: r.emailTo, updated_at: new Date().toISOString() }).eq('id', messageId)
  revalidatePath(`/varejo/pedidos/${m.order_id}`)
  return { ok: true, wa: r.wa, subject: r.subject, email: r.email }
}

// Separado: só pedido pago; vira etapa na linha do tempo e rascunho para a cliente
export async function markRetailOrderSeparated(orderId: string): Promise<Result> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  if (!UUID.test(orderId)) return { ok: false, error: 'Pedido inválido.' }
  const db = await createScopedAdmin(g.tenantId)
  const { data: o } = await db.from('retail_orders').select('id, status, separated_at').eq('id', orderId).maybeSingle()
  if (!o) return { ok: false, error: 'Pedido não encontrado.' }
  if (o.status !== 'pago') return { ok: false, error: o.status === 'enviado' || o.status === 'entregue' ? 'O pedido já saiu.' : 'Só pedido pago pode ser marcado como separado.' }
  if (o.separated_at) return { ok: false, error: 'Já está marcado como separado.' }
  const { error } = await db.from('retail_orders').update({ separated_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', orderId)
  if (error) return { ok: false, error: error.message }
  await recordOrderStage(db, g.tenantId, orderId, 'separado', g.userId)
  revalidatePath(`/varejo/pedidos/${orderId}`); revalidatePath('/varejo/funil')
  return { ok: true }
}

export async function saveRetailTracking(orderId: string, input: { carrier: string; code: string; url: string }): Promise<Result> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  if (!UUID.test(orderId)) return { ok: false, error: 'Pedido inválido.' }
  const url = input.url?.trim() ? cleanTrackingUrl(input.url) : null
  if (input.url?.trim() && !url) return { ok: false, error: 'Link de rastreio inválido (use https://…).' }
  const db = await createScopedAdmin(g.tenantId)
  const { data: o } = await db.from('retail_orders').select('id, status').eq('id', orderId).maybeSingle()
  if (!o) return { ok: false, error: 'Pedido não encontrado.' }
  if (o.status === 'cancelado') return { ok: false, error: 'Pedido cancelado.' }
  const { error } = await db.from('retail_orders').update({
    tracking_carrier: cleanText(input.carrier, 60), tracking_code: cleanText(input.code, 60)?.toUpperCase() ?? null, tracking_url: url, updated_at: new Date().toISOString(),
  }).eq('id', orderId)
  if (error) return { ok: false, error: error.message }
  // Rascunho do "enviado" ainda não enviado: já sai com o rastreio novo
  const { data: m } = await db.from('retail_order_messages').select('id').eq('order_id', orderId).eq('stage', 'enviado').eq('status', 'pendente').maybeSingle()
  if (m) {
    const r = await renderOrderMessage(db, g.tenantId, orderId, 'enviado')
    if (r) await db.from('retail_order_messages').update({ wa_text: r.wa, email_subject: r.subject, email_body: r.email, updated_at: new Date().toISOString() }).eq('id', m.id)
  }
  await addOrderEvent(db, orderId, 'rastreio', { note: [cleanText(input.carrier, 60), cleanText(input.code, 60)].filter(Boolean).join(' · ') || 'rastreio apagado', userId: g.userId })
  revalidatePath(`/varejo/pedidos/${orderId}`)
  return { ok: true }
}

export async function saveRetailMessageTemplates(input: MessageTemplates): Promise<Result> {
  const g = await guard(true)
  if ('error' in g) return { ok: false, error: g.error }
  const db = await createScopedAdmin(g.tenantId)
  const { data: org } = await db.from('organization_settings').select('retail_settings').eq('tenant_id', g.tenantId).maybeSingle()
  const current = (org?.retail_settings ?? {}) as Record<string, unknown>
  const { error } = await db.from('organization_settings').update({ retail_settings: { ...current, messages: readTemplates(input) } }).eq('tenant_id', g.tenantId)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/varejo/mensagens')
  return { ok: true }
}
