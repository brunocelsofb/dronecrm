'use server'

// ─── Varejo: pedidos ──────────────────────────────────────────────────────────
// O valor é sempre calculado aqui, com os preços do banco (nunca vem da tela).
// Estoque baixa uma vez quando o pedido vira pago (ou enviado/entregue) e volta
// se ele for cancelado depois (função retail_apply_order_stock, em transação).

import { revalidatePath } from 'next/cache'
import { hasFeature } from '@/lib/auth/access'
import { requireTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { getSupportSession } from '@/lib/tenant/support'
import { cleanText, cleanLongText, parseMoney } from '@/lib/retail/products'
import { priceItems, round2 } from '@/lib/retail/pricing'
import { canonicalPhone, isOrderStatus, isPaymentMethod, onlyDigits, PAID_STATUSES, type OrderStatus } from '@/lib/retail/customers'
import { loadPricingConfig, onRetailOrderCancelled, onRetailOrderPaid } from '@/lib/retail/loyalty-server'

type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string }
type Db = Awaited<ReturnType<typeof createScopedAdmin>>

async function guard(): Promise<{ tenantId: string; userId: string } | { error: string }> {
  const access = await hasFeature('varejo')
  if (!access) return { error: 'Sem acesso ao módulo Varejo.' }
  if (await getSupportSession()) return { error: 'Acesso de suporte é só leitura.' }
  return { tenantId: await requireTenantId(), userId: access.userId }
}

import type { OrderItemInput } from '@/lib/retail/pricing'
export type OrderInput = {
  customer_id?: string | null
  new_customer?: { name: string; phone?: string | null } | null
  items: OrderItemInput[]
  discount?: string | number | null
  shipping?: string | number | null
  payment_method?: string | null
  payment_condition?: string | null
  payment_link?: string | null
  status?: string
  delivery?: { method?: string | null; cep?: string | null; address?: string | null } | null
  notes?: string | null
}

function money(v: unknown, label: string): { ok: true; value: number } | { ok: false; error: string } {
  if (v === null || v === undefined || v === '') return { ok: true, value: 0 }
  const n = parseMoney(v)
  return n === null ? { ok: false, error: `${label} inválido.` } : { ok: true, value: n }
}

function cleanLink(v: unknown): string | null {
  const s = cleanText(v, 500)
  if (!s) return null
  try { const u = new URL(s); return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null } catch { return null }
}

async function applyStock(db: Db, orderId: string, tenantId: string, apply: boolean): Promise<string | null> {
  const { data, error } = await db.rpc('retail_apply_order_stock', { p_order: orderId, p_tenant: tenantId, p_apply: apply })
  if (error) return error.message.replace(/^.*?Estoque/, 'Estoque')
  return (data as string | null) ?? null
}

export async function createRetailOrder(input: OrderInput): Promise<Result<{ id: string; number: number }>> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  const db = await createScopedAdmin(g.tenantId)

  // Cliente: existente ou nova (nome + telefone)
  let customerId: string | null = null
  if (input.customer_id) {
    const { data } = await db.from('retail_customers').select('id').eq('id', input.customer_id).maybeSingle()
    if (!data) return { ok: false, error: 'Cliente não encontrada.' }
    customerId = data.id as string
  } else if (input.new_customer?.name) {
    const name = cleanText(input.new_customer.name, 160)
    const phone = input.new_customer.phone ? canonicalPhone(input.new_customer.phone) : null
    if (!name) return { ok: false, error: 'Informe o nome da cliente.' }
    if (input.new_customer.phone && !phone) return { ok: false, error: 'Telefone inválido. Use DDD + número.' }
    if (phone) {
      const { data: ex } = await db.from('retail_customers').select('id').eq('phone', phone).maybeSingle()
      if (ex) customerId = ex.id as string
    }
    if (!customerId) {
      const { data, error } = await db.from('retail_customers').insert({ name, phone, source: 'manual' }).select('id').single()
      if (error || !data) return { ok: false, error: error?.message ?? 'Falha ao criar a cliente.' }
      customerId = data.id as string
    }
  }

  const priced = await priceItems(db, input.items)
  if (!priced.ok) return priced
  const discount = money(input.discount, 'Desconto'); if (!discount.ok) return discount
  const shipping = money(input.shipping, 'Frete'); if (!shipping.ok) return shipping
  if (discount.value > priced.subtotal) return { ok: false, error: 'Desconto maior que o subtotal.' }
  const status: OrderStatus = isOrderStatus(input.status) && input.status !== 'cancelado' ? input.status : 'enviado_atendimento'
  const total = round2(priced.subtotal - discount.value + shipping.value)

  const { data: num, error: numErr } = await db.rpc('retail_next_order_number', { p_tenant: g.tenantId })
  if (numErr || typeof num !== 'number') return { ok: false, error: numErr?.message ?? 'Falha ao numerar o pedido.' }
  const { data: order, error } = await db.from('retail_orders').insert({
    number: num, customer_id: customerId, status,
    payment_method: isPaymentMethod(input.payment_method) ? input.payment_method : null,
    payment_condition: cleanText(input.payment_condition, 200),
    payment_link: cleanLink(input.payment_link),
    subtotal: priced.subtotal, discount: discount.value, shipping: shipping.value, total,
    delivery: {
      method: cleanText(input.delivery?.method, 60), cep: onlyDigits(input.delivery?.cep, 8), address: cleanText(input.delivery?.address, 300),
    },
    notes: cleanLongText(input.notes, 2000), source: 'manual', created_by: g.userId,
    paid_at: PAID_STATUSES.includes(status) ? new Date().toISOString() : null,
  }).select('id, number').single()
  if (error || !order) return { ok: false, error: error?.code === '23505' ? 'Dois pedidos ao mesmo tempo; tente de novo.' : error?.message ?? 'Falha ao criar o pedido.' }
  const orderId = order.id as string

  const { error: itErr } = await db.from('retail_order_items').insert(priced.items.map(i => ({ ...i, order_id: orderId })))
  if (itErr) {
    await db.from('retail_orders').delete().eq('id', orderId)
    return { ok: false, error: itErr.message }
  }
  if (PAID_STATUSES.includes(status)) {
    const err = await applyStock(db, orderId, g.tenantId, true)
    if (err) {
      await db.from('retail_orders').update({ status: 'aguardando_pagamento', paid_at: null }).eq('id', orderId)
      revalidatePath('/varejo/pedidos')
      return { ok: false, error: `Pedido nº ${order.number} criado como "aguardando pagamento": ${err}` }
    }
    await onRetailOrderPaid(db, orderId, (await loadPricingConfig(db, g.tenantId)).loyalty)
  }
  revalidatePath('/varejo/pedidos'); revalidatePath('/varejo/clientes'); revalidatePath('/varejo/produtos')
  return { ok: true, id: orderId, number: order.number as number }
}

