// ─── Varejo: funil da loja ────────────────────────────────────────────────────
// O funil é o próprio pedido andando pelas situações (sem cadastro duplicado).
// Carrinho → Em atendimento → Aguardando pagamento (link "Finalizar compra" enviado) →
// Pago → Enviado/Entregue; Perdido fica fora do fluxo, com o motivo.
// Funções puras (sem imports) para poderem ser testadas com o Node direto.

export type FunnelStage = 'carrinho' | 'atendimento' | 'pagamento' | 'pago' | 'entrega' | 'perdido'

export const FUNNEL_STAGES: { id: FunnelStage; label: string; hint: string }[] = [
  { id: 'carrinho', label: 'Novo pedido', hint: 'Montou a sacola na vitrine e ainda não conversou' },
  { id: 'atendimento', label: 'Em atendimento', hint: 'Confirmando tamanho, cor e frete' },
  { id: 'pagamento', label: 'Aguardando pagamento', hint: 'Recebeu o link "Finalizar compra"; falta pagar' },
  { id: 'pago', label: 'Pago', hint: 'Pago: separar e embalar' },
  { id: 'entrega', label: 'Enviado / entregue', hint: 'Pós-venda: pedir foto e avaliação' },
  { id: 'perdido', label: 'Perdido', hint: 'Desistiu ou parou de responder' },
]
export const OPEN_STAGES: FunnelStage[] = ['carrinho', 'atendimento', 'pagamento']

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
export type FunnelSettings = { carrinho_h: number; atendimento_h: number; pagamento_h: number; lost_suggest_days: number }
export const FUNNEL_DEFAULTS: FunnelSettings = { carrinho_h: 2, atendimento_h: 24, pagamento_h: 24, lost_suggest_days: 7 }
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
    pagamento_h: pick('pagamento_h', hMin, hMax),
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
  custom_stage?: string | null     // etapa própria da loja (dentro da etapa fixa)
  custom_stage_at?: string | null
}

export function stageOf(o: Pick<FunnelOrder, 'status' | 'proposal_sent_at' | 'proposal_accepted_at'>): FunnelStage {
  switch (o.status) {
    case 'carrinho': return 'carrinho'
    case 'enviado_atendimento': return 'atendimento'
    case 'aguardando_pagamento': return 'pagamento'
    case 'pago': return 'pago'
    case 'enviado': case 'entregue': return 'entrega'
    default: return 'perdido'
  }
}

// Desde quando o pedido está na etapa (no pagamento, conta do último link enviado)
export function stageSince(o: FunnelOrder): string {
  const since = o.stage_at ?? o.created_at
  if (stageOf(o) === 'pagamento' && o.proposal_sent_at && o.proposal_sent_at > since) return o.proposal_sent_at
  return since
}

export function limitHours(stage: FunnelStage, s: FunnelSettings): number | null {
  switch (stage) {
    case 'carrinho': return s.carrinho_h
    case 'atendimento': return s.atendimento_h
    case 'pagamento': return s.pagamento_h
    default: return null
  }
}

const H = 3_600_000
// Parado = passou do prazo desde que entrou na etapa (ou desde o último lembrete, se for depois)
export function followUp(o: FunnelOrder, s: FunnelSettings, now = new Date(), layout?: FunnelLayout): { stage: FunnelStage; hoursInStage: number; hoursInColumn: number; overdue: boolean; suggestLost: boolean } {
  const stage = stageOf(o)
  const custom = layout ? customOf(o, layout) : null
  // Etapa própria: conta desde que entrou nela; prazo próprio ou o da etapa fixa
  const since = Date.parse(custom && o.custom_stage_at ? o.custom_stage_at : stageSince(o))
  const hoursInStage = Math.max(0, (now.getTime() - Date.parse(stageSince(o))) / H)
  const hoursInColumn = Math.max(0, (now.getTime() - since) / H)
  const baseLimit = limitHours(stage, s)
  const limit = baseLimit === null ? null : custom?.hours ?? baseLimit
  if (limit === null) return { stage, hoursInStage, hoursInColumn, overdue: false, suggestLost: false }
  const nudge = o.last_nudge_at ? Date.parse(o.last_nudge_at) : 0
  const base = Math.max(since, nudge)
  return {
    stage, hoursInStage, hoursInColumn,
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
    case 'pagamento': {
      const venc = d.validUntil ? ` até ${d.validUntil.split('-').reverse().join('/')}` : ''
      const link = d.proposalUrl ? ` Para finalizar, é só abrir, escolher Pix ou cartão e pagar: ${d.proposalUrl}` : d.paymentLink ? ` O link para pagar é este: ${d.paymentLink}` : ''
      return `${oi} Aqui é da ${d.store}. Suas peças do pedido nº ${d.number} estão separadas${venc}.${link}`
    }
    default:
      return null
  }
}

// Para onde o pedido pode ir a partir da etapa (Aguardando pagamento também nasce ao gerar o link no pedido)
export function nextMoves(stage: FunnelStage): { status: string; label: string }[] {
  switch (stage) {
    case 'carrinho': return [{ status: 'enviado_atendimento', label: 'Em atendimento' }, { status: 'aguardando_pagamento', label: 'Aguardando pagamento' }, { status: 'pago', label: 'Pago' }]
    case 'atendimento': return [{ status: 'aguardando_pagamento', label: 'Aguardando pagamento' }, { status: 'pago', label: 'Pago' }]
    case 'pagamento': return [{ status: 'pago', label: 'Pago' }]
    case 'pago': return [{ status: 'enviado', label: 'Enviado' }, { status: 'entregue', label: 'Entregue' }]
    case 'entrega': return [{ status: 'entregue', label: 'Entregue' }]
    default: return []
  }
}

