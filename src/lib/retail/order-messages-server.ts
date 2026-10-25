// ─── Varejo: mensagens e linha do tempo do pedido (servidor) ──────────────────
// recordOrderStage: grava a etapa na linha do tempo e deixa o rascunho da mensagem
// "para revisar". Nunca envia nada. Falhas aqui não podem travar o pedido.

import { randomBytes } from 'crypto'
import type { createAdminClient } from '@/lib/supabase/admin'
import { appBaseUrl } from '@/lib/whatsapp/webhook-token'
import { fmtBRL } from '@/lib/format'
import { PAYMENT_METHODS } from '@/lib/retail/customers'
import { buildConta, cleanTrackingUrl, firstName, readTemplates, renderTemplate, trackingText, type MessageStage, type MessageTemplate } from '@/lib/retail/order-messages'

type Db = ReturnType<typeof createAdminClient> // cliente já preso à empresa (scoped)

export const orderPublicUrl = (token: string) => `${appBaseUrl()}/loja/pedido/${token}`

export async function ensurePublicToken(db: Db, orderId: string): Promise<string | null> {
  const { data } = await db.from('retail_orders').select('public_token').eq('id', orderId).maybeSingle()
  if (!data) return null
  if (data.public_token) return data.public_token as string
  const token = randomBytes(24).toString('base64url') // 32 caracteres
  const { error } = await db.from('retail_orders').update({ public_token: token }).eq('id', orderId).is('public_token', null)
  if (error) return null
  const { data: again } = await db.from('retail_orders').select('public_token').eq('id', orderId).maybeSingle()
  return (again?.public_token as string | null) ?? token
}

export async function addOrderEvent(db: Db, orderId: string, kind: string, opts: { note?: string | null; isPublic?: boolean; userId?: string | null } = {}): Promise<void> {
  await db.from('retail_order_events').insert({ order_id: orderId, kind, note: opts.note ?? null, public: opts.isPublic ?? false, created_by: opts.userId ?? null })
}

type OrderForMsg = {
  id: string; number: number; status: string; subtotal: number; discount: number; loyalty_discount: number; shipping: number; total: number
  payment_method: string | null; payment_condition: string | null; payment_link: string | null; proposal_token: string | null
  tracking_carrier: string | null; tracking_code: string | null; tracking_url: string | null
  retail_customers: { name: string; email: string | null } | null
  retail_order_items: { name: string; color: string | null; size: string | null; qty: number; unit_price: number; total: number }[]
}

// Monta o texto da etapa pelo modelo da loja, com os dados de agora
export async function renderOrderMessage(db: Db, tenantId: string, orderId: string, stage: MessageStage): Promise<(MessageTemplate & { emailTo: string | null }) | null> {
  const [{ data }, { data: org }, { data: sf }] = await Promise.all([
    db.from('retail_orders')
      .select('id, number, status, subtotal, discount, loyalty_discount, shipping, total, payment_method, payment_condition, payment_link, proposal_token, tracking_carrier, tracking_code, tracking_url, retail_customers(name, email), retail_order_items(name, color, size, qty, unit_price, total)')
      .eq('id', orderId).maybeSingle(),
    db.from('organization_settings').select('company_name, name, retail_settings').eq('tenant_id', tenantId).maybeSingle(),
    db.from('retail_storefronts').select('title').eq('tenant_id', tenantId).maybeSingle(),
  ])
  if (!data) return null
  const o = data as unknown as OrderForMsg
  const token = await ensurePublicToken(db, orderId)
  const n = (v: unknown) => Number(v ?? 0)
  const store = ((sf?.title as string | null) || (org?.company_name as string | null) || (org?.name as string | null) || 'loja').trim()
  const payLabel = [PAYMENT_METHODS.find(p => p.id === o.payment_method)?.label, o.payment_condition].filter(Boolean).join(' · ') || null
  const conta = buildConta({
    items: o.retail_order_items.map(i => ({ name: i.name, color: i.color, size: i.size, qty: i.qty, unit_price: n(i.unit_price), total: n(i.total) })),
    subtotal: n(o.subtotal), discount: n(o.discount), loyaltyDiscount: n(o.loyalty_discount), shipping: n(o.shipping), total: n(o.total),
    paymentLabel: stage === 'recebido' || stage === 'link' ? null : payLabel,
  }, fmtBRL)
  const vars = {
    nome: firstName(o.retail_customers?.name), numero: String(o.number), loja: store, conta, total: fmtBRL(n(o.total)),
    link_pagamento: o.proposal_token ? `${appBaseUrl()}/loja/proposta/${o.proposal_token}` : (o.payment_link ?? ''),
    rastreio: trackingText({ carrier: o.tracking_carrier, code: o.tracking_code, url: cleanTrackingUrl(o.tracking_url) }),
    link_pedido: token ? orderPublicUrl(token) : '',
  }
  const tpl = readTemplates((org?.retail_settings as Record<string, unknown> | null)?.messages)[stage]
  return {
    wa: renderTemplate(tpl.wa, vars), subject: renderTemplate(tpl.subject, vars), email: renderTemplate(tpl.email, vars),
    emailTo: o.retail_customers?.email ?? null,
  }
}

// Etapa nova: linha do tempo pública + rascunho "para revisar".
// Rascunho já enviado só é refeito no link (novo link) e no envio (rastreio novo).
export async function recordOrderStage(db: Db, tenantId: string, orderId: string, stage: MessageStage, userId: string | null = null): Promise<void> {
  try {
    await addOrderEvent(db, orderId, stage, { isPublic: true, userId })
    const msg = await renderOrderMessage(db, tenantId, orderId, stage)
    if (!msg) return
    const { data: existing } = await db.from('retail_order_messages').select('id, status').eq('order_id', orderId).eq('stage', stage).maybeSingle()
    const row = { wa_text: msg.wa, email_subject: msg.subject, email_body: msg.email, email_to: msg.emailTo, status: 'pendente', last_error: null, updated_at: new Date().toISOString() }
    if (!existing) {
      await db.from('retail_order_messages').insert({ order_id: orderId, stage, ...row })
    } else if (existing.status !== 'enviada' || stage === 'link' || stage === 'enviado') {
      await db.from('retail_order_messages').update({ ...row, sent_channels: [], sent_at: null, sent_by: null }).eq('id', existing.id)
    }
  } catch (e) {
    console.error('[varejo] mensagem da etapa', stage, e instanceof Error ? e.message : e)
  }
}

// Status do pedido → etapa da mensagem
export function stageForStatus(status: string): MessageStage | null {
  return status === 'pago' ? 'pago' : status === 'enviado' ? 'enviado' : status === 'entregue' ? 'entregue' : null
}