export async function updateRetailOrderStatus(orderId: string, status: string): Promise<Result> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  if (!isOrderStatus(status)) return { ok: false, error: 'Situação inválida.' }
  const db = await createScopedAdmin(g.tenantId)
  const { data: o } = await db.from('retail_orders').select('id, status, stock_applied, paid_at').eq('id', orderId).maybeSingle()
  if (!o) return { ok: false, error: 'Pedido não encontrado.' }
  if (o.status === 'cancelado' && status !== 'cancelado') return { ok: false, error: 'Pedido cancelado não volta. Crie um novo pedido.' }

  const wantsStock = PAID_STATUSES.includes(status)
  if (wantsStock && !o.stock_applied) {
    const err = await applyStock(db, orderId, g.tenantId, true)
    if (err) return { ok: false, error: err }
  }
  if (status === 'cancelado' && o.stock_applied) {
    const err = await applyStock(db, orderId, g.tenantId, false)
    if (err) return { ok: false, error: err }
  }
  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() }
  if (wantsStock && !o.paid_at) patch.paid_at = new Date().toISOString()
  if (status === 'cancelado') patch.cancelled_at = new Date().toISOString()
  const { error } = await db.from('retail_orders').update(patch).eq('id', orderId)
  if (error) return { ok: false, error: error.message }
  // Fidelidade: conta a compra (e gera cashback) no primeiro "pago"; cancelamento desfaz
  if (patch.paid_at) await onRetailOrderPaid(db, orderId, (await loadPricingConfig(db, g.tenantId)).loyalty)
  if (status === 'cancelado') await onRetailOrderCancelled(db, orderId)
  revalidatePath(`/varejo/pedidos/${orderId}`); revalidatePath('/varejo/pedidos'); revalidatePath('/varejo/clientes'); revalidatePath('/varejo/produtos')
  return { ok: true }
}

export async function updateRetailOrderPayment(orderId: string, input: { discount?: string | number | null; shipping?: string | number | null; payment_method?: string | null; payment_condition?: string | null; payment_link?: string | null; notes?: string | null }): Promise<Result<{ total: number }>> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  const db = await createScopedAdmin(g.tenantId)
  const { data: o } = await db.from('retail_orders').select('id, status, subtotal, loyalty_discount').eq('id', orderId).maybeSingle()
  if (!o) return { ok: false, error: 'Pedido não encontrado.' }
  if (o.status === 'cancelado') return { ok: false, error: 'Pedido cancelado não pode ser alterado.' }
  const loyalty = Number(o.loyalty_discount ?? 0)
  const discount = money(input.discount, 'Desconto'); if (!discount.ok) return discount
  const shipping = money(input.shipping, 'Frete'); if (!shipping.ok) return shipping
  const subtotal = Number(o.subtotal)
  if (discount.value + loyalty > subtotal) return { ok: false, error: loyalty ? 'Desconto + fidelidade passam do valor das peças.' : 'Desconto maior que o subtotal.' }
  if (input.payment_link && !cleanLink(input.payment_link)) return { ok: false, error: 'Link de pagamento inválido (use https://…).' }
  const total = round2(subtotal - discount.value - loyalty + shipping.value)
  const { error } = await db.from('retail_orders').update({
    discount: discount.value, shipping: shipping.value, total,
    payment_method: isPaymentMethod(input.payment_method) ? input.payment_method : null,
    payment_condition: cleanText(input.payment_condition, 200),
    payment_link: cleanLink(input.payment_link),
    notes: cleanLongText(input.notes, 2000),
    updated_at: new Date().toISOString(),
  }).eq('id', orderId)
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/varejo/pedidos/${orderId}`)
  return { ok: true, total }
}