// ─── Etapas editáveis ─────────────────────────────────────────────────────────
// As etapas fixas têm automações (estoque, fidelidade, link, pagamento) e não saem
// do lugar: a loja pode renomear e esconder as opcionais. Etapas próprias ficam
// "dentro" de uma etapa fixa (mesma situação do pedido) e não têm automação. Quando
// uma automação muda a situação, o pedido sai da etapa própria sozinho.

export const STAGE_LOCKS: Record<FunnelStage, string> = {
  carrinho: 'Entra sozinho quando a cliente faz o pedido pela vitrine.',
  atendimento: 'Pedidos lançados pela equipe começam aqui.',
  pagamento: 'Entra sozinho ao gerar o link "Finalizar compra". Sai sozinho quando o pagamento é aprovado (InfinitePay ou Mercado Pago).',
  pago: 'Ao entrar, baixa o estoque e gera a fidelidade (uma vez só).',
  entrega: 'O estoque já foi baixado. Só acompanha a entrega.',
  perdido: 'Ao marcar, cancela o pedido, devolve o estoque e desfaz a fidelidade.',
}
export const OPTIONAL_STAGES: FunnelStage[] = ['carrinho', 'entrega']
export const CUSTOM_BASES: FunnelStage[] = ['carrinho', 'atendimento', 'pagamento', 'pago', 'entrega']
export const MAX_CUSTOM_STAGES = 8

export type CustomStage = { id: string; name: string; base: FunnelStage; hours: number | null }
export type FunnelLayout = { labels: Partial<Record<FunnelStage, string>>; hidden: FunnelStage[]; custom: CustomStage[] }
export const EMPTY_LAYOUT: FunnelLayout = { labels: {}, hidden: [], custom: [] }

const cleanName = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)
const isStage = (v: unknown): v is FunnelStage => FUNNEL_STAGES.some(st => st.id === v)

export function readFunnelLayout(raw: unknown): FunnelLayout {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const labels: Partial<Record<FunnelStage, string>> = {}
  const rl = (r.labels && typeof r.labels === 'object' ? r.labels : {}) as Record<string, unknown>
  for (const st of FUNNEL_STAGES) { const n = cleanName(rl[st.id]); if (n && n !== st.label) labels[st.id] = n }
  const hidden = (Array.isArray(r.hidden) ? r.hidden : []).filter((h): h is FunnelStage => isStage(h) && OPTIONAL_STAGES.includes(h))
  const seen = new Set<string>()
  const custom: CustomStage[] = []
  for (const c of Array.isArray(r.custom) ? r.custom : []) {
    const x = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>
    const id = String(x.id ?? '')
    const name = cleanName(x.name)
    if (!/^c_[a-z0-9]{4,12}$/.test(id) || seen.has(id) || !name || !isStage(x.base) || !CUSTOM_BASES.includes(x.base)) continue
    const h = Number(x.hours)
    const hours = x.hours === null || x.hours === undefined || x.hours === '' || !Number.isFinite(h) || h < 1 || h > 720 ? null : Math.round(h)
    seen.add(id); custom.push({ id, name, base: x.base, hours })
    if (custom.length >= MAX_CUSTOM_STAGES) break
  }
  return { labels, hidden: [...new Set(hidden)], custom }
}

export function stageLabel(stage: FunnelStage, layout: FunnelLayout): string {
  return layout.labels[stage] ?? FUNNEL_STAGES.find(s => s.id === stage)?.label ?? stage
}

// Etapa própria válida para o pedido (só vale enquanto ele estiver na etapa fixa dela)
export function customOf(o: Pick<FunnelOrder, 'status' | 'proposal_sent_at' | 'proposal_accepted_at' | 'custom_stage'>, layout: FunnelLayout): CustomStage | null {
  if (!o.custom_stage) return null
  const c = layout.custom.find(x => x.id === o.custom_stage)
  return c && c.base === stageOf(o) ? c : null
}

export type FunnelColumn = { key: string; base: FunnelStage; label: string; fixed: boolean; lock: string | null; hint: string; custom: CustomStage | null; optional: boolean; hidden: boolean }

// Ordem: cada etapa fixa seguida das etapas próprias dela; Perdido no fim
export function funnelColumns(layout: FunnelLayout): FunnelColumn[] {
  const out: FunnelColumn[] = []
  for (const st of FUNNEL_STAGES) {
    out.push({ key: st.id, base: st.id, label: stageLabel(st.id, layout), fixed: true, lock: STAGE_LOCKS[st.id], hint: st.hint, custom: null, optional: OPTIONAL_STAGES.includes(st.id), hidden: layout.hidden.includes(st.id) })
    for (const c of layout.custom.filter(x => x.base === st.id)) {
      out.push({ key: c.id, base: st.id, label: c.name, fixed: false, lock: null, hint: `Etapa da loja dentro de "${stageLabel(st.id, layout)}"`, custom: c, optional: true, hidden: false })
    }
  }
  return out
}

export function columnOf(o: Pick<FunnelOrder, 'status' | 'proposal_sent_at' | 'proposal_accepted_at' | 'custom_stage'>, layout: FunnelLayout): string {
  return customOf(o, layout)?.id ?? stageOf(o)
}
