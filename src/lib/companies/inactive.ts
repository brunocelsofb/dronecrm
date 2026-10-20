// ─── Empresas inativas (cálculo puro, sem banco — testável) ───────────────────
// Inativa = já comprou da empresa (teve negócio ganho ou está cadastrada como
// cliente) E não tem contrato ativo (passagem aberta em funil de gestão de
// contratos) E a última compra (ganho, em qualquer funil) foi há mais de N meses
// — ou não há compra registrada no CRM (cliente cadastrado/importado como cliente).
// Prospects e leads que nunca compraram não entram: são prospecção, não reativação.

import { segmentOf } from './settings'

export type InCompany = {
  id: string; name: string; trade_name: string | null; cnpj: string | null
  segment: string | null; status: string | null
  account_owner_id: string | null; owner_id: string | null
}
export type InContract = { id: string; company_id: string | null }
export type InPipeline = { id: string; type: string | null }
export type InRun = { contract_id: string; pipeline_id: string; status: string; ended_at: string | null }

export type InactiveCompany = {
  id: string; name: string; tradeName: string | null; cnpj: string | null
  segment: string | null                 // null = sem segmento
  lastWon: string | null                 // aaaa-mm-dd da última compra (ganho)
  monthsSince: number | null             // meses desde a última compra
  negotiating: boolean                   // tem negociação aberta em funil de vendas
  ownerId: string | null                 // responsável da conta (ou quem cadastrou)
}

const CLIENT_STATUS = new Set(['cliente_ativo', 'cliente_inativo'])

// Meses cheios entre duas datas aaaa-mm-dd
export function monthsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.slice(0, 10).split('-').map(Number)
  const [ty, tm, td] = to.slice(0, 10).split('-').map(Number)
  let m = (ty - fy) * 12 + (tm - fm)
  if (td < fd) m--
  return Math.max(0, m)
}

export function computeInactive(input: {
  companies: InCompany[]; contracts: InContract[]; pipelines: InPipeline[]; runs: InRun[]
  months: number; today: string        // aaaa-mm-dd (Brasília)
}): InactiveCompany[] {
  const mgmt = new Set(input.pipelines.filter(p => p.type === 'gestao_contratos').map(p => p.id))
  const companyOf = new Map(input.contracts.map(c => [c.id, c.company_id]))
  const active = new Set<string>(), negotiating = new Set<string>()
  const lastWon = new Map<string, string>()
  for (const r of input.runs) {
    const cid = companyOf.get(r.contract_id)
    if (!cid) continue
    if (r.status === 'open') (mgmt.has(r.pipeline_id) ? active : negotiating).add(cid)
    if (r.status === 'won' && r.ended_at) {
      const d = r.ended_at.slice(0, 10)
      const cur = lastWon.get(cid)
      if (!cur || d > cur) lastWon.set(cid, d)
    }
  }

  const out: InactiveCompany[] = []
  for (const c of input.companies) {
    if (active.has(c.id)) continue
    const won = lastWon.get(c.id) ?? null
    if (!won && !CLIENT_STATUS.has(c.status ?? '')) continue          // nunca comprou
    const since = won ? monthsBetween(won, input.today) : null
    if (since !== null && since < input.months) continue               // comprou há pouco
    out.push({
      id: c.id, name: c.name, tradeName: c.trade_name, cnpj: c.cnpj,
      segment: segmentOf(c.segment), lastWon: won, monthsSince: since,
      negotiating: negotiating.has(c.id), ownerId: c.account_owner_id ?? c.owner_id ?? null,
    })
  }
  // Há mais tempo sem comprar primeiro; sem compra registrada no fim
  return out.sort((a, b) => (a.lastWon && b.lastWon ? a.lastWon.localeCompare(b.lastWon) : a.lastWon ? -1 : b.lastWon ? 1 : a.name.localeCompare(b.name)))
}

// Contagem por segmento (na ordem da lista cadastrada; "Sem segmento" e outros no fim)
export function bySegment(list: InactiveCompany[], segments: string[]): { segment: string; count: number; negotiating: number }[] {
  const m = new Map<string, { count: number; negotiating: number }>()
  for (const c of list) {
    const k = c.segment ?? 'Sem segmento'
    const e = m.get(k) ?? { count: 0, negotiating: 0 }
    e.count++; if (c.negotiating) e.negotiating++
    m.set(k, e)
  }
  const order = [...segments, ...[...m.keys()].filter(k => !segments.includes(k) && k !== 'Sem segmento').sort(), 'Sem segmento']
  return order.filter(k => m.has(k)).map(k => ({ segment: k, ...m.get(k)! }))
}
