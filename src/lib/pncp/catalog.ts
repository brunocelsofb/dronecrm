// ─── Licitações (PNCP) · regras puras ────────────────────────────────────────
// Sem banco e sem rede: modalidades, normalização de texto, leitura do retorno da API
// e o teste "esta contratação bate com este monitoramento?". Usado no servidor e na tela.

// Modalidades de contratação do PNCP (código → nome). Leilões ficam fora da busca (são vendas do órgão).
export const MODALIDADES: { id: number; nome: string; busca: boolean }[] = [
  { id: 6, nome: 'Pregão eletrônico', busca: true },
  { id: 7, nome: 'Pregão presencial', busca: true },
  { id: 4, nome: 'Concorrência eletrônica', busca: true },
  { id: 5, nome: 'Concorrência presencial', busca: true },
  { id: 8, nome: 'Dispensa de licitação', busca: true },
  { id: 9, nome: 'Inexigibilidade', busca: true },
  { id: 12, nome: 'Credenciamento', busca: true },
  { id: 2, nome: 'Diálogo competitivo', busca: true },
  { id: 10, nome: 'Manifestação de interesse', busca: true },
  { id: 11, nome: 'Pré-qualificação', busca: true },
  { id: 3, nome: 'Concurso', busca: false },
  { id: 1, nome: 'Leilão eletrônico', busca: false },
  { id: 13, nome: 'Leilão presencial', busca: false },
]
export const SEARCH_MODALIDADES = MODALIDADES.filter(m => m.busca).map(m => m.id)
export const modalidadeNome = (id: number | null | undefined) => MODALIDADES.find(m => m.id === id)?.nome ?? '—'

export const MATCH_STATUS = ['nova', 'analisando', 'participar', 'descartada', 'oportunidade'] as const
export type MatchStatus = typeof MATCH_STATUS[number]
export const STATUS_LABEL: Record<MatchStatus, string> = {
  nova: 'Nova', analisando: 'Em análise', participar: 'Vamos participar', descartada: 'Descartada', oportunidade: 'Virou oportunidade',
}

export const MAX_KEYWORDS = 30

// minúsculas, sem acento, espaços simples
export function normText(s: string | null | undefined): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

// Lista de palavras/frases digitadas (uma por linha ou separadas por vírgula ou ponto e vírgula)
export function parseTerms(v: unknown): string[] {
  const raw = Array.isArray(v) ? v.map(String) : String(v ?? '').split(/[\n,;]+/)
  const out: string[] = []
  for (const t of raw) {
    const n = t.trim().replace(/\s+/g, ' ').slice(0, 80)
    if (n && !out.some(o => normText(o) === normText(n))) out.push(n)
  }
  return out.slice(0, MAX_KEYWORDS)
}

// Datas do PNCP vêm no horário de Brasília sem fuso ("2026-11-17T13:00:01")
export function pncpDate(v: unknown): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(v)) return null
  return /[zZ]|[+-]\d{2}:?\d{2}$/.test(v) ? v : `${v.length === 10 ? `${v}T00:00:00` : v}-03:00`
}

export type PncpRow = {
  numero_controle: string; orgao_cnpj: string | null; orgao_nome: string | null; esfera: string | null
  unidade_nome: string | null; uf: string | null; municipio: string | null; codigo_ibge: string | null
  modalidade_id: number | null; modalidade_nome: string | null; objeto: string | null; objeto_norm: string
  info_complementar: string | null; valor_estimado: number | null; srp: boolean | null
  situacao_id: number | null; situacao_nome: string | null
  data_publicacao: string | null; data_abertura: string | null; data_encerramento: string | null
  link_origem: string | null; ano_compra: number | null; sequencial_compra: number | null; atualizado_em: string | null
}

const str = (v: unknown, max = 4000) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
const num = (v: unknown) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

