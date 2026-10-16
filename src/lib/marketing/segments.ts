// ─── Listas de marketing (segmentos) ─────────────────────────────────────────
// Quem entra numa lista: leads e/ou contatos dos clientes (empresas com
// contrato em gestão), conforme os filtros. Sempre fora: e-mail inválido e
// quem se descadastrou (LGPD). Cálculo puro (sem banco) para poder testar.

import { inferChannel } from './tracking'

export type ListAudience = 'leads' | 'clientes' | 'ambos'
export type ListFilters = {
  lead_status?: string[]          // novo, em_qualificacao, qualificado, convertido, descartado
  campaign_ids?: string[]
  channels?: string[]
  min_score?: number | null
  created_from?: string | null    // AAAA-MM-DD
  segments?: string[]             // segmento do contrato (clientes)
  ufs?: string[]                  // UF do contrato (clientes)
  tag_ids?: string[]              // etiquetas da empresa (clientes)
  only_primary?: boolean          // só o contato principal (clientes)
}

export type SegLead = { id: string; name: string; email: string | null; phone: string | null; company_name: string | null; status: string | null; score: number | null; campaign_id: string | null; created_at: string; source: string | null; utm_source: string | null; utm_medium: string | null; gclid: string | null; fbclid: string | null }
export type SegContact = { id: string; name: string | null; email: string | null; phone: string | null; company_id: string | null; is_primary: boolean | null }
export type SegClient = { company_id: string; company_name: string; segments: string[]; ufs: string[]; tag_ids: string[] }

export type Member = { email: string; name: string; phone: string | null; company: string | null; kind: 'lead' | 'cliente' }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function readFilters(raw: unknown): ListFilters {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x) : [])
  const n = Number(o.min_score)
  return {
    lead_status: arr(o.lead_status), campaign_ids: arr(o.campaign_ids), channels: arr(o.channels),
    min_score: o.min_score === null || o.min_score === undefined || o.min_score === '' || !Number.isFinite(n) ? null : n,
    created_from: typeof o.created_from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.created_from) ? o.created_from : null,
    segments: arr(o.segments), ufs: arr(o.ufs), tag_ids: arr(o.tag_ids), only_primary: o.only_primary === true,
  }
}

export function buildMembers(input: {
  audience: ListAudience
  filters: ListFilters
  leads: SegLead[]
  contacts: SegContact[]
  clients: SegClient[]
  optouts: Set<string>        // e-mails em minúsculas
}): { members: Member[]; excludedOptout: number; excludedInvalid: number } {
  const f = input.filters
  const out = new Map<string, Member>()
  let excludedOptout = 0, excludedInvalid = 0
  const add = (m: Member) => {
    const email = m.email.trim().toLowerCase()
    if (!EMAIL_RE.test(email)) { excludedInvalid++; return }
    if (input.optouts.has(email)) { excludedOptout++; return }
    if (!out.has(email)) out.set(email, { ...m, email })
  }

  if (input.audience !== 'clientes') {
    for (const l of input.leads) {
      if (f.lead_status?.length && !f.lead_status.includes(l.status ?? '')) continue
      if (f.campaign_ids?.length && !f.campaign_ids.includes(l.campaign_id ?? '')) continue
      if (f.channels?.length && !f.channels.includes(inferChannel(l))) continue
      if (f.min_score !== null && f.min_score !== undefined && (l.score ?? 0) < f.min_score) continue
      if (f.created_from && l.created_at.slice(0, 10) < f.created_from) continue
      if (!l.email) { excludedInvalid++; continue }
      add({ email: l.email, name: l.name, phone: l.phone, company: l.company_name, kind: 'lead' })
    }
  }

  if (input.audience !== 'leads') {
    const ok = new Map<string, SegClient>()
    for (const c of input.clients) {
      if (f.segments?.length && !c.segments.some(s => f.segments!.includes(s))) continue
      if (f.ufs?.length && !c.ufs.some(u => f.ufs!.includes(u))) continue
      if (f.tag_ids?.length && !c.tag_ids.some(t => f.tag_ids!.includes(t))) continue
      ok.set(c.company_id, c)
    }
    for (const ct of input.contacts) {
      const client = ct.company_id ? ok.get(ct.company_id) : undefined
      if (!client) continue
      if (f.only_primary && !ct.is_primary) continue
      if (!ct.email) { excludedInvalid++; continue }
      add({ email: ct.email, name: ct.name ?? ct.email, phone: ct.phone, company: client.company_name, kind: 'cliente' })
    }
  }

  return { members: [...out.values()].sort((a, b) => a.name.localeCompare(b.name)), excludedOptout, excludedInvalid }
}
