// ─── Varejo: preço, margem, ponto de equilíbrio e fidelidade (contas puras) ────
// Sem banco e sem tela: só matemática, testada em margin.test.ts.
//
// Método do markup divisor (o mesmo ensinado pelo Sebrae):
//   preço = (custo da peça + custos por peça) ÷ (1 − %variáveis − %margem desejada)
//   %variáveis = impostos + taxa de cartão + outras (comissão…) + custo da fidelidade
//   markup (multiplicador) = preço ÷ custo da peça
//   margem de contribuição = preço − custo − custos por peça − %variáveis × preço
//   margem % = margem de contribuição ÷ preço        (sobre o PREÇO; markup é sobre o CUSTO)
//   preço mínimo (sem prejuízo) = (custo + custos por peça) ÷ (1 − %variáveis)
//   ponto de equilíbrio (peças) = custos fixos do mês ÷ margem de contribuição em R$
//   ponto de equilíbrio (R$) = custos fixos do mês ÷ margem %
// Percentuais entram como número de 0 a 100 (ex.: 6 = 6%).

export type LoyaltyMode = 'cashback' | 'cada_x' | 'progressivo'
export type LoyaltyTier = { min: number; pct: number }

export type LoyaltySettings = {
  enabled: boolean
  mode: LoyaltyMode
  cashback_pct: number      // % da compra que vira crédito em roupas
  cashback_days: number     // validade do crédito, em dias
  every_amount: number      // a cada R$ X em compras…
  every_pct: number         // …ganha Y% de desconto na próxima
  tiers: LoyaltyTier[]      // progressivo: comprou ≥ R$ min nos últimos 12 meses → pct%
}

export type PricingSettings = {
  tax_pct: number           // imposto sobre a venda (ex.: Simples Nacional)
  card_pct: number          // taxa média da maquininha / link de pagamento
  other_pct: number         // comissão, marketing por venda etc.
  per_piece: number         // R$ por peça: embalagem, etiqueta, sacola
  target_margin_pct: number // margem de contribuição desejada
  fixed_monthly: number     // custos fixos do mês: aluguel, salários, sistemas…
  avg_ticket: number        // valor médio de uma compra (usado no "a cada R$ X")
}

export const DEFAULT_PRICING: PricingSettings = { tax_pct: 0, card_pct: 0, other_pct: 0, per_piece: 0, target_margin_pct: 30, fixed_monthly: 0, avg_ticket: 0 }
export const DEFAULT_LOYALTY: LoyaltySettings = {
  enabled: false, mode: 'cashback', cashback_pct: 5, cashback_days: 90, every_amount: 1000, every_pct: 10,
  tiers: [{ min: 500, pct: 5 }, { min: 1500, pct: 8 }, { min: 3000, pct: 10 }],
}

const num = (v: unknown, min: number, max: number, fallback: number) => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.'))
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback
}

export function readPricing(raw: unknown): PricingSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    tax_pct: num(r.tax_pct, 0, 99, 0), card_pct: num(r.card_pct, 0, 99, 0), other_pct: num(r.other_pct, 0, 99, 0),
    per_piece: num(r.per_piece, 0, 100000, 0), target_margin_pct: num(r.target_margin_pct, 0, 95, DEFAULT_PRICING.target_margin_pct),
    fixed_monthly: num(r.fixed_monthly, 0, 1e9, 0), avg_ticket: num(r.avg_ticket, 0, 1e7, 0),
  }
}

export function readLoyalty(raw: unknown): LoyaltySettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const mode: LoyaltyMode = r.mode === 'cada_x' || r.mode === 'progressivo' ? r.mode : 'cashback'
  const tiers = (Array.isArray(r.tiers) ? r.tiers : DEFAULT_LOYALTY.tiers)
    .map(t => ({ min: num((t as LoyaltyTier)?.min, 0.01, 1e9, NaN), pct: num((t as LoyaltyTier)?.pct, 0.01, 90, NaN) }))
    .filter(t => Number.isFinite(t.min) && Number.isFinite(t.pct))
    .sort((a, b) => a.min - b.min)
    .slice(0, 6)
  return {
    enabled: r.enabled === true, mode,
    cashback_pct: num(r.cashback_pct, 0.1, 50, DEFAULT_LOYALTY.cashback_pct),
    cashback_days: Math.round(num(r.cashback_days, 7, 730, DEFAULT_LOYALTY.cashback_days)),
    every_amount: num(r.every_amount, 1, 1e7, DEFAULT_LOYALTY.every_amount),
    every_pct: num(r.every_pct, 0.1, 90, DEFAULT_LOYALTY.every_pct),
    tiers,
  }
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
// Para cima no centavo: o preço sugerido nunca fica abaixo da margem desejada
export const ceil2 = (n: number) => Math.ceil(n * 100 - 1e-6) / 100