// Um item do retorno de /v1/contratacoes/* → linha da cópia local
export function mapCompra(d: Record<string, unknown>): PncpRow | null {
  const id = str(d.numeroControlePNCP, 80)
  if (!id) return null
  const org = (d.orgaoEntidade ?? {}) as Record<string, unknown>
  const un = (d.unidadeOrgao ?? {}) as Record<string, unknown>
  const objeto = str(d.objetoCompra)
  return {
    numero_controle: id,
    orgao_cnpj: str(org.cnpj, 20), orgao_nome: str(org.razaoSocial, 300), esfera: str(org.esferaId, 2),
    unidade_nome: str(un.nomeUnidade, 300), uf: str(un.ufSigla, 2), municipio: str(un.municipioNome, 120), codigo_ibge: str(un.codigoIbge, 10),
    modalidade_id: num(d.modalidadeId), modalidade_nome: str(d.modalidadeNome, 80),
    objeto, objeto_norm: normText(`${objeto ?? ''} ${str(d.informacaoComplementar) ?? ''}`).slice(0, 6000),
    info_complementar: str(d.informacaoComplementar),
    valor_estimado: num(d.valorTotalEstimado), srp: typeof d.srp === 'boolean' ? d.srp : null,
    situacao_id: num(d.situacaoCompraId), situacao_nome: str(d.situacaoCompraNome, 60),
    data_publicacao: pncpDate(d.dataPublicacaoPncp), data_abertura: pncpDate(d.dataAberturaProposta), data_encerramento: pncpDate(d.dataEncerramentoProposta),
    link_origem: str(d.linkSistemaOrigem, 1000) ?? str(d.linkProcessoEletronico, 1000),
    ano_compra: num(d.anoCompra), sequencial_compra: num(d.sequencialCompra), atualizado_em: pncpDate(d.dataAtualizacaoGlobal),
  }
}

// Página da contratação no portal do PNCP (cnpj-ano-sequencial)
export function pncpUrl(r: Pick<PncpRow, 'orgao_cnpj' | 'ano_compra' | 'sequencial_compra'>): string | null {
  return r.orgao_cnpj && r.ano_compra && r.sequencial_compra ? `https://pncp.gov.br/app/editais/${r.orgao_cnpj}/${r.ano_compra}/${r.sequencial_compra}` : null
}

export type WatcherRule = {
  keywords: string[]; exclude: string[]; ufs: string[]; modalidades: number[]
  min_value: number | null; max_value: number | null
}

// Ainda dá para disputar? (sem data de encerramento conta como aberta)
export function isOpen(r: Pick<PncpRow, 'data_encerramento' | 'situacao_id'>, nowMs: number): boolean {
  if (r.situacao_id && r.situacao_id !== 1) return false   // 2 revogada, 3 anulada, 4 suspensa
  if (!r.data_encerramento) return true
  return Date.parse(r.data_encerramento) >= nowMs
}

// Bate com o monitoramento? Devolve as palavras encontradas (vazio = não bate)
export function matchWatcher(r: Pick<PncpRow, 'objeto_norm' | 'uf' | 'modalidade_id' | 'valor_estimado'>, w: WatcherRule): string[] {
  if (w.ufs.length && (!r.uf || !w.ufs.includes(r.uf))) return []
  if (w.modalidades.length && (!r.modalidade_id || !w.modalidades.includes(r.modalidade_id))) return []
  const v = r.valor_estimado
  if (v && v > 0) {   // valor 0 ou vazio = não informado (sigiloso): não descarta
    if (w.min_value !== null && v < w.min_value) return []
    if (w.max_value !== null && v > w.max_value) return []
  }
  const text = ` ${r.objeto_norm} `
  if (w.exclude.some(x => termHits(text, x))) return []
  return w.keywords.filter(k => termHits(text, k))
}

// Palavras que não ajudam a achar (ignoradas quando a linha tem várias palavras)
const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'para', 'com', 'a', 'o', 'as', 'os', 'na', 'no', 'nas', 'nos', 'por', 'ou'])

// Palavras de uma linha: entre aspas = frase exata; senão, cada palavra (≥ 3 letras, sem "de", "e"…)
export function termWords(term: string): { phrase: string | null; words: string[] } {
  const t = term.trim()
  if (/^".+"$/.test(t)) return { phrase: normText(t.slice(1, -1)), words: [] }
  const words = normText(t).split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !STOP.has(w))
  return { phrase: null, words: words.length ? words : [normText(t)] }
}

