// ─── Varejo: funil da loja ────────────────────────────────────────────────────
// O funil é o próprio pedido andando pelas situações (sem cadastro duplicado).
// Carrinho → Em atendimento → Proposta enviada → Aguardando pagamento → Pago →
// Enviado/Entregue; Perdido fica fora do fluxo, com o motivo.
// Funções puras (sem imports) para poderem ser testadas com o Node direto.

export type FunnelStage = 'carrinho' | 'atendimento' | 'proposta' | 'pagamento' | 'pago' | 'entrega' | 'perdido'

export const FUNNEL_STAGES: { id: FunnelStage; label: string; hint: string }[] = [
  { id: 'carrinho', label: 'Carrinho', hint: 'Montou a sacola na vitrine e ainda não conversou' },
  { id: 'atendimento', label: 'Em atendimento', hint: 'Conversa no WhatsApp; ainda sem proposta' },
  { id: 'proposta', label: 'Proposta enviada', hint: 'Recebeu a proposta e ainda não aceitou' },
  { id: 'pagamento', label: 'Aguardando pagamento', hint: 'Aceitou ou recebeu a cobrança; falta pagar' },
  { id: 'pago', label: 'Pago', hint: 'Pago: separar e embalar' },
  { id: 'entrega', label: 'Enviado / entregue', hint: 'Pós-venda: pedir foto e avaliação' },
  { id: 'perdido', label: 'Perdido', hint: 'Desistiu ou parou de responder' },
]
export const OPEN_STAGES: FunnelStage[] = ['carrinho', 'atendimento', 'proposta', 'pagamento']

export const LOST_REASONS = [
  { id: 'preco', label: 'Preço' },
  { id: 'frete', label: 'Frete ou entrega' },
  { id: 'tamanho', label: 'Não tinha o tamanho/cor' },
  { id: 'so_olhando', label: 'Só estava olhando' },
  { id: 'sem_resposta', label: 'Parou de responder' },
  { id: 'outro', label: 'Outro motivo' },
] as const
export type LostReason = (typeof LOST_REASONS)[number]['id']
export function isLostReason(v: unknown): v is LostReason {
  return LOST_REASONS.some(r => r.id === v)
}
export function lostReasonLabel(v: string | null | undefined): string {
  return LOST_REASONS.find(r => r.id === v)?.label ?? 'Sem motivo'
}

// Prazos (horas) para o pedido ser considerado "parado" em cada etapa aberta
export type FunnelSettings = { carrinho_h: number; atendimento_h: number; proposta_h: number; pagamento_h: number; lost_suggest_days: number }
export const FUNNEL_DEFAULTS: FunnelSettings = { carrinho_h: 2, atendimento_h: 24, proposta_h: 48, pagamento_h: 24, lost_suggest_days: 7 }
export const FUNNEL_LIMITS = { hours: [1, 720], days: [1, 90] } as const

export function readFunnel(raw: unknown): FunnelSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const pick = (k: keyof FunnelSettings, min: number, max: number) => {
    const v = Number(r[k])
    return Number.isFinite(v) && v >= min && v <= max ? Math.round(v) : FUNNEL_DEFAULTS[k]
  }
  const [hMin, hMax] = FUNNEL_LIMITS.hours
  const [dMin, dMax] = FUNNEL_LIMITS.days
  return {
    carrinho_h: pick('carrinho_h', hMin, hMax), atendimento_h: pick('atendimento_h', hMin, hMax),
    proposta_h: pick('proposta_h', hMin, hMax), pagamento_h: pick('pagamento_h', hMin, hMax),
    lost_suggest_days: pick('lost_suggest_days', dMin, dMax),
  }
}

export type FunnelOrder = {
  status: string
  created_at: string
  stage_at: string | null
  proposal_sent_at: string | null
  proposal_accepted_at: string | null
  last_nudge_at: string | null
}

export function stageOf(o: Pick<FunnelOrder, 'status' | 'proposal_sent_at' | 'proposal_accepted_at'>): FunnelStage {
  switch (o.status) {
    case 'carrinho': return 'carrinho'
    case 'enviado_atendimento': return o.proposal_sent_at && !o.proposal_accepted_at ? 'proposta' : 'atendimento'
    case 'aguardando_pagamento': return 'pagamento'
    case 'pago': return 'pago'
    case 'enviado': case 'entregue': return 'entrega'
    default: return 'perdido'
  }
}

// Desde quando o pedido está na etapa
export function stageSince(o: FunnelOrder): string {
  const st = stageOf(o)
  if (st === 'proposta' && o.proposal_sent_at) return o.proposal_sent_at
  return o.stage_at ?? o.created_at
}

