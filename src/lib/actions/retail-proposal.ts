'use server'

// ─── Varejo: proposta do pedido ───────────────────────────────────────────────
// A equipe gera a proposta a partir do pedido (dados que já estão no CRM); a cliente
// abre o link, escolhe a condição (Pix ou cartão) e aceita. O pedido vira
// "aguardando pagamento" com a condição escolhida e ela vê o link de pagamento.
// Aceite é público (link com token de 32 caracteres): usa o cliente admin e
// filtra pela empresa do próprio pedido.

import { randomBytes } from 'crypto'
import { revalidatePath } from 'next/cache'
import { hasFeature } from '@/lib/auth/access'
import { requireTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSupportSession } from '@/lib/tenant/support'
import { cleanText } from '@/lib/retail/products'
import { loadPricingConfig } from '@/lib/retail/loyalty-server'
import { buildProposal, isProposal } from '@/lib/retail/proposal'
import { round2 } from '@/lib/retail/margin'
import { appBaseUrl } from '@/lib/whatsapp/webhook-token'

type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string }

function cleanLink(v: unknown): string | null {
  const s = cleanText(v, 500)
  if (!s) return null
  try { const u = new URL(s); return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null } catch { return null }
}

export async function createRetailProposal(orderId: string, links: { pix?: string | null; card?: string | null }): Promise<Result<{ url: string }>> {
  const access = await hasFeature('varejo')
  if (!access) return { ok: false, error: 'Sem acesso ao módulo Varejo.' }
  if (await getSupportSession()) return { ok: false, error: 'Acesso de suporte é só leitura.' }
  const tenantId = await requireTenantId()
  if (links.pix && !cleanLink(links.pix)) return { ok: false, error: 'Link do Pix inválido (use https://…).' }
  if (links.card && !cleanLink(links.card)) return { ok: false, error: 'Link do cartão inválido (use https://…).' }
  const db = await createScopedAdmin(tenantId)
  const { data } = await db.from('retail_orders')
    .select('id, number, status, stock_applied, discount, loyalty_discount, shipping, proposal_token, proposal_accepted_at, retail_customers(name, phone), retail_order_items(name, color, size, qty, unit_price, unit_cost, retail_products(cost_price))')
    .eq('id', orderId).maybeSingle()
  if (!data) return { ok: false, error: 'Pedido não encontrado.' }
  const o = data as unknown as {
    id: string; number: number; status: string; stock_applied: boolean; discount: number; loyalty_discount: number; shipping: number
    proposal_token: string | null; proposal_accepted_at: string | null
    retail_customers: { name: string; phone: string | null } | null
    retail_order_items: { name: string; color: string | null; size: string | null; qty: number; unit_price: number; unit_cost: number | null; retail_products: { cost_price: number | null } | null }[]
  }
  if (o.status === 'cancelado' || o.stock_applied) return { ok: false, error: 'Pedido já pago ou cancelado.' }
  if (o.proposal_accepted_at) return { ok: false, error: 'A cliente já aceitou esta proposta.' }
  if (!o.retail_order_items.length) return { ok: false, error: 'O pedido não tem peças.' }

  const cfg = await loadPricingConfig(db, tenantId)
  if (!cfg.conditions.pix.enabled && !cfg.conditions.card.enabled) return { ok: false, error: 'Ligue ao menos uma condição de pagamento em Varejo → Preço e fidelidade.' }
  const { data: org } = await db.from('organization_settings').select('company_name, name').eq('tenant_id', tenantId).maybeSingle()
  const proposal = buildProposal({
    number: o.number,
    store: ((org?.company_name as string | null) || (org?.name as string | null) || 'Loja').trim(),
    customer: { name: o.retail_customers?.name ?? null, phone: o.retail_customers?.phone ?? null },
    items: o.retail_order_items.map(i => ({
      name: i.name, color: i.color, size: i.size, qty: i.qty, unit_price: Number(i.unit_price),
      unit_cost: i.unit_cost !== null && i.unit_cost !== undefined ? Number(i.unit_cost) : i.retail_products?.cost_price !== null && i.retail_products?.cost_price !== undefined ? Number(i.retail_products.cost_price) : null,
    })),
    discount: Number(o.discount), loyaltyDiscount: Number(o.loyalty_discount ?? 0), shipping: Number(o.shipping),
    pricing: cfg.pricing, loyalty: cfg.loyalty, conditions: cfg.conditions,
    links: { pix: cleanLink(links.pix), card: cleanLink(links.card) },
  })
  const token = o.proposal_token ?? randomBytes(24).toString('base64url') // 32 caracteres
  const { error } = await db.from('retail_orders').update({
    proposal_token: token, proposal, proposal_sent_at: new Date().toISOString(), proposal_choice: null, updated_at: new Date().toISOString(),
  }).eq('id', orderId)
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/varejo/pedidos/${orderId}`)
  return { ok: true, url: `${appBaseUrl()}/loja/proposta/${token}` }
}

// Público: a cliente aceita a condição escolhida
export async function acceptRetailProposal(token: string, choice: string): Promise<Result<{ link: string | null; label: string }>> {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(token)) return { ok: false, error: 'Link inválido.' }
  if (choice !== 'pix' && choice !== 'card') return { ok: false, error: 'Escolha uma condição.' }
  const admin = createAdminClient()
  const { data: o } = await admin.from('retail_orders')
    .select('id, tenant_id, number, status, stock_applied, subtotal, discount, loyalty_discount, shipping, proposal, proposal_accepted_at, proposal_choice')
    .eq('proposal_token', token).maybeSingle()
  if (!o || !isProposal(o.proposal)) return { ok: false, error: 'Proposta não encontrada.' }
  const proposal = o.proposal
  const opt = proposal.options.find(x => x.id === choice)
  if (!opt) return { ok: false, error: 'Condição indisponível.' }
  if (o.proposal_accepted_at) {
    const chosen = proposal.options.find(x => x.id === o.proposal_choice)
    return { ok: true, link: chosen?.link ?? null, label: chosen?.label ?? opt.label }
  }
  if (o.status === 'cancelado' || o.stock_applied) return { ok: false, error: 'Este pedido não está mais aberto. Fale com a loja.' }
  const today = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10)
  if (proposal.valid_until < today) return { ok: false, error: 'Esta proposta venceu. Peça uma nova para a loja.' }

  const discount = round2(Number(o.discount) + opt.discount)
  const total = round2(Number(o.subtotal) - discount - Number(o.loyalty_discount ?? 0) + Number(o.shipping))
  const { error } = await admin.from('retail_orders').update({
    proposal_choice: choice, proposal_accepted_at: new Date().toISOString(),
    status: o.status === 'enviado_atendimento' ? 'aguardando_pagamento' : o.status,
    discount, total,
    payment_method: choice === 'pix' ? 'pix' : 'cartao',
    payment_condition: opt.label,
    ...(opt.link ? { payment_link: opt.link } : {}),
    updated_at: new Date().toISOString(),
  }).eq('id', o.id).eq('tenant_id', o.tenant_id).is('proposal_accepted_at', null)
  if (error) return { ok: false, error: 'Não foi possível registrar agora. Tente de novo.' }

  // Aviso para os administradores da loja
  const { data: admins } = await admin.from('profiles').select('id').eq('tenant_id', o.tenant_id).eq('role', 'admin').limit(20)
  if (admins?.length) {
    await admin.from('notifications').insert(admins.map(a => ({
      user_id: a.id, tenant_id: o.tenant_id, read: false,
      message: `Pedido nº ${o.number}: ${proposal.customer.name ?? 'a cliente'} aceitou a proposta (${opt.label}).${opt.link ? ' O link de pagamento já foi mostrado a ela.' : ' Mande o link de pagamento.'}`,
    })))
  }
  return { ok: true, link: opt.link, label: opt.label }
}
