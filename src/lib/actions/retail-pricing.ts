'use server'

// ─── Varejo: precificação e fidelidade (ações) ────────────────────────────────
// Configurações da loja em organization_settings.retail_settings.{pricing,loyalty}.
// Benefício de fidelidade aplicado no pedido é sempre calculado aqui (nunca vem da tela).

import { revalidatePath } from 'next/cache'
import { hasFeature } from '@/lib/auth/access'
import { requireTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { getSupportSession } from '@/lib/tenant/support'
import { readLoyalty, readPricing, readTaxRegimes, regimeAt, round2, loyaltyUnitText, type LoyaltySettings, type PricingSettings, type TaxRegime } from '@/lib/retail/margin'
import { parseMoney } from '@/lib/retail/products'
import { customerLoyalty, loadPricingConfig } from '@/lib/retail/loyalty-server'
import { readDashboardBlocks } from '@/lib/retail/dashboard-blocks'

type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string }

async function guard(adminOnly = false): Promise<{ tenantId: string } | { error: string }> {
  const access = await hasFeature('varejo')
  if (!access) return { error: 'Sem acesso ao módulo Varejo.' }
  if (adminOnly && !access.isAdmin) return { error: 'Só o administrador pode mudar a precificação e a fidelidade.' }
  if (await getSupportSession()) return { error: 'Acesso de suporte é só leitura.' }
  return { tenantId: await requireTenantId() }
}

export async function saveRetailPricing(input: { pricing: PricingSettings; loyalty: LoyaltySettings; regimes: TaxRegime[] }): Promise<Result> {
  const g = await guard(true)
  if ('error' in g) return { ok: false, error: g.error }
  const regimes = readTaxRegimes(input.regimes)
  if (regimes.length !== (input.regimes ?? []).length) return { ok: false, error: 'Confira os regimes de imposto: cada um precisa de tipo e data de início.' }
  if (new Set(regimes.map(r => r.since)).size !== regimes.length) return { ok: false, error: 'Dois regimes começando na mesma data. Ajuste a data de um deles.' }
  // imposto em vigor hoje vem do regime (sem regime cadastrado, fica o percentual informado)
  const current = regimeAt(regimes, new Date())
  const pricing = readPricing({ ...input.pricing, tax_pct: current ? current.rate_pct : input.pricing.tax_pct })
  const loyalty = readLoyalty(input.loyalty)
  if (pricing.tax_pct + pricing.card_pct + pricing.other_pct + pricing.target_margin_pct >= 100) {
    return { ok: false, error: 'Impostos + taxas + margem desejada passam de 100%: não existe preço que feche essa conta.' }
  }
  if (loyalty.enabled && loyalty.mode === 'progressivo' && !loyalty.tiers.length) return { ok: false, error: 'Cadastre ao menos um degrau do desconto progressivo.' }
  const db = await createScopedAdmin(g.tenantId)
  const { raw } = await loadPricingConfig(db, g.tenantId)
  const prev = readLoyalty(raw.loyalty)
  const merged = {
    ...raw,
    pricing,
    tax_regimes: regimes,
    // mudou a regra do "a cada X": a contagem recomeça agora (compras antigas não viram prêmio na regra nova)
    loyalty: { ...loyalty, changed_at: prev.enabled !== loyalty.enabled || prev.mode !== loyalty.mode || prev.every_unit !== loyalty.every_unit || prev.every_amount !== loyalty.every_amount ? new Date().toISOString() : prev.changed_at ?? null },
  }
  const { error } = await db.from('organization_settings').update({ retail_settings: merged }).eq('tenant_id', g.tenantId)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/varejo/precificacao'); revalidatePath('/varejo/produtos')
  return { ok: true }
}

async function recomputeTotal(db: Awaited<ReturnType<typeof createScopedAdmin>>, orderId: string, loyaltyDiscount: number, kind: string | null): Promise<string | null> {
  const { data: o } = await db.from('retail_orders').select('subtotal, discount, shipping').eq('id', orderId).maybeSingle()
  if (!o) return 'Pedido não encontrado.'
  const total = round2(Number(o.subtotal) - Number(o.discount) - loyaltyDiscount + Number(o.shipping))
  const { error } = await db.from('retail_orders').update({ loyalty_discount: loyaltyDiscount, loyalty_kind: kind, total, updated_at: new Date().toISOString() }).eq('id', orderId)
  return error?.message ?? null
}

