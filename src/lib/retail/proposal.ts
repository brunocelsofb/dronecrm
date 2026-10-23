// ─── Varejo: proposta do pedido para a cliente ────────────────────────────────
// Retrato do que a cliente vê (itens, valores e condições). NUNCA leva custo nem
// margem: a página e o PDF são públicos (link com token).

import { conditionOptions, round2, type LoyaltySettings, type OrderLine, type PaymentConditions, type PricingSettings } from './margin'

export type ProposalOption = {
  id: 'pix' | 'card'; label: string
  discount: number; total: number; grand_total: number
  installments: number; installmentValue: number
  link: string | null
}

export type RetailProposal = {
  number: number
  store: string
  customer: { name: string | null; phone: string | null }
  created_at: string
  valid_until: string // aaaa-mm-dd
  items: { name: string; detail: string | null; qty: number; unit_price: number; total: number }[]
  subtotal: number
  discount: number         // descontos combinados no pedido
  loyalty_discount: number // fidelidade
  shipping: number
  options: ProposalOption[]
}

export const PROPOSAL_VALID_DAYS = 7

export function buildProposal(input: {
  number: number; store: string; customer: { name: string | null; phone: string | null }
  items: { name: string; color: string | null; size: string | null; qty: number; unit_price: number; unit_cost: number | null }[]
  discount: number; loyaltyDiscount: number; shipping: number
  pricing: PricingSettings; loyalty: LoyaltySettings; conditions: PaymentConditions
  links: { pix?: string | null; card?: string | null }
  now?: Date
}): RetailProposal {
  const now = input.now ?? new Date()
  const lines: OrderLine[] = input.items.map(i => ({ qty: i.qty, unit_price: i.unit_price, unit_cost: i.unit_cost }))
  const subtotal = round2(input.items.reduce((s, i) => s + i.qty * i.unit_price, 0))
  const options = conditionOptions(lines, input.discount + input.loyaltyDiscount, input.pricing, input.loyalty, input.conditions)
  const valid = new Date(now.getTime() - 3 * 3_600_000 + PROPOSAL_VALID_DAYS * 86_400_000).toISOString().slice(0, 10)
  return {
    number: input.number, store: input.store, customer: input.customer,
    created_at: now.toISOString(), valid_until: valid,
    items: input.items.map(i => ({ name: i.name, detail: [i.color, i.size].filter(Boolean).join(' / ') || null, qty: i.qty, unit_price: round2(i.unit_price), total: round2(i.qty * i.unit_price) })),
    subtotal, discount: round2(input.discount), loyalty_discount: round2(input.loyaltyDiscount), shipping: round2(input.shipping),
    options: options.map(o => ({
      id: o.id, label: o.label, discount: o.discount, total: o.total, grand_total: round2(o.total + input.shipping),
      installments: o.installments, installmentValue: o.installments > 1 ? round2((o.total + input.shipping) / o.installments) : round2(o.total + input.shipping),
      link: (o.id === 'pix' ? input.links.pix : input.links.card) || null,
    })),
  }
}

export function isProposal(v: unknown): v is RetailProposal {
  const p = v as RetailProposal | null
  return !!p && Array.isArray(p.items) && Array.isArray(p.options) && typeof p.number === 'number'
}