export function limitHours(stage: FunnelStage, s: FunnelSettings): number | null {
  switch (stage) {
    case 'carrinho': return s.carrinho_h
    case 'atendimento': return s.atendimento_h
    case 'proposta': return s.proposta_h
    case 'pagamento': return s.pagamento_h
    default: return null
  }
}

const H = 3_600_000
// Parado = passou do prazo desde que entrou na etapa (ou desde o último lembrete, se for depois)
export function followUp(o: FunnelOrder, s: FunnelSettings, now = new Date()): { stage: FunnelStage; hoursInStage: number; overdue: boolean; suggestLost: boolean } {
  const stage = stageOf(o)
  const since = Date.parse(stageSince(o))
  const hoursInStage = Math.max(0, (now.getTime() - since) / H)
  const limit = limitHours(stage, s)
  if (limit === null) return { stage, hoursInStage, overdue: false, suggestLost: false }
  const nudge = o.last_nudge_at ? Date.parse(o.last_nudge_at) : 0
  const base = Math.max(since, nudge)
  return {
    stage, hoursInStage,
    overdue: now.getTime() - base >= limit * H,
    suggestLost: hoursInStage >= s.lost_suggest_days * 24,
  }
}

// "há 3 h", "há 2 dias"
export function sinceText(hours: number): string {
  if (hours < 1) return 'há menos de 1 h'
  if (hours < 48) return `há ${Math.floor(hours)} h`
  return `há ${Math.floor(hours / 24)} dias`
}

// "o vestido", "o vestido e a saia" → simples: nomes das peças
export function itemsText(names: string[]): string {
  const list = [...new Set(names.map(n => n.trim()).filter(Boolean))]
  if (!list.length) return 'as peças'
  if (list.length === 1) return list[0]
  if (list.length === 2) return `${list[0]} e ${list[1]}`
  if (list.length === 3) return `${list[0]}, ${list[1]} e ${list[2]}`
  return `${list[0]}, ${list[1]} e mais ${list.length - 2} peças`
}

export function firstName(name: string | null | undefined): string {
  const n = (name ?? '').trim().split(/\s+/)[0] ?? ''
  return n ? n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() : ''
}

// Mensagem de recuperação (a equipe confere e envia pelo WhatsApp)
export function nudgeMessage(stage: FunnelStage, d: { store: string; customer: string | null; number: number; items: string[]; proposalUrl?: string | null; validUntil?: string | null; paymentLink?: string | null }): string | null {
  const oi = firstName(d.customer) ? `Oi, ${firstName(d.customer)}!` : 'Oi!'
  const pecas = itemsText(d.items)
  switch (stage) {
    case 'carrinho':
      return `${oi} Aqui é da ${d.store}. Vi que você separou ${pecas} na nossa vitrine. Posso te ajudar a finalizar? Tiro qualquer dúvida de tamanho, cor ou entrega.`
    case 'atendimento':
      return `${oi} Aqui é da ${d.store}. Passando para saber se ficou alguma dúvida sobre ${pecas}. Se quiser, já te mando o valor certinho com as formas de pagamento.`
    case 'proposta': {
      const venc = d.validUntil ? ` até ${d.validUntil.split('-').reverse().join('/')}` : ''
      const link = d.proposalUrl ? ` O link é este: ${d.proposalUrl}` : ''
      return `${oi} Aqui é da ${d.store}. Sua proposta do pedido nº ${d.number} continua disponível${venc}. Quer que eu ajuste alguma coisa?${link}`
    }
    case 'pagamento': {
      const link = d.paymentLink ? ` O link para pagar é este: ${d.paymentLink}` : ''
      return `${oi} Aqui é da ${d.store}. Seu pedido nº ${d.number} está separado, esperando o pagamento.${link} Qualquer dúvida, é só me chamar!`
    }
    default:
      return null
  }
}

// Para onde o pedido pode ir a partir da etapa (Proposta só nasce gerando a proposta no pedido)
export function nextMoves(stage: FunnelStage): { status: string; label: string }[] {
  switch (stage) {
    case 'carrinho': return [{ status: 'enviado_atendimento', label: 'Em atendimento' }, { status: 'aguardando_pagamento', label: 'Aguardando pagamento' }, { status: 'pago', label: 'Pago' }]
    case 'atendimento': case 'proposta': return [{ status: 'aguardando_pagamento', label: 'Aguardando pagamento' }, { status: 'pago', label: 'Pago' }]
    case 'pagamento': return [{ status: 'pago', label: 'Pago' }]
    case 'pago': return [{ status: 'enviado', label: 'Enviado' }, { status: 'entregue', label: 'Entregue' }]
    case 'entrega': return [{ status: 'entregue', label: 'Entregue' }]
    default: return []
  }
}
