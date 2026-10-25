'use server'

// ─── Varejo: excluir pedido de teste ──────────────────────────────────────────
// Só o administrador da loja, ou o Super Admin durante um acesso liberado pela loja
// (única gravação permitida ao suporte, e fica no histórico de acessos da empresa).
// Devolve o estoque, desfaz a fidelidade e apaga o pedido com itens, mensagens e
// linha do tempo. A cliente sai junto só se pedirem e se ela não tiver mais nada.

import { revalidatePath } from 'next/cache'
import { hasFeature } from '@/lib/auth/access'
import { requireTenantId } from '@/lib/tenant/context'
import { createAdminClient } from '@/lib/supabase/admin'
import { scopeAdminClient } from '@/lib/tenant/scoped-admin'
import { getSupportSession, logSupport } from '@/lib/tenant/support'

type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
type Db = ReturnType<typeof createAdminClient>

async function guard(): Promise<{ tenantId: string; db: Db; support: Awaited<ReturnType<typeof getSupportSession>> } | { error: string }> {
  const access = await hasFeature('varejo')
  if (!access) return { error: 'Sem acesso ao módulo Varejo.' }
  const support = await getSupportSession()
  if (!support && !access.isAdmin) return { error: 'Só o administrador da loja exclui pedidos de teste.' }
  const tenantId = support ? support.tenantId : await requireTenantId()
  // Cliente admin preso à empresa (sem a trava de só leitura: esta é a exceção do suporte)
  return { tenantId, db: scopeAdminClient(createAdminClient(), tenantId, null), support }
}

// A cliente pode sair junto? (sem outros pedidos, sem histórico importado, sem saldo de fidelidade de outra compra)
async function customerRemovable(db: Db, customerId: string, orderId: string): Promise<boolean> {
  const [{ data: c }, { count: others }, { count: loyalty }] = await Promise.all([
    db.from('retail_customers').select('legacy_orders, legacy_total, legacy_last_purchase_at').eq('id', customerId).maybeSingle(),
    db.from('retail_orders').select('id', { count: 'exact', head: true }).eq('customer_id', customerId).neq('id', orderId),
    db.from('retail_loyalty_entries').select('id', { count: 'exact', head: true }).eq('customer_id', customerId).neq('order_id', orderId),
  ])
  if (!c) return false
  return !others && !loyalty && !c.legacy_orders && !Number(c.legacy_total ?? 0) && !c.legacy_last_purchase_at
}

export async function retailTestOrderInfo(orderId: string): Promise<Result<{ number: number; customerName: string | null; customerRemovable: boolean }>> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  if (!UUID.test(orderId)) return { ok: false, error: 'Pedido inválido.' }
  const { data: o } = await g.db.from('retail_orders').select('id, number, customer_id, retail_customers(name)').eq('id', orderId).maybeSingle()
  if (!o) return { ok: false, error: 'Pedido não encontrado.' }
  const name = (o as unknown as { retail_customers: { name: string } | null }).retail_customers?.name ?? null
  return { ok: true, number: o.number as number, customerName: name, customerRemovable: o.customer_id ? await customerRemovable(g.db, o.customer_id as string, orderId) : false }
}

export async function deleteRetailTestOrder(orderId: string, opts: { removeCustomer?: boolean } = {}): Promise<Result<{ number: number; customerRemoved: boolean }>> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  if (!UUID.test(orderId)) return { ok: false, error: 'Pedido inválido.' }
  const db = g.db
  const { data: o } = await db.from('retail_orders').select('id, number, stock_applied, customer_id').eq('id', orderId).maybeSingle()
  if (!o) return { ok: false, error: 'Pedido não encontrado.' }

  // 1. Estoque de volta (se tinha baixado)
  if (o.stock_applied) {
    const { data: msg, error } = await db.rpc('retail_apply_order_stock', { p_order: orderId, p_tenant: g.tenantId, p_apply: false })
    const problem = error ? error.message : (msg as string | null)
    if (problem) return { ok: false, error: `O estoque não voltou, então o pedido não foi excluído: ${problem}` }
  }
  // 2. Cliente sai junto? (decide antes de apagar o pedido)
  const removeCustomer = !!opts.removeCustomer && !!o.customer_id && await customerRemovable(db, o.customer_id as string, orderId)
  // 3. Apaga o pedido (itens, fidelidade dele, mensagens e linha do tempo vão juntos)
  const { error: delErr } = await db.from('retail_orders').delete().eq('id', orderId)
  if (delErr) {
    if (o.stock_applied) await db.rpc('retail_apply_order_stock', { p_order: orderId, p_tenant: g.tenantId, p_apply: true })
    return { ok: false, error: delErr.message }
  }
  let customerRemoved = false
  if (removeCustomer) {
    const { error } = await db.from('retail_customers').delete().eq('id', o.customer_id as string)
    customerRemoved = !error
  }
  if (g.support) {
    await logSupport({ tenantId: g.tenantId, grantId: g.support.grant.id, actorId: g.support.userId, actorName: g.support.userName, action: 'action', path: '/varejo/pedidos', detail: `Excluiu o pedido de teste nº ${o.number}${customerRemoved ? ' e a cliente de teste' : ''}` })
  }
  revalidatePath('/varejo/pedidos'); revalidatePath('/varejo/funil'); revalidatePath('/varejo/clientes'); revalidatePath('/varejo/produtos'); revalidatePath('/varejo/painel')
  return { ok: true, number: o.number as number, customerRemoved }
}
