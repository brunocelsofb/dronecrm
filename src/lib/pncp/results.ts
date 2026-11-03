// ─── Licitações (PNCP) · resultado e contratos por fornecedor ───────────────────
// Só leitura do PNCP (dado público). Sem tenant: quem chama decide o que guardar e para quem.
//   fetchResultado: itens da compra com a situação (em andamento, homologado, deserto…) e o vencedor
//     de cada item (CNPJ, nome, valor homologado).
//   outcomeFor: com os CNPJs da empresa, diz se ganhamos, perdemos, ainda aguarda ou não teve vencedor.
//   supplierContracts: contratos assinados de um CNPJ no PNCP (para "nossos contratos" e concorrentes).
import { PNCP_SEARCH_URL, pncpDate, type PncpRow } from './catalog'

const PNCP = 'https://pncp.gov.br/api/pncp/v1'

async function getJson(url: string, ms = 15_000): Promise<unknown | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), ms)
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store', signal: ctrl.signal })
      if (r.status === 204 || r.status === 404) return []
      if (r.ok) return await r.json()
    } catch { /* tenta de novo */ } finally { clearTimeout(t) }
  }
  return null
}

export const onlyDigits = (v: unknown) => String(v ?? '').replace(/\D/g, '')
export const isCnpj = (v: unknown) => onlyDigits(v).length === 14
// Mesma empresa = mesma raiz do CNPJ (8 primeiros dígitos): vale para matriz e filiais
export const cnpjRoot = (v: unknown) => onlyDigits(v).slice(0, 8)
export function fmtCnpj(v: unknown): string {
  const d = onlyDigits(v)
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : String(v ?? '')
}

export type Vencedor = { ni: string; nome: string; porte: string | null; valorUnitario: number | null; valorTotal: number | null; quantidade: number | null; data: string | null }
export type ItemResultado = {
  numero: number; descricao: string; situacao: string; estimado: number | null; quantidade: number | null
  temResultado: boolean; vencedores: Vencedor[]
}
export type Resultado = {
  itens: ItemResultado[]; itensTotal: number; estimadoTotal: number; homologadoTotal: number
  comResultado: number; encerrados: number; sig: string; lidoEm: string
}

const n = (v: unknown) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
// Situação do item que não vai mais mudar
const FINAL_ITEM = /homologad|desert|fracassad|anulad|revogad|cancelad/i

export async function fetchResultado(row: Pick<PncpRow, 'orgao_cnpj' | 'ano_compra' | 'sequencial_compra'>, maxItens = 120): Promise<Resultado | null> {
  if (!row.orgao_cnpj || !row.ano_compra || !row.sequencial_compra) return null
  const base = `${PNCP}/orgaos/${row.orgao_cnpj}/compras/${row.ano_compra}/${row.sequencial_compra}`
  const raw: Record<string, unknown>[] = []
  for (let page = 1; raw.length < maxItens; page++) {
    const j = await getJson(`${base}/itens?pagina=${page}&tamanhoPagina=50`)
    if (j === null) { if (page === 1) return null; break }
    const list = Array.isArray(j) ? (j as Record<string, unknown>[]) : []
    raw.push(...list)
    if (list.length < 50) break
  }
  const itens: ItemResultado[] = raw.slice(0, maxItens).map(x => ({
    numero: Number(x.numeroItem ?? 0), descricao: String(x.descricao ?? '').slice(0, 600),
    situacao: String(x.situacaoCompraItemNome ?? '—'), estimado: n(x.valorTotal), quantidade: n(x.quantidade),
    temResultado: x.temResultado === true, vencedores: [],
  }))
  // Resultado só dos itens que têm (5 ao mesmo tempo)
  const queue = itens.filter(i => i.temResultado)
  const worker = async () => {
    while (queue.length) {
      const it = queue.shift()!
      const j = await getJson(`${base}/itens/${it.numero}/resultados`)
      const list = Array.isArray(j) ? (j as Record<string, unknown>[]) : []
      it.vencedores = list.filter(r => !r.dataCancelamento).map(r => ({
        ni: onlyDigits(r.niFornecedor), nome: String(r.nomeRazaoSocialFornecedor ?? '—'), porte: (r.porteFornecedorNome as string | null) ?? null,
        valorUnitario: n(r.valorUnitarioHomologado), valorTotal: n(r.valorTotalHomologado), quantidade: n(r.quantidadeHomologada),
        data: typeof r.dataResultado === 'string' ? r.dataResultado : null,
      }))
    }
  }
  await Promise.all(Array.from({ length: 5 }, worker))
  const estimadoTotal = itens.reduce((s, i) => s + (i.estimado ?? 0), 0)
  const homologadoTotal = itens.reduce((s, i) => s + i.vencedores.reduce((a, v) => a + (v.valorTotal ?? 0), 0), 0)
  const sig = itens.map(i => `${i.numero}:${i.situacao}:${i.vencedores.map(v => `${v.ni}=${v.valorTotal ?? ''}`).join(',')}`).join('|')
  return {
    itens, itensTotal: raw.length, estimadoTotal, homologadoTotal,
    comResultado: itens.filter(i => i.vencedores.length).length,
    encerrados: itens.filter(i => FINAL_ITEM.test(i.situacao)).length,
    sig, lidoEm: new Date().toISOString(),
  }
}