// Quanto a fidelidade custa, em % do preço, para reservar na precificação.
// - cashback: o crédito dado (considera que toda cliente usa; é o cenário mais caro)
// - a cada R$ X ganha Y%: desconto Y sobre a compra seguinte (ticket médio T)
//     → custo ≈ Y × T ÷ (X + T)   (sem ticket médio, considera T = X)
// - progressivo: o maior desconto da escada (cenário mais caro)
export function loyaltyCostPct(l: LoyaltySettings, avgTicket = 0): number {
  if (!l.enabled) return 0
  if (l.mode === 'cashback') return l.cashback_pct
  if (l.mode === 'progressivo') return l.tiers.reduce((m, t) => Math.max(m, t.pct), 0)
  const X = l.every_amount, T = avgTicket > 0 ? avgTicket : X
  return (l.every_pct * T) / (X + T)
}

export function variablePct(p: PricingSettings, l: LoyaltySettings): number {
  return p.tax_pct + p.card_pct + p.other_pct + loyaltyCostPct(l, p.avg_ticket)
}

export type PriceSuggestion = { ok: true; price: number; markup: number } | { ok: false; reason: string }

// Preço de referência para a margem desejada
export function referencePrice(cost: number, p: PricingSettings, l: LoyaltySettings, marginPct = p.target_margin_pct): PriceSuggestion {
  if (!(cost > 0)) return { ok: false, reason: 'Informe o custo da peça.' }
  const v = variablePct(p, l)
  const denom = 1 - (v + marginPct) / 100
  if (denom <= 0.0001) return { ok: false, reason: `Custos variáveis (${v.toFixed(1)}%) + margem desejada (${marginPct.toFixed(1)}%) chegam a 100% ou mais: não existe preço que feche essa conta. Reduza a margem ou os custos.` }
  const price = ceil2((cost + p.per_piece) / denom)
  return { ok: true, price, markup: price / cost }
}

export type PriceAnalysis = {
  price: number
  markup: number | null          // multiplicador sobre o custo (ex.: 2,00)
  markupPct: number | null       // acréscimo sobre o custo (ex.: 100%)
  variableCost: number           // R$ de impostos, taxas e fidelidade nesta venda
  contribution: number           // R$ que sobra para pagar os custos fixos e dar lucro
  marginPct: number              // contribuição ÷ preço
  minPrice: number | null        // abaixo disto, a venda dá prejuízo (contribuição < 0)
  breakEvenUnits: number | null  // peças iguais a esta para pagar os custos fixos do mês
}

export function analyzePrice(price: number, cost: number, p: PricingSettings, l: LoyaltySettings): PriceAnalysis {
  const v = variablePct(p, l) / 100
  const variableCost = price * v
  const contribution = price - cost - p.per_piece - variableCost
  const minPrice = v < 1 ? ceil2((cost + p.per_piece) / (1 - v)) : null
  return {
    price,
    markup: cost > 0 ? price / cost : null,
    markupPct: cost > 0 ? (price / cost - 1) * 100 : null,
    variableCost,
    contribution,
    marginPct: price > 0 ? (contribution / price) * 100 : 0,
    minPrice,
    breakEvenUnits: p.fixed_monthly > 0 && contribution > 0 ? Math.ceil(p.fixed_monthly / contribution - 1e-9) : null,
  }
}

// Faturamento que a loja precisa no mês para pagar os custos fixos, com a margem média informada
export function breakEvenRevenue(fixedMonthly: number, marginPct: number): number | null {
  return fixedMonthly > 0 && marginPct > 0 ? round2(fixedMonthly / (marginPct / 100)) : null
}

// ─── Pedido: quanto a venda deixa e até onde dá para negociar ────────────────
export type OrderLine = { qty: number; unit_price: number; unit_cost: number | null }

export type OrderAnalysis = {
  revenue: number            // peças − descontos (frete fica de fora: é repasse)
  cost: number               // custo das peças + custos por peça
  variableCost: number
  contribution: number
  marginPct: number
  missingCost: number        // itens sem custo cadastrado (conta fica incompleta)
  minRevenue: number | null  // menor valor das peças sem prejuízo
  minRevenueTarget: number | null // menor valor mantendo a margem desejada
  maxDiscount: number | null // desconto máximo sem prejuízo, sobre o valor atual
}