// A linha bate? Frase: aparece igual. Palavras: todas aparecem, em qualquer ordem
// (aceita plural e variações simples: "equipamento" acha "equipamentos", "médico" acha "médico-hospitalar").
export function termHits(textNorm: string, term: string): boolean {
  const { phrase, words } = termWords(term)
  if (phrase) return textNorm.includes(phrase)
  return words.every(w => textNorm.includes(stem(w)))
}

// Raiz simples para achar singular e plural: médicos → medico, hospitalares → hospitalar,
// hospitais → hospital, calibrações → calibraca(o), equipamentos → equipamento
export function stem(w: string): string {
  if (w.length <= 4) return w
  if (w.endsWith('oes') || w.endsWith('aes')) return w.slice(0, -3) + 'a'
  if (w.endsWith('ais')) return w.slice(0, -3) + 'a'
  if (w.endsWith('res') || w.endsWith('zes')) return w.slice(0, -2)
  if (w.endsWith('s')) return w.slice(0, -1)
  if (w.endsWith('ao')) return w.slice(0, -1)
  if (w.endsWith('al')) return w.slice(0, -1)   // hospital ↔ hospitais
  return w
}

// ── Busca por palavra do portal do PNCP (/api/search) ───────────────────────
// É a mesma busca do site pncp.gov.br: procura em qualquer período, com a situação escolhida.
export const PNCP_SEARCH_URL = 'https://pncp.gov.br/api/search/'
export const SEARCH_SITUACOES = [
  { id: 'abertas', nome: 'Abertas (recebendo propostas)', api: 'recebendo_proposta' },
  { id: 'encerradas', nome: 'Encerradas', api: 'encerradas' },
  { id: 'todas', nome: 'Todas (qualquer período)', api: null },
] as const
export type SearchSituacao = typeof SEARCH_SITUACOES[number]['id']

// Texto digitado → consulta do PNCP. "entre aspas" = frase exata; senão todas as palavras (+palavra).
export function pncpSearchQuery(text: string): string {
  const t = text.trim()
  if (!t) return ''
  const { phrase, words } = termWords(t)
  if (phrase) return `"${phrase}"`
  return words.map(w => `+${w}`).join(' ')
}

// Um item do /api/search → linha da cópia local (mesmo formato do mapCompra)
export function mapSearchItem(d: Record<string, unknown>): PncpRow | null {
  const id = str(d.numero_controle_pncp, 80)
  if (!id) return null
  const objeto = str(d.description)
  const info = str(d.informacao_complementar)
  return {
    numero_controle: id,
    orgao_cnpj: str(d.orgao_cnpj, 20), orgao_nome: str(d.orgao_nome, 300), esfera: str(d.esfera_id, 2),
    unidade_nome: str(d.unidade_nome, 300), uf: str(d.uf, 2), municipio: str(d.municipio_nome, 120), codigo_ibge: str(d.codigo_ibge, 10),
    modalidade_id: num(d.modalidade_licitacao_id), modalidade_nome: str(d.modalidade_licitacao_nome, 80),
    objeto, objeto_norm: normText(`${objeto ?? ''} ${info ?? ''}`).slice(0, 6000),
    info_complementar: info,
    valor_estimado: num(d.valor_total_estimado), srp: typeof d.srp === 'boolean' ? d.srp : null,
    situacao_id: d.cancelado === true ? 3 : num(d.situacao_id), situacao_nome: str(d.situacao_nome, 60),
    data_publicacao: pncpDate(d.data_publicacao_pncp), data_abertura: pncpDate(d.data_inicio_vigencia), data_encerramento: pncpDate(d.data_fim_vigencia),
    link_origem: str(d.link_sistema_origem, 1000) ?? str(d.link_processo_eletronico, 1000),
    ano_compra: num(d.ano), sequencial_compra: num(d.numero_sequencial), atualizado_em: pncpDate(d.data_atualizacao_pncp),
  }
}