export type Outcome = 'aguardando' | 'ganhou' | 'perdeu' | 'sem_vencedor' | 'cancelada'
export const OUTCOME_LABEL: Record<Outcome, string> = {
  aguardando: 'Aguardando resultado', ganhou: 'Ganhamos', perdeu: 'Não ganhamos', sem_vencedor: 'Sem vencedor (deserta/fracassada)', cancelada: 'Cancelada',
}

export function outcomeFor(res: Resultado, row: Pick<PncpRow, 'situacao_id'>, ownCnpjs: string[]): { status: Outcome; wonValue: number; winners: string[] } {
  const own = new Set(ownCnpjs.map(cnpjRoot).filter(Boolean))
  let wonValue = 0
  const winners = new Map<string, string>()
  for (const i of res.itens) for (const v of i.vencedores) {
    if (own.has(cnpjRoot(v.ni))) wonValue += v.valorTotal ?? 0
    else winners.set(v.ni, `${v.ni}|${v.nome}`)
  }
  let status: Outcome = 'aguardando'
  if (row.situacao_id === 2 || row.situacao_id === 3) status = 'cancelada'
  else if (wonValue > 0) status = 'ganhou'
  else if (res.itens.length && res.encerrados === res.itens.length) status = res.comResultado ? 'perdeu' : 'sem_vencedor'
  else if (res.comResultado && own.size) status = 'perdeu'
  return { status, wonValue, winners: [...winners.values()] }
}

// ── Contratos de um CNPJ (fornecedor) ────────────────────────────────────────
export type SupplierContract = {
  numero_controle: string | null; titulo: string; orgao_nome: string | null; orgao_cnpj: string | null; uf: string | null; municipio: string | null
  objeto: string | null; valor: number | null; assinatura: string | null; vigencia_fim: string | null; fornecedor_nome: string | null; url: string | null
}

export async function supplierContracts(cnpj: string, maxPages = 4): Promise<{ items: SupplierContract[]; total: number } | null> {
  const d = onlyDigits(cnpj)
  if (d.length !== 14) return null
  const root = cnpjRoot(d)
  const items: SupplierContract[] = []
  let total = 0
  for (let page = 1; page <= maxPages; page++) {
    const q = new URLSearchParams({ q: d, tipos_documento: 'contrato', ordenacao: '-data', pagina: String(page), tam_pagina: '50' })
    const j = (await getJson(`${PNCP_SEARCH_URL}?${q}`, 20_000)) as { items?: Record<string, unknown>[]; total?: number } | null
    if (!j || Array.isArray(j)) { if (page === 1 && !j) return null; break }
    total = Number(j.total ?? 0)
    const list = j.items ?? []
    for (const x of list) {
      if (cnpjRoot(x.fornecedor_ni) !== root) continue   // a busca acha o número em outros campos também
      const url = typeof x.item_url === 'string' ? `https://pncp.gov.br/app${x.item_url}` : null
      items.push({
        numero_controle: (x.numero_controle_pncp as string | null) ?? null, titulo: String(x.title ?? 'Contrato'),
        orgao_nome: (x.orgao_nome as string | null) ?? null, orgao_cnpj: (x.orgao_cnpj as string | null) ?? null,
        uf: (x.uf as string | null) ?? null, municipio: (x.municipio_nome as string | null) ?? null,
        objeto: (x.description as string | null) ?? null, valor: n(x.valor_global) ?? n(x.valor_total_estimado),
        assinatura: pncpDate(x.data_assinatura), vigencia_fim: pncpDate(x.data_fim_vigencia),
        fornecedor_nome: (x.fornecedor_nome as string | null) ?? null, url,
      })
    }
    if (page * 50 >= total || list.length < 50) break
  }
  return { items, total }
}

// Resumo para o perfil (nosso ou de concorrente): quanto, onde e para quem
export function supplierSummary(items: SupplierContract[]) {
  const byUf = new Map<string, { n: number; valor: number }>()
  const byOrgao = new Map<string, { nome: string; uf: string | null; n: number; valor: number }>()
  let valor = 0
  for (const c of items) {
    valor += c.valor ?? 0
    const u = c.uf ?? '—'
    const a = byUf.get(u) ?? { n: 0, valor: 0 }; a.n++; a.valor += c.valor ?? 0; byUf.set(u, a)
    const k = c.orgao_cnpj ?? c.orgao_nome ?? '—'
    const o = byOrgao.get(k) ?? { nome: c.orgao_nome ?? '—', uf: c.uf, n: 0, valor: 0 }; o.n++; o.valor += c.valor ?? 0; byOrgao.set(k, o)
  }
  return {
    contratos: items.length, valor,
    nome: items.find(i => i.fornecedor_nome)?.fornecedor_nome ?? null,
    ufs: [...byUf.entries()].map(([uf, v]) => ({ uf, ...v })).sort((a, b) => b.valor - a.valor),
    orgaos: [...byOrgao.values()].sort((a, b) => b.valor - a.valor).slice(0, 10),
  }
}
