// ─── Varejo: mensagens do pedido por etapa ────────────────────────────────────
// Em cada etapa o Drone monta o rascunho (WhatsApp + e-mail) pelo modelo da loja;
// alguém da loja revisa e envia. Nada sai sozinho. Funções puras (testáveis).

export type MessageStage = 'recebido' | 'link' | 'pago' | 'separado' | 'enviado' | 'entregue'

export const MESSAGE_STAGES: { id: MessageStage; label: string; when: string; timeline: string }[] = [
  { id: 'recebido', label: 'Pedido recebido', when: 'Quando o pedido é criado (vitrine ou equipe)', timeline: 'Pedido recebido' },
  { id: 'link', label: 'Link de pagamento', when: 'Quando a equipe gera o link "Finalizar compra"', timeline: 'Aguardando pagamento' },
  { id: 'pago', label: 'Pagamento confirmado', when: 'Quando o pedido fica Pago (conferido no provedor ou marcado pela equipe)', timeline: 'Pagamento confirmado' },
  { id: 'separado', label: 'Pedido separado', when: 'Quando a equipe marca "Separado"', timeline: 'Pedido separado' },
  { id: 'enviado', label: 'Pedido enviado', when: 'Quando o pedido fica Enviado (com o rastreio, se houver)', timeline: 'Pedido enviado' },
  { id: 'entregue', label: 'Pedido entregue', when: 'Quando o pedido fica Entregue', timeline: 'Pedido entregue' },
]
export const isMessageStage = (v: unknown): v is MessageStage => MESSAGE_STAGES.some(s => s.id === v)

export type MessageTemplate = { wa: string; subject: string; email: string }
export type MessageTemplates = Record<MessageStage, MessageTemplate>

export const MESSAGE_VARS: { key: string; label: string }[] = [
  { key: 'nome', label: 'primeiro nome da cliente' },
  { key: 'numero', label: 'número do pedido' },
  { key: 'loja', label: 'nome da loja' },
  { key: 'conta', label: 'peças, descontos, frete e total, linha por linha' },
  { key: 'total', label: 'total do pedido' },
  { key: 'link_pagamento', label: 'link "Finalizar compra" (Pix ou cartão)' },
  { key: 'rastreio', label: 'transportadora, código e link de rastreio' },
  { key: 'link_pedido', label: 'página para a cliente acompanhar o pedido' },
]

export const DEFAULT_TEMPLATES: MessageTemplates = {
  recebido: {
    wa: 'Oi, {{nome}}! Recebemos seu pedido nº {{numero}} na {{loja}} ✓\n\n{{conta}}\n\nAcompanhe por aqui: {{link_pedido}}\nJá te mando a forma de pagamento.',
    subject: 'Recebemos seu pedido nº {{numero}}',
    email: 'Olá, {{nome}}.\n\nRecebemos seu pedido. Esta é a conta, linha por linha:\n\n{{conta}}\n\nAcompanhe cada etapa em: {{link_pedido}}\n\n{{loja}}',
  },
  link: {
    wa: '{{nome}}, segue o link para pagar o pedido nº {{numero}} ({{total}}):\n{{link_pagamento}}\n\nVocê escolhe Pix ou cartão. Qualquer dúvida, é só responder aqui.',
    subject: 'Link de pagamento do pedido nº {{numero}}',
    email: 'Olá, {{nome}}.\n\nPara pagar seu pedido nº {{numero}}, use o link abaixo e escolha Pix ou cartão:\n{{link_pagamento}}\n\n{{conta}}\n\nAcompanhe: {{link_pedido}}\n\n{{loja}}',
  },
  pago: {
    wa: 'Pagamento confirmado ✓\nPedido nº {{numero}} · {{total}}\n\nAgora vamos separar suas peças. Te aviso a cada etapa.\n{{link_pedido}}',
    subject: 'Pagamento confirmado · pedido nº {{numero}}',
    email: 'Olá, {{nome}}.\n\nConfirmamos o pagamento do seu pedido nº {{numero}}.\n\n{{conta}}\n\nPróximo passo: separação das peças.\nAcompanhe: {{link_pedido}}\n\n{{loja}}',
  },
  separado: {
    wa: 'Suas peças estão separadas e embaladas ✓\nPedido nº {{numero}}. Te aviso quando sair.\n{{link_pedido}}',
    subject: 'Pedido nº {{numero}} separado',
    email: 'Olá, {{nome}}.\n\nSuas peças estão separadas e embaladas. Avisamos assim que o pedido sair.\n\nAcompanhe: {{link_pedido}}\n\n{{loja}}',
  },
  enviado: {
    wa: 'Seu pedido nº {{numero}} saiu ✓\n{{rastreio}}\n\nAcompanhe: {{link_pedido}}',
    subject: 'Pedido nº {{numero}} enviado',
    email: 'Olá, {{nome}}.\n\nSeu pedido nº {{numero}} foi enviado.\n{{rastreio}}\n\nAcompanhe: {{link_pedido}}\n\n{{loja}}',
  },
  entregue: {
    wa: 'Pedido entregue ✓ Esperamos que você goste, {{nome}}!\nSe precisar de algo, é só responder aqui.\n{{link_pedido}}',
    subject: 'Pedido nº {{numero}} entregue',
    email: 'Olá, {{nome}}.\n\nSeu pedido nº {{numero}} foi entregue. Esperamos que goste!\nSe precisar trocar, responda este e-mail ou chame no WhatsApp.\n\n{{link_pedido}}\n\n{{loja}}',
  },
}

