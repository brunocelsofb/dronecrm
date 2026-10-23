// ─── Varejo: clientes (pessoa física) e pedidos — regras compartilhadas ───────
// Situação da cliente pelas compras pagas (pago, enviado, entregue) e pelo
// histórico importado: sem compra · ativa · inativa (sem comprar há mais de N dias).

export const DEFAULT_INACTIVE_DAYS = 90

export type RetailSettings = { inactive_days: number }

export function readRetailSettings(raw: unknown): RetailSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const d = Number(r.inactive_days)
  return { inactive_days: Number.isInteger(d) && d >= 7 && d <= 730 ? d : DEFAULT_INACTIVE_DAYS }
}

export const CUSTOMER_STATUS = {
  ativa: { label: 'Ativa', style: 'bg-positive-100 text-positive-700' },
  inativa: { label: 'Inativa', style: 'bg-warn-100 text-warn-700' },
  sem_compra: { label: 'Sem compra', style: 'bg-gray-100 text-gray-600' },
} as const
export type CustomerStatus = keyof typeof CUSTOMER_STATUS

export const ORDER_STATUSES = [
  { id: 'carrinho', label: 'Novo pedido', style: 'bg-gray-100 text-gray-700' },
  { id: 'enviado_atendimento', label: 'Enviado para atendimento', style: 'bg-brand-100 text-brand-800' },
  { id: 'aguardando_pagamento', label: 'Aguardando pagamento', style: 'bg-warn-100 text-warn-700' },
  { id: 'pago', label: 'Pago', style: 'bg-positive-100 text-positive-700' },
  { id: 'enviado', label: 'Enviado', style: 'bg-positive-100 text-positive-700' },
  { id: 'entregue', label: 'Entregue', style: 'bg-positive-100 text-positive-700' },
  { id: 'cancelado', label: 'Cancelado', style: 'bg-gray-100 text-gray-500' },
] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]['id']
export const PAID_STATUSES: OrderStatus[] = ['pago', 'enviado', 'entregue']

export function isOrderStatus(v: unknown): v is OrderStatus {
  return ORDER_STATUSES.some(s => s.id === v)
}
export function orderStatusLabel(v: string): string {
  return ORDER_STATUSES.find(s => s.id === v)?.label ?? v
}

export const PAYMENT_METHODS = [
  { id: 'pix', label: 'Pix' },
  { id: 'cartao', label: 'Cartão' },
  { id: 'dinheiro', label: 'Dinheiro' },
  { id: 'outro', label: 'Outro' },
] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]['id']
export function isPaymentMethod(v: unknown): v is PaymentMethod {
  return PAYMENT_METHODS.some(p => p.id === v)
}

// Telefone brasileiro só com dígitos, sem o 55 e com o 9 do celular (DDD + número)
export function canonicalPhone(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  let d = String(raw).replace(/\D/g, '')
  if (!d) return null
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2)
  if (d.length === 10 && /^[6-9]/.test(d.slice(2))) d = `${d.slice(0, 2)}9${d.slice(2)}`
  return d.length >= 10 && d.length <= 11 ? d : null
}

export function formatPhone(d: string | null | undefined): string {
  if (!d) return '—'
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return d
}

// Link para abrir conversa no WhatsApp com mensagem pronta
export function whatsappLink(phone: string | null | undefined, text: string): string | null {
  const p = canonicalPhone(phone)
  return p ? `https://wa.me/55${p}?text=${encodeURIComponent(text)}` : null
}

export function onlyDigits(v: unknown, max = 14): string | null {
  const d = String(v ?? '').replace(/\D/g, '')
  return d ? d.slice(0, max) : null
}

// Data em vários formatos de planilha (dd/mm/aaaa, aaaa-mm-dd) → aaaa-mm-dd
export function parseDate(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  const s = String(v).trim()
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/)
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3]
    return validIso(`${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`)
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? validIso(m[0]) : null
}