// Usa o benefício que a cliente tem neste pedido (antes de ser pago)
export async function applyOrderLoyalty(orderId: string): Promise<Result<{ amount: number }>> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  const db = await createScopedAdmin(g.tenantId)
  const { loyalty } = await loadPricingConfig(db, g.tenantId)
  if (!loyalty.enabled) return { ok: false, error: 'A fidelidade está desligada em Varejo → Preço e fidelidade.' }
  const { data: o } = await db.from('retail_orders').select('id, status, customer_id, subtotal, discount, stock_applied, loyalty_discount').eq('id', orderId).maybeSingle()
  if (!o) return { ok: false, error: 'Pedido não encontrado.' }
  if (!o.customer_id) return { ok: false, error: 'Ligue uma cliente ao pedido para usar a fidelidade.' }
  if (o.status === 'cancelado' || o.stock_applied) return { ok: false, error: 'Use a fidelidade antes de marcar o pedido como pago.' }
  if (Number(o.loyalty_discount) > 0) return { ok: false, error: 'Este pedido já tem benefício de fidelidade.' }
  const base = round2(Number(o.subtotal) - Number(o.discount))
  if (base <= 0) return { ok: false, error: 'Sem valor de peças para aplicar o benefício.' }

  const st = await customerLoyalty(db, o.customer_id as string, loyalty, orderId)
  let amount = 0
  if (st.mode === 'cashback') {
    amount = round2(Math.min(st.balance, base))
    if (amount <= 0) return { ok: false, error: 'A cliente não tem crédito de cashback válido.' }
    const { error } = await db.from('retail_loyalty_entries').insert({ customer_id: o.customer_id, order_id: orderId, kind: 'uso', amount })
    if (error) return { ok: false, error: error.message }
  } else if (st.mode === 'cada_x') {
    if (st.available < 1) return { ok: false, error: `Ainda falta${st.missing === 1 && st.unit !== 'valor' ? '' : 'm'} ${loyaltyUnitText(st.missing, st.unit, v => `R$ ${v.toFixed(2).replace('.', ',')}`)} para ela ganhar o desconto.` }
    amount = round2(base * st.pct / 100)
  } else if (st.mode === 'progressivo') {
    if (st.pct <= 0) return { ok: false, error: 'A cliente ainda não chegou ao primeiro nível do desconto progressivo.' }
    amount = round2(base * st.pct / 100)
  } else return { ok: false, error: 'Fidelidade desligada.' }

  const err = await recomputeTotal(db, orderId, amount, loyalty.mode)
  if (err) {
    await db.from('retail_loyalty_entries').delete().eq('order_id', orderId).eq('kind', 'uso')
    return { ok: false, error: err }
  }
  revalidatePath(`/varejo/pedidos/${orderId}`)
  return { ok: true, amount }
}

export async function removeOrderLoyalty(orderId: string): Promise<Result> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  const db = await createScopedAdmin(g.tenantId)
  const { data: o } = await db.from('retail_orders').select('id, status, stock_applied').eq('id', orderId).maybeSingle()
  if (!o) return { ok: false, error: 'Pedido não encontrado.' }
  if (o.status === 'cancelado' || o.stock_applied) return { ok: false, error: 'Pedido já pago ou cancelado: o benefício não muda mais.' }
  await db.from('retail_loyalty_entries').delete().eq('order_id', orderId).eq('kind', 'uso')
  const err = await recomputeTotal(db, orderId, 0, null)
  if (err) return { ok: false, error: err }
  revalidatePath(`/varejo/pedidos/${orderId}`)
  return { ok: true }
}

// Blocos do Painel do Varejo (quais aparecem e em que ordem)
export async function saveRetailDashboard(blocks: string[]): Promise<Result> {
  const g = await guard(true)
  if ('error' in g) return { ok: false, error: g.error }
  const list = readDashboardBlocks(Array.isArray(blocks) ? blocks : [])
  const db = await createScopedAdmin(g.tenantId)
  const { raw } = await loadPricingConfig(db, g.tenantId)
  const { error } = await db.from('organization_settings').update({ retail_settings: { ...raw, dashboard: list } }).eq('tenant_id', g.tenantId)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/varejo/painel')
  return { ok: true }
}

// Aplica um preço na peça direto da tela de precificação (ex.: o preço de referência)
export async function setRetailProductPrice(productId: string, price: string | number): Promise<Result> {
  const g = await guard(true)
  if ('error' in g) return { ok: false, error: g.error }
  const value = parseMoney(price)
  if (value === null || value <= 0) return { ok: false, error: 'Preço inválido.' }
  const db = await createScopedAdmin(g.tenantId)
  const { data, error } = await db.from('retail_products').update({ price: value, updated_at: new Date().toISOString() }).eq('id', productId).select('id').maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: 'Peça não encontrada.' }
  revalidatePath('/varejo/precificacao'); revalidatePath('/varejo/produtos'); revalidatePath(`/varejo/produtos/${productId}`)
  return { ok: true }
}
