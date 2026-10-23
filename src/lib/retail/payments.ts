// ─── Varejo: link de pagamento (regras puras, sem imports — testadas com o Node) ─
// Cada loja escolhe, por condição (Pix / cartão), quem gera o link: InfinitePay,
// Mercado Pago ou "manual" (a equipe cola o link). O Drone cria o link com o
// valor exato da condição escolhida pela cliente em "Finalizar compra".

export type PayProvider = 'manual' | 'infinitepay' | 'mercadopago'
export const PAY_PROVIDERS: { id: PayProvider; label: string }[] = [
  { id: 'manual', label: 'Manual (colar o link)' },
  { id: 'infinitepay', label: 'InfinitePay' },
  { id: 'mercadopago', label: 'Mercado Pago' },
]
export function providerLabel(p: string | null | undefined): string {
  return PAY_PROVIDERS.find(x => x.id === p)?.label.replace(' (colar o link)', '') ?? '—'
}
const isProvider = (v: unknown): v is PayProvider => PAY_PROVIDERS.some(p => p.id === v)

export type PaymentSetup = { pix_provider: PayProvider; card_provider: PayProvider; infinitepay_handle: string | null }

// InfiniteTag: o @ da loja no app, sem "$" nem "@"
export function cleanHandle(v: unknown): string | null {
  const s = String(v ?? '').trim().replace(/^[$@]+/, '').toLowerCase()
  return /^[a-z0-9][a-z0-9._-]{1,59}$/.test(s) ? s : null
}

export function readPaymentSetup(raw: unknown): PaymentSetup {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    pix_provider: isProvider(r.pix_provider) ? r.pix_provider : 'manual',
    card_provider: isProvider(r.card_provider) ? r.card_provider : 'manual',
    infinitepay_handle: cleanHandle(r.infinitepay_handle),
  }
}

export function providerFor(setup: PaymentSetup, choice: 'pix' | 'card'): PayProvider {
  return choice === 'pix' ? setup.pix_provider : setup.card_provider
}

export const toCents = (v: number) => Math.round(v * 100)

// Link gerado para um pedido. A chave do mapa é a referência enviada ao serviço
// (order_nsu na InfinitePay, external_reference no Mercado Pago).
export type PaymentLink = {
  choice: 'pix' | 'card'; provider: PayProvider; url: string
  amount: number    // total a pagar (peças − descontos + frete)
  discount: number  // desconto da condição (ex.: Pix)
  version: string   // proposal_sent_at do resumo que gerou o link
  created_at: string
}

// Reaproveita o link da mesma condição e do mesmo resumo (não cria outro a cada clique)
export function reusableLink(links: Record<string, PaymentLink> | null | undefined, choice: 'pix' | 'card', version: string): { ref: string; link: PaymentLink } | null {
  for (const [ref, link] of Object.entries(links ?? {})) {
    if (link && link.choice === choice && link.version === version && link.provider !== 'manual') return { ref, link }
  }
  return null
}

// Como a cliente pagou, a partir do que o serviço devolve
export function paidMethod(provider: PayProvider, raw: { capture_method?: unknown; payment_method_id?: unknown; payment_type_id?: unknown }): 'pix' | 'card' | 'outro' {
  if (provider === 'infinitepay') {
    const m = String(raw.capture_method ?? '').toLowerCase()
    return m === 'pix' ? 'pix' : m.includes('card') ? 'card' : 'outro'
  }
  const id = String(raw.payment_method_id ?? '').toLowerCase()
  if (id === 'pix') return 'pix'
  const type = String(raw.payment_type_id ?? '').toLowerCase()
  return type === 'credit_card' || type === 'debit_card' ? 'card' : 'outro'
}

const METHOD = { pix: 'Pix', card: 'cartão', outro: 'outra forma' } as const

// Decide se o pagamento aprovado fecha o pedido. Valor menor que o do link não fecha.
// Forma diferente da escolhida (ex.: escolheu Pix com desconto e pagou no cartão) fecha, com aviso.
export function checkPayment(link: Pick<PaymentLink, 'choice' | 'amount'>, paid: { amount: number; method: 'pix' | 'card' | 'outro' }): { ok: boolean; alert: string | null } {
  if (paid.amount + 0.009 < link.amount) {
    return { ok: false, alert: `Pagamento de ${brl(paid.amount)} é menor que o valor do pedido (${brl(link.amount)}). Não foi marcado como pago: confira com a cliente.` }
  }
  if (paid.method !== link.choice && paid.method !== 'outro') {
    return { ok: true, alert: `A cliente escolheu ${link.choice === 'pix' ? 'Pix (com o desconto do Pix)' : 'cartão'} e pagou com ${METHOD[paid.method]}. Confira se o valor está certo.` }
  }
  return { ok: true, alert: null }
}

function brl(v: number): string {
  return `R$ ${v.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`
}