const LIMITS = { wa: 2000, subject: 160, email: 4000 }
export function readTemplates(raw: unknown): MessageTemplates {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out = {} as MessageTemplates
  for (const s of MESSAGE_STAGES) {
    const t = (r[s.id] && typeof r[s.id] === 'object' ? r[s.id] : {}) as Record<string, unknown>
    const d = DEFAULT_TEMPLATES[s.id]
    const pick = (k: keyof MessageTemplate) => { const v = String(t[k] ?? '').replace(/\r\n/g, '\n').trim().slice(0, LIMITS[k]); return v || d[k] }
    out[s.id] = { wa: pick('wa'), subject: pick('subject'), email: pick('email') }
  }
  return out
}

export type MessageVars = Partial<Record<'nome' | 'numero' | 'loja' | 'conta' | 'total' | 'link_pagamento' | 'rastreio' | 'link_pedido', string>>

// Troca {{variável}}; variável vazia some e as linhas em branco repetidas são enxugadas
export function renderTemplate(tpl: string, vars: MessageVars): string {
  return tpl
    .replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, k: string) => (vars as Record<string, string | undefined>)[k] ?? '')
    .split('\n').map(l => l.replace(/[ \t]+$/, '')).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim()
}

export type ContaInput = {
  items: { name: string; color: string | null; size: string | null; qty: number; unit_price: number; total: number }[]
  subtotal: number; discount: number; loyaltyDiscount: number; shipping: number; total: number
  paymentLabel?: string | null
}
// Memória de cálculo: cada linha diz de onde veio o valor
export function buildConta(c: ContaInput, money: (n: number) => string): string {
  const lines = c.items.map(i => {
    const v = [i.color, i.size].filter(Boolean).join(' / ')
    return `${i.name}${v ? ` · ${v}` : ''} · ${i.qty} × ${money(i.unit_price)} = ${money(i.total)}`
  })
  const hasAdjust = c.discount > 0 || c.loyaltyDiscount > 0 || c.shipping > 0
  if (hasAdjust) lines.push(`Subtotal: ${money(c.subtotal)}`)
  if (c.discount > 0) lines.push(`Desconto: − ${money(c.discount)}`)
  if (c.loyaltyDiscount > 0) lines.push(`Fidelidade: − ${money(c.loyaltyDiscount)}`)
  if (c.shipping > 0) lines.push(`Frete: ${money(c.shipping)}`)
  lines.push(`Total: ${money(c.total)}`)
  if (c.paymentLabel) lines.push(`Pagamento: ${c.paymentLabel}`)
  return lines.join('\n')
}

export function trackingText(t: { carrier: string | null; code: string | null; url: string | null }): string {
  const head = [t.carrier, t.code].filter(Boolean).join(': ')
  return [head, t.url].filter(Boolean).join('\n')
}

// Link de rastreio: só o que a loja informar (https)
export function cleanTrackingUrl(url: unknown): string | null {
  const s = String(url ?? '').trim().slice(0, 500)
  try { const u = new URL(s); return u.protocol === 'https:' ? u.toString() : null } catch { return null }
}

export function firstName(name: string | null | undefined): string {
  return String(name ?? '').trim().split(/\s+/)[0] || ''
}

// Linha do tempo pública (página da cliente)
export const PUBLIC_EVENT_LABELS: Record<string, string> = {
  recebido: 'Pedido recebido', link: 'Aguardando pagamento', pago: 'Pagamento confirmado', separado: 'Pedido separado',
  enviado: 'Pedido enviado', entregue: 'Pedido entregue', cancelado: 'Pedido cancelado',
}
export const STEP_ORDER = ['recebido', 'link', 'pago', 'separado', 'enviado', 'entregue'] as const