// %variáveis no pedido: impostos + cartão + outras + cashback gerado (se for o formato).
// Nos formatos de desconto, o custo da fidelidade já está no desconto do próprio pedido.
export function orderVariablePct(p: PricingSettings, l: LoyaltySettings): number {
  return p.tax_pct + p.card_pct + p.other_pct + (l.enabled && l.mode === 'cashback' ? l.cashback_pct : 0)
}

export function analyzeOrder(lines: OrderLine[], discounts: number, p: PricingSettings, l: LoyaltySettings): OrderAnalysis {
  const subtotal = lines.reduce((s, i) => s + i.qty * i.unit_price, 0)
  const units = lines.reduce((s, i) => s + i.qty, 0)
  const cost = lines.reduce((s, i) => s + i.qty * (i.unit_cost ?? 0), 0) + units * p.per_piece
  const missingCost = lines.filter(i => i.unit_cost === null || i.unit_cost === undefined).reduce((s, i) => s + i.qty, 0)
  const revenue = Math.max(0, subtotal - discounts)
  const v = orderVariablePct(p, l) / 100
  const variableCost = revenue * v
  const contribution = revenue - cost - variableCost
  const minRevenue = v < 1 ? ceil2(cost / (1 - v)) : null
  const t = 1 - v - p.target_margin_pct / 100
  const minRevenueTarget = t > 0 ? ceil2(cost / t) : null
  return {
    revenue: round2(revenue), cost: round2(cost), variableCost: round2(variableCost), contribution: round2(contribution),
    marginPct: revenue > 0 ? (contribution / revenue) * 100 : 0,
    missingCost, minRevenue, minRevenueTarget,
    maxDiscount: minRevenue === null ? null : round2(Math.max(0, revenue - minRevenue)),
  }
}

// ─── Fidelidade da cliente ────────────────────────────────────────────────────
export type CashbackEntry = { kind: 'credito' | 'uso'; amount: number; at: string; expires_at?: string | null }

// Saldo de cashback: usos consomem primeiro o crédito que vence antes (FIFO por
// validade); o que vence sem uso some. Nunca vira dinheiro.
export function cashbackBalance(entries: CashbackEntry[], now = new Date()): { balance: number; nextExpiry: string | null; expiringAmount: number } {
  type Lot = { left: number; exp: number; expIso: string }
  const lots: Lot[] = []
  const sorted = [...entries].sort((a, b) => a.at.localeCompare(b.at) || (a.kind === 'credito' ? -1 : 1))
  for (const e of sorted) {
    const t = Date.parse(e.at)
    if (e.kind === 'credito') {
      const expIso = e.expires_at ?? e.at
      lots.push({ left: e.amount, exp: Date.parse(expIso), expIso })
    } else {
      let need = e.amount
      for (const lot of lots.filter(x => x.left > 0 && x.exp >= t).sort((a, b) => a.exp - b.exp)) {
        const take = Math.min(lot.left, need); lot.left -= take; need -= take
        if (need <= 0.00001) break
      }
    }
  }
  const nowT = now.getTime()
  const valid = lots.filter(x => x.left > 0.00001 && x.exp >= nowT).sort((a, b) => a.exp - b.exp)
  return {
    balance: round2(valid.reduce((s, x) => s + x.left, 0)),
    nextExpiry: valid[0]?.expIso ?? null,
    expiringAmount: round2(valid.filter(x => x.expIso === valid[0]?.expIso).reduce((s, x) => s + x.left, 0)),
  }
}

// "A cada R$ X em compras, ganha Y%": prêmios conquistados − prêmios já usados
export function everyRewards(spent: number, used: number, l: LoyaltySettings): { available: number; progress: number; missing: number } {
  const earned = Math.floor((spent + 1e-6) / l.every_amount)
  const progress = spent - earned * l.every_amount
  return { available: Math.max(0, earned - used), progress: round2(progress), missing: round2(l.every_amount - progress) }
}

// Progressivo: nível pelo que comprou nos últimos 12 meses
export function tierFor(spent12m: number, l: LoyaltySettings): { pct: number; next: LoyaltyTier | null; missing: number | null } {
  let pct = 0
  for (const t of l.tiers) if (spent12m + 1e-6 >= t.min) pct = t.pct
  const next = l.tiers.find(t => spent12m + 1e-6 < t.min) ?? null
  return { pct, next, missing: next ? round2(next.min - spent12m) : null }
}
