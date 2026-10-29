// ─── Varejo: campanhas da loja (regras puras, sem imports) ───────────────────
// Campanha = público (quem recebe a mensagem) + mensagem + link próprio da vitrine.
// Só entra quem autorizou receber WhatsApp. O resultado vem dos pedidos pagos marcados
// com a campanha (pelo link, ou cliente que recebeu a mensagem nos 7 dias antes do pedido).

export type Audience = 'aniversariantes' | 'inativas' | 'categoria' | 'melhores' | 'todas' | 'nenhum'
export const AUDIENCES: { id: Audience; label: string; help: string }[] = [
  { id: 'aniversariantes', label: 'Aniversariantes do mês', help: 'Quem faz aniversário no mês escolhido.' },
  { id: 'inativas', label: 'Clientes para reativar', help: 'Quem não compra há mais de X dias.' },
  { id: 'categoria', label: 'Quem comprou uma categoria', help: 'Ex.: quem já comprou Calças (para lançar calças novas).' },
  { id: 'melhores', label: 'Melhores clientes', help: 'As que mais compraram (em R$).' },
  { id: 'todas', label: 'Todas as clientes', help: 'Toda a base que autorizou WhatsApp.' },
  { id: 'nenhum', label: 'Só o link (divulgar)', help: 'Sem mensagem para a base: use o link no Instagram, anúncio ou QR Code.' },
]
export const isAudience = (v: unknown): v is Audience => AUDIENCES.some(a => a.id === v)
export const ATTRIBUTION_DAYS = 7

export type AudienceParams = { month?: number; days?: number; category?: string; top?: number }
export function readParams(raw: unknown): AudienceParams {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const int = (v: unknown, min: number, max: number) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= min && n <= max ? n : undefined }
  return { month: int(o.month, 1, 12), days: int(o.days, 7, 3650), category: typeof o.category === 'string' ? o.category.slice(0, 80) : undefined, top: int(o.top, 1, 500) }
}

// Código do link: minúsculo, sem acento, com hífen (ex.: "dia-das-maes")
export function campaignCode(name: string): string {
  return String(name ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'campanha'
}
export const isCampaignCode = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(v)

export type CampaignCustomer = {
  id: string; name: string; phone: string | null; optin: boolean; birth_date: string | null
  last_purchase: string | null; total: number; categories: string[]
}

// Quem recebe: autorizou WhatsApp, tem telefone e se encaixa no público
export function selectAudience(list: CampaignCustomer[], audience: Audience, p: AudienceParams, today: Date): CampaignCustomer[] {
  if (audience === 'nenhum') return []
  const base = list.filter(c => c.optin && c.phone)
  if (audience === 'todas') return base
  if (audience === 'aniversariantes') {
    const m = p.month ?? today.getMonth() + 1
    return base.filter(c => c.birth_date && Number(c.birth_date.slice(5, 7)) === m)
      .sort((a, b) => (a.birth_date ?? '').slice(8, 10).localeCompare((b.birth_date ?? '').slice(8, 10)))
  }
  if (audience === 'inativas') {
    const days = p.days ?? 90
    const limit = today.getTime() - days * 86_400_000
    return base.filter(c => c.last_purchase && Date.parse(c.last_purchase) < limit)
  }
  if (audience === 'categoria') {
    const cat = (p.category ?? '').toLowerCase()
    return cat ? base.filter(c => c.categories.some(x => x.toLowerCase() === cat)) : []
  }
  if (audience === 'melhores') return [...base].filter(c => c.total > 0).sort((a, b) => b.total - a.total).slice(0, p.top ?? 20)
  return []
}

export const DEFAULT_MESSAGES: Record<Audience, string> = {
  aniversariantes: 'Oi, {nome}! Feliz aniversário! 🎉 A {loja} separou um carinho para o seu mês. Veja as novidades: {link}',
  inativas: 'Oi, {nome}! Que saudade! Chegaram peças novas na {loja} que combinam com você. Dá uma olhada: {link}',
  categoria: 'Oi, {nome}! Chegaram novidades na {loja} do jeito que você gosta. Veja aqui: {link}',
  melhores: 'Oi, {nome}! Você é uma cliente especial da {loja}, então mostramos primeiro para você: {link}',
  todas: 'Oi, {nome}! Novidades na {loja}: {link}',
  nenhum: '',
}

const firstName = (n: string) => String(n ?? '').trim().split(/\s+/)[0] ?? ''
export function renderCampaignMessage(tpl: string, v: { nome: string; loja: string; link: string }): string {
  return String(tpl ?? '').replace(/\{nome\}/g, firstName(v.nome)).replace(/\{loja\}/g, v.loja).replace(/\{link\}/g, v.link).trim()
}
export function campaignLink(base: string | null, slug: string | null, code: string): string | null {
  if (!base || !slug) return null
  return `${base.replace(/\/+$/, '')}/?loja=${encodeURIComponent(slug)}&c=${encodeURIComponent(code)}`
}

// Resultado com a conta aberta (memória de cálculo)
export type CampaignOrder = { total: number; shipping: number; cost: number | null; paid: boolean }
export function campaignResult(orders: CampaignOrder[], investment: number) {
  const paid = orders.filter(o => o.paid)
  const sold = round2(paid.reduce((t, o) => t + (o.total - (o.shipping || 0)), 0))
  const costKnown = paid.every(o => o.cost !== null)
  const cost = round2(paid.reduce((t, o) => t + (o.cost ?? 0), 0))
  return {
    orders: orders.length, paid: paid.length, sold,
    grossMargin: costKnown ? round2(sold - cost) : null, // vendido − custo das peças (sem impostos e taxas)
    roas: investment > 0 ? round2(sold / investment) : null,
    costPerSale: investment > 0 && paid.length ? round2(investment / paid.length) : null,
  }
}
const round2 = (n: number) => Math.round(n * 100) / 100
