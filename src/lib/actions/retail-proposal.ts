'use server'

// ─── Varejo: "Finalizar compra" ───────────────────────────────────────────────
// A equipe gera o link do pedido (dados que já estão no CRM) e manda no WhatsApp;
// o pedido vai para "aguardando pagamento". A cliente abre, escolhe Pix ou cartão
// e vai direto para o pagamento (InfinitePay, Mercado Pago ou link colado).
// Sem etapa de aceite. A página e a escolha são públicas (token de 32 caracteres):
// usam o cliente admin preso à empresa do próprio pedido.

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
import { scopeAdminClient } from '@/lib/tenant/scoped-admin'
import { notifyStoreAdmins } from '@/lib/retail/checkout-server'
import { createProviderLink, loadPaymentAccounts } from '@/lib/retail/payment-providers'
import { providerFor, reusableLink, type PaymentLink } from '@/lib/retail/payments'

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
    proposal_token: token, proposal, proposal_sent_at: new Date().toISOString(), proposal_choice: null, proposal_accepted_at: null,
    checkout_notified_at: null, updated_at: new Date().toISOString(),
    // Link de "Finalizar compra" enviado = aguardando pagamento (sem etapa de aceite)
    ...(o.status === 'carrinho' || o.status === 'enviado_atendimento' ? { status: 'aguardando_pagamento' } : {}),
  }).eq('id', orderId)
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/varejo/pedidos/${orderId}`); revalidatePath('/varejo/funil')
  return { ok: true, url: `${appBaseUrl()}/loja/proposta/${token}` }
}

// Público: a cliente escolhe Pix ou cartão em "Finalizar compra" e vai direto para o pagamento.
// Com InfinitePay/Mercado Pago, o Drone gera o link com o valor exato da escolha (e reaproveita
// o mesmo link se ela clicar de novo). No manual, usa o link colado pela equipe.
export async function startRetailPayment(token: string, choice: string): Promise<Result<{ url: string | null; label: string }>> {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(token)) return { ok: false, error: 'Link inválido.' }
  if (choice !== 'pix' && choice !== 'card') return { ok: false, error: 'Escolha como pagar.' }
  const admin = createAdminClient()
  const { data: o } = await admin.from('retail_orders')
    .select('id, tenant_id, number, status, stock_applied, subtotal, discount, loyalty_discount, shipping, proposal, proposal_sent_at, payment_links, checkout_notified_at, retail_customers(name, phone)')
    .eq('proposal_token', token).maybeSingle()
  if (!o || !isProposal(o.proposal)) return { ok: false, error: 'Pedido não encontrado.' }
  const proposal = o.proposal
  const opt = proposal.options.find(x => x.id === choice)
  if (!opt) return { ok: false, error: 'Forma de pagamento indisponível.' }
  if (o.stock_applied || ['pago', 'enviado', 'entregue'].includes(o.status as string)) return { ok: false, error: 'Este pedido já está pago. Obrigado!' }
  if (o.status === 'cancelado') return { ok: false, error: 'Este pedido foi encerrado. Fale com a loja.' }
  const today = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10)
  if (proposal.valid_until < today) return { ok: false, error: 'Este link venceu. Peça um novo para a loja pelo WhatsApp.' }

  const db = scopeAdminClient(admin, o.tenant_id as string, null)
  const accounts = await loadPaymentAccounts(o.tenant_id as string)
  const provider = providerFor(accounts.setup, choice)
  const version = String(o.proposal_sent_at ?? proposal.created_at)
  const now = new Date().toISOString()

  if (provider === 'manual') {
    // Sem serviço ligado: registra a escolha (valores da condição) e usa o link colado, se houver
    const discount = round2(proposal.discount + opt.discount)
    await db.from('retail_orders').update({
      proposal_choice: choice, proposal_accepted_at: now, discount,
      total: round2(proposal.subtotal - discount - proposal.loyalty_discount + proposal.shipping),
      payment_method: choice === 'pix' ? 'pix' : 'cartao', payment_condition: opt.label, payment_provider: 'manual',
      ...(opt.link ? { payment_link: opt.link } : {}), updated_at: now,
    }).eq('id', o.id)
    if (!opt.link && !o.checkout_notified_at) {
      await db.from('retail_orders').update({ checkout_notified_at: now }).eq('id', o.id)
      await notifyStoreAdmins(o.tenant_id as string, `Pedido nº ${o.number}: ${proposal.customer.name ?? 'a cliente'} escolheu ${opt.label}. Mande o link de pagamento pelo WhatsApp.`)
    }
    return { ok: true, url: opt.link, label: opt.label }
  }

  const links = (o.payment_links ?? {}) as Record<string, PaymentLink>
  const reuse = reusableLink(links, choice, version)
  if (reuse && reuse.link.provider === provider) {
    await db.from('retail_orders').update({ proposal_choice: choice, updated_at: now }).eq('id', o.id)
    return { ok: true, url: reuse.link.url, label: opt.label }
  }
  const ref = `${token.slice(0, 10)}-${choice}-${randomBytes(4).toString('hex')}`
  const customer = o.retail_customers as unknown as { name: string; phone: string | null } | null
  const created = await createProviderLink({
    provider, accounts, ref, token, amount: opt.grand_total, choice,
    description: `Pedido nº ${proposal.number} · ${proposal.store}`,
    maxInstallments: opt.installments, customer: { name: customer?.name ?? null, phone: customer?.phone ?? null }, baseUrl: appBaseUrl(),
  })
  if (!created.ok) {
    console.error('[varejo-pagamento] pedido', o.number, created.error)
    if (!o.checkout_notified_at) {
      await db.from('retail_orders').update({ checkout_notified_at: now }).eq('id', o.id)
      await notifyStoreAdmins(o.tenant_id as string, `Pedido nº ${o.number}: não foi possível gerar o link de pagamento (${created.error}) Mande o link pelo WhatsApp.`)
    }
    return { ok: false, error: 'Não conseguimos abrir o pagamento agora. Tente de novo em instantes ou fale com a loja.' }
  }
  const link: PaymentLink = { choice, provider, url: created.url, amount: opt.grand_total, discount: opt.discount, version, created_at: now }
  // Relê antes de gravar para não perder um link criado ao mesmo tempo
  const { data: fresh } = await db.from('retail_orders').select('payment_links').eq('id', o.id).maybeSingle()
  const merged = { ...((fresh?.payment_links ?? {}) as Record<string, PaymentLink>), [ref]: link }
  const { error } = await db.from('retail_orders').update({ payment_links: merged, proposal_choice: choice, updated_at: now }).eq('id', o.id)
  if (error) return { ok: false, error: 'Não conseguimos abrir o pagamento agora. Tente de novo.' }
  return { ok: true, url: created.url, label: opt.label }
}