// Confere que a data existe (31/02 não vira 03/03)
function validIso(iso: string): string | null {
  const [y, mo, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? iso : null
}

export type CustomerStats = { orders: number; total: number; first: string | null; last: string | null }

// Junta compras do CRM com o histórico importado
export function mergeStats(
  fromOrders: CustomerStats | undefined,
  legacy: { legacy_last_purchase_at: string | null; legacy_total: number | null; legacy_orders: number | null },
): CustomerStats {
  const o = fromOrders ?? { orders: 0, total: 0, first: null, last: null }
  const dates = [o.last, legacy.legacy_last_purchase_at].filter(Boolean) as string[]
  const last = dates.length ? dates.sort().at(-1)! : null
  return {
    orders: o.orders + (legacy.legacy_orders ?? (legacy.legacy_last_purchase_at ? 1 : 0)),
    total: o.total + Number(legacy.legacy_total ?? 0),
    first: o.first ?? legacy.legacy_last_purchase_at ?? null,
    last,
  }
}

export function customerStatus(last: string | null, inactiveDays: number, now = new Date()): CustomerStatus {
  if (!last) return 'sem_compra'
  const days = (now.getTime() - new Date(last).getTime()) / 86_400_000
  return days > inactiveDays ? 'inativa' : 'ativa'
}

export function daysSince(iso: string | null, now = new Date()): number | null {
  return iso ? Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000) : null
}

export type OrderMessageInput = {
  number: number
  customerName: string | null
  items: { name: string; color: string | null; size: string | null; qty: number; total: number }[]
  subtotal: number; discount: number; shipping: number; total: number; loyaltyDiscount?: number
  paymentMethod: string | null; paymentCondition: string | null; paymentLink: string | null
}

// Mensagem do pedido para o WhatsApp (valores sempre os gravados no CRM)
export function orderMessage(o: OrderMessageInput, fmt: (n: number) => string): string {
  const lines = [`Olá${o.customerName ? `, ${o.customerName.split(' ')[0]}` : ''}! Seu pedido nº ${o.number}:`]
  o.items.forEach((it, i) => lines.push(`${i + 1}. ${it.name}${it.color ? ` | ${it.color}` : ''}${it.size ? ` | ${it.size}` : ''} | ${it.qty} un. | ${fmt(it.total)}`))
  lines.push(`Subtotal: ${fmt(o.subtotal)}`)
  if (o.discount > 0) lines.push(`Desconto: ${fmt(o.discount)}`)
  if ((o.loyaltyDiscount ?? 0) > 0) lines.push(`Fidelidade: ${fmt(o.loyaltyDiscount ?? 0)}`)
  if (o.shipping > 0) lines.push(`Frete: ${fmt(o.shipping)}`)
  lines.push(`Total: ${fmt(o.total)}`)
  const pm = PAYMENT_METHODS.find(p => p.id === o.paymentMethod)?.label
  if (pm || o.paymentCondition) lines.push(`Pagamento: ${[pm, o.paymentCondition].filter(Boolean).join(' · ')}`)
  if (o.paymentLink) lines.push(`Link para pagamento: ${o.paymentLink}`)
  return lines.join('\n')
}

// ─── Aniversário ──────────────────────────────────────────────────────────────
// Data de hoje no fuso de Brasília (o servidor roda em UTC)
export function todayInBrazil(now = new Date()): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now).split('-').map(Number)
  return { y: parts[0], m: parts[1], d: parts[2] }
}

export type BirthdayInfo = { day: number; month: number; daysUntil: number; turning: number | null }

// Dias até o próximo aniversário (0 = hoje). 29/02 conta como 28/02 em ano não bissexto.
export function birthdayInfo(birth: string | null | undefined, now = new Date()): BirthdayInfo | null {
  const m = birth?.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const by = Number(m[1]), bm = Number(m[2]), bd = Number(m[3])
  const t = todayInBrazil(now)
  const today = Date.UTC(t.y, t.m - 1, t.d)
  const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
  const next = (y: number) => Date.UTC(y, bm - 1, bm === 2 && bd === 29 && !isLeap(y) ? 28 : bd)
  let year = t.y
  if (next(year) < today) year++
  const daysUntil = Math.round((next(year) - today) / 86_400_000)
  return { day: bd, month: bm, daysUntil, turning: by > 1900 ? year - by : null }
}

export function birthdayLabel(b: BirthdayInfo | null): string | null {
  if (!b) return null
  if (b.daysUntil === 0) return 'Aniversário hoje'
  if (b.daysUntil === 1) return 'Aniversário amanhã'
  return b.daysUntil <= 30 ? `Aniversário em ${b.daysUntil} dias` : null
}

export function birthdayMessage(name: string, storeName: string): string {
  return `Olá, ${name.split(' ')[0]}! Hoje é um dia especial e a ${storeName} não podia deixar passar: feliz aniversário! Que seu novo ano seja cheio de alegria e momentos lindos.`
}
