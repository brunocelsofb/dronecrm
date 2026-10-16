// ─── Farmer: leitura do contrato (PDF) e próximos passos da renovação ────────
// O PDF vai para o Claude com a chave da Anthropic da empresa. O modelo do JSON
// vai no próprio pedido (o formato forçado pela API recusa um schema deste
// tamanho: "compiled grammar is too large"); o CRM extrai e valida a resposta
// em normalizeReading(), citando cláusula e trecho. Datas-chave (prazo do aviso prévio, dias até o
// fim) são RECALCULADAS pelo CRM a partir do que foi lido — a IA não faz conta
// de datas.
//
// O não está no contrato vem como "" (texto), 0 (número)
// ou "nao_encontrado" (sim/não) e é convertido em null por normalizeReading().

import Anthropic from '@anthropic-ai/sdk'
import { daysUntilBR } from './renewal-templates'

export const CONTRACT_READER_MODEL = 'claude-sonnet-5-5'

export type SimNao = 'sim' | 'nao' | null           // null = não encontrado no contrato

export type ReadingStep = {
  acao: string
  prazo: string | null              // YYYY-MM-DD
  area: 'comercial' | 'juridico' | 'tecnico' | 'financeiro' | 'cliente'
  motivo: string
  clausula: string | null
}

type Ref = { clausula: string | null; trecho: string | null }

export type ContractReading = {
  versao: number
  objeto: string | null
  contratante: string | null
  contratada: string | null
  numero: string | null
  vigencia: { inicio: string | null; fim: string | null; prazo_meses: number | null } & Ref
  renovacao: { automatica: SimNao; exige_aditivo: SimNao; regra: string | null; limite: string | null } & Ref
  aviso_previo: { dias: number | null; regra: string | null } & Ref
  reajuste: { indice: string | null; periodicidade: string | null; data_base: string | null; regra: string | null } & Ref
  repactuacao: { prevista: SimNao; regra: string | null } & Ref
  reequilibrio: { previsto: SimNao; regra: string | null } & Ref
  valor: { mensal: number | null; total: number | null; clausula: string | null }
  quantitativos: { item: string; quantidade: string; clausula: string | null }[]
  equipe: { funcao: string; quantidade: number | null; regime: string | null; clausula: string | null }[]
  equipe_total: number | null
  acoes_objeto: { acao: string; frequencia: string | null; clausula: string | null }[]
  sla: { indicador: string; meta: string | null; prazo: string | null; penalidade: string | null; clausula: string | null }[]
  prazos: { descricao: string; prazo: string; clausula: string | null }[]
  rescisao: { hipoteses: string[]; aviso_dias: number | null; multa: string | null } & Ref
  multas: { situacao: string; penalidade: string; clausula: string | null }[]
  caminhos_renovacao: { caminho: string; quando: string; requisitos: string; clausula: string | null }[]
  obrigacoes_relevantes: string[]
  riscos: string[]
  infraestrutura: { item: string; responsavel: 'contratada' | 'contratante' | 'nao_claro'; detalhe: string | null; clausula: string | null }[]
  servicos: { servico: string; previsto: SimNao; detalhe: string | null; periodicidade: string | null; clausula: string | null }[]
  normativas: { norma: string; exigencia: string | null; clausula: string | null }[]
  alteracoes_aditivos: { documento: string; alteracao: string; clausula: string | null }[]
  nao_claros: { ponto: string; por_que: string | null; sugestao: string | null; clausula: string | null }[]
  proximos_passos: ReadingStep[]
  avisos: string[]                    // ex.: parte da leitura que falhou
}

// Calculado pelo CRM (não pela IA)
export type ReadingChecks = {
  fimContrato: string | null
  diasAteFim: number | null
  prazoAvisoPrevio: string | null       // fim − dias de aviso
  diasAtePrazoAviso: number | null
  divergencias: string[]
}

// ─── Schema enviado à API ────────────────────────────────────────────────────
type Props = Record<string, Record<string, unknown>>
const obj = (properties: Props, description?: string) => ({
  type: 'object',
  ...(description ? { description } : {}),
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
})
const arr = (items: Record<string, unknown>, description: string) => ({ type: 'array', description, items })
const T = (description?: string) => ({ type: 'string', ...(description ? { description } : {}) })
const N = (description?: string) => ({ type: 'number', ...(description ? { description } : {}) })
const SNE = (description: string) => ({ type: 'string', enum: ['sim', 'nao', 'nao_encontrado'], description })
const CL = T('Cláusula/item onde está (ex.: "Cláusula 5.2"); "" se não houver')
const TR = T('Trecho literal curto do contrato que comprova; "" se não houver')

const SCHEMA = obj({
  objeto: T('Objeto do contrato em uma frase'),
  contratante: T(),
  contratada: T(),
  numero: T('Número do contrato/processo, se constar'),
  vigencia: obj({ inicio: T('YYYY-MM-DD'), fim: T('YYYY-MM-DD'), prazo_meses: N('Prazo em meses; 0 se não constar'), clausula: CL, trecho: TR }),
  renovacao: obj({
    automatica: SNE('A renovação/prorrogação é automática (sem ato das partes)?'),
    exige_aditivo: SNE('A prorrogação exige termo aditivo?'),
    regra: T('Como a prorrogação acontece, condições'),
    limite: T('Limite de prorrogações ou prazo máximo total (ex.: até 60 meses / até 4 vezes)'),
    clausula: CL, trecho: TR,
  }),
  aviso_previo: obj({ dias: N('Dias de antecedência para manifestar interesse/não renovação; 0 se não constar'), regra: T(), clausula: CL, trecho: TR }),
  reajuste: obj({
    indice: T('Índice de reajuste exatamente como escrito (IPCA, IGP-M, INPC, IST, outro)'),
    periodicidade: T('Ex.: anual, a cada 12 meses'),
    data_base: T('YYYY-MM-DD ou descrição (ex.: data da proposta, aniversário do contrato)'),
    regra: T(), clausula: CL, trecho: TR,
  }),
  repactuacao: obj({ prevista: SNE('O contrato prevê repactuação (revisão por custos de mão de obra/convenção coletiva)?'), regra: T(), clausula: CL, trecho: TR }),
  reequilibrio: obj({ previsto: SNE('O contrato prevê reequilíbrio econômico-financeiro (revisão)?'), regra: T(), clausula: CL, trecho: TR }),
  valor: obj({ mensal: N('Valor mensal em reais; 0 se não constar'), total: N('Valor total/global em reais; 0 se não constar'), clausula: CL }),
  quantitativos: arr(obj({ item: T(), quantidade: T('Quantidade com unidade, como escrito'), clausula: CL }), 'Itens/quantidades contratados (equipamentos, postos, horas, unidades)'),
  equipe: arr(obj({ funcao: T('Cargo/função'), quantidade: N('Quantidade de pessoas; 0 se não constar'), regime: T('Jornada/escala/dedicação; "" se não constar'), clausula: CL }), 'Equipe do projeto exigida no contrato'),
  equipe_total: N('Total de pessoas da equipe; 0 se não constar'),
  acoes_objeto: arr(obj({ acao: T(), frequencia: T('Ex.: mensal, sob demanda; "" se não constar'), clausula: CL }), 'Principais ações/serviços do objeto'),
  sla: arr(obj({ indicador: T(), meta: T(), prazo: T('Prazo de atendimento/solução'), penalidade: T('Penalidade se descumprir; "" se não constar'), clausula: CL }), 'Níveis de serviço (SLA), prazos de atendimento e indicadores'),
  prazos: arr(obj({ descricao: T(), prazo: T('Data YYYY-MM-DD ou prazo como escrito (ex.: 30 dias após a assinatura)'), clausula: CL }), 'Prazos contratuais (entregas, relatórios, garantias, pagamentos)'),
  rescisao: obj({
    hipoteses: arr(T(), 'Hipóteses de rescisão'),
    aviso_dias: N('Aviso para rescisão em dias; 0 se não constar'),
    multa: T('Multa por rescisão como escrita; "" se não constar'),
    clausula: CL, trecho: TR,
  }),
  multas: arr(obj({ situacao: T(), penalidade: T('Percentual/valor como escrito'), clausula: CL }), 'Multas e penalidades (atraso, inexecução, SLA)'),
  caminhos_renovacao: arr(obj({
    caminho: T('Ex.: prorrogação por aditivo, renovação automática, nova licitação/contratação, renegociação com reajuste'),
    quando: T('Em que situação esse caminho é possível segundo o contrato'),
    requisitos: T('O que precisa (documentos, prazos, aprovações)'),
    clausula: CL,
  }), 'Possíveis caminhos para renovar, com base no contrato'),
  infraestrutura: arr(obj({
    item: T('Recurso: celular, tablet, notebook, veículo/deslocamento, ferramentas, instrumentos/padrões, software, EPI, uniforme, sala, internet etc.'),
    responsavel: { type: 'string', enum: ['contratada', 'contratante', 'nao_claro'] },
    detalhe: T('Quantidade/condição como escrita; "" se não constar'),
    clausula: CL,
  }), 'Infraestrutura e recursos necessários para executar o contrato e quem fornece'),
  servicos: arr(obj({
    servico: T('Nome do serviço'),
    previsto: SNE('O contrato prevê este serviço?'),
    detalhe: T('Escopo/condições; "" se não constar'),
    periodicidade: T('Ex.: mensal, anual, conforme fabricante; "" se não constar'),
    clausula: CL,
  }), 'Serviços aplicáveis'),
  normativas: arr(obj({ norma: T('Norma/lei/resolução (ex.: RDC, NBR, ABNT, NR)'), exigencia: T('O que a norma exige no contrato'), clausula: CL }), 'Normas e legislação que a contratada precisa cumprir'),
  alteracoes_aditivos: arr(obj({ documento: T('Ex.: Aditivo 1'), alteracao: T('O que o aditivo mudou (prazo, valor, escopo, equipe…)'), clausula: CL }), 'Mudanças feitas por cada aditivo; [] se não houver aditivo'),
  nao_claros: arr(obj({
    ponto: T('O que está ambíguo, contraditório ou faltando'),
    por_que: T('Por que não está claro'),
    sugestao: T('O que perguntar/esclarecer com o cliente'),
    clausula: CL,
  }), 'Pontos do contrato que não estão claros'),
  obrigacoes_relevantes: arr(T(), 'Obrigações que impactam a renovação'),
  riscos: arr(T(), 'Pontos de atenção para a renovação, citando a cláusula'),
  proximos_passos: arr(obj({
    acao: T(),
    prazo: T('YYYY-MM-DD; respeite o aviso prévio e a vigência; "" se não houver'),
    area: { type: 'string', enum: ['comercial', 'juridico', 'tecnico', 'financeiro', 'cliente'] },
    motivo: T(),
    clausula: CL,
  }), 'Ações concretas para conduzir a renovação, em ordem'),
})

// Modelo do JSON para o pedido, gerado do schema acima (uma fonte só)
function skeleton(node: Record<string, unknown>): unknown {
  if (node.type === 'object') {
    const props = node.properties as Record<string, Record<string, unknown>>
    return Object.fromEntries(Object.entries(props).map(([k, v]) => [k, skeleton(v)]))
  }
  if (node.type === 'array') return [skeleton(node.items as Record<string, unknown>)]
  if (Array.isArray(node.enum)) return (node.enum as string[]).join(' | ')
  const d = typeof node.description === 'string' ? node.description : ''
  if (node.type === 'number') return d ? `<número: ${d}>` : '<número>'
  return d ? `<texto: ${d}>` : '<texto>'
}

// A leitura é feita em TRÊS chamadas em paralelo (metade dos campos cada):
// uma resposta única ficava longa demais (cortada) e lenta para o limite da tela.
const PART_KEYS = {
  renovacao: ['objeto', 'contratante', 'contratada', 'numero', 'vigencia', 'renovacao', 'aviso_previo', 'reajuste', 'repactuacao',
    'reequilibrio', 'valor', 'rescisao', 'caminhos_renovacao', 'riscos', 'proximos_passos'],
  execucao: ['quantitativos', 'equipe', 'equipe_total', 'acoes_objeto', 'sla', 'prazos', 'multas', 'obrigacoes_relevantes'],
  escopo: ['alteracoes_aditivos', 'infraestrutura', 'servicos', 'normativas', 'nao_claros'],
} as const
type Part = keyof typeof PART_KEYS
const fullSkeleton = skeleton(SCHEMA) as Record<string, unknown>
const TEMPLATES: Record<Part, string> = {
  renovacao: JSON.stringify(Object.fromEntries(PART_KEYS.renovacao.map(k => [k, fullSkeleton[k]])), null, 1),
  execucao: JSON.stringify(Object.fromEntries(PART_KEYS.execucao.map(k => [k, fullSkeleton[k]])), null, 1),
  escopo: JSON.stringify(Object.fromEntries(PART_KEYS.escopo.map(k => [k, fullSkeleton[k]])), null, 1),
}
const PART_LABEL: Record<Part, string> = {
  renovacao: 'vigência, renovação, reajuste, rescisão e próximos passos',
  execucao: 'equipe, quantitativos, ações do objeto, SLA, prazos e multas',
  escopo: 'aditivos, infraestrutura, serviços aplicáveis, normas e pontos não claros',
}

// Tira o JSON da resposta (aceita bloco ```json ou texto antes/depois)
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1] : text
  const a = body.indexOf('{'), b = body.lastIndexOf('}')
  if (a < 0 || b <= a) throw new Error('sem JSON')
  return JSON.parse(body.slice(a, b + 1))
}

// ─── Normalização ("" / 0 / nao_encontrado → null) ───────────────────────────
const s = (v: unknown): string | null => (typeof v === 'string' && v.trim() && !/^n[ãa]o (encontrad|consta)/i.test(v.trim()) ? v.trim() : null)
// Número: aceita também texto ("12", "1.234,56", "R$ 10.000,00") caso a IA devolva entre aspas
const n = (v: unknown): number | null => {
  let x = v
  if (typeof x === 'string') {
    const c = x.replace(/[R$\s]/g, '')
    if (!/^[\d.,]+$/.test(c)) return null
    x = Number(c.includes(',') || /^\d{1,3}(\.\d{3})+$/.test(c) ? c.replace(/\./g, '').replace(',', '.') : c)
  }
  return typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : null
}
const sn = (v: unknown): SimNao => (v === 'sim' || v === 'nao' ? v : null)
const list = <T,>(v: unknown, map: (x: Record<string, unknown>) => T | null): T[] =>
  Array.isArray(v) ? v.map(x => (x && typeof x === 'object' ? map(x as Record<string, unknown>) : null)).filter((x): x is T => x !== null) : []
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(s).filter((x): x is string => !!x) : [])
const o = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const AREAS = ['comercial', 'juridico', 'tecnico', 'financeiro', 'cliente'] as const

// Aceita a resposta da API e também leituras antigas (versão 1) gravadas no banco.
export function normalizeReading(raw: unknown): ContractReading {
  const r = o(raw)
  const vig = o(r.vigencia), ren = o(r.renovacao), av = o(r.aviso_previo), rj = o(r.reajuste)
  const rp = o(r.repactuacao), re = o(r.reequilibrio), val = o(r.valor), res = o(r.rescisao)
  // versão 1: renovacao.tipo = automatica | por_aditivo | nao_prevista | nao_encontrado
  const tipoV1 = typeof ren.tipo === 'string' ? ren.tipo : null
  return {
    versao: typeof r.versao === 'number' ? r.versao : (tipoV1 ? 1 : 2),
    objeto: s(r.objeto), contratante: s(r.contratante), contratada: s(r.contratada), numero: s(r.numero),
    vigencia: { inicio: s(vig.inicio), fim: s(vig.fim), prazo_meses: n(vig.prazo_meses), clausula: s(vig.clausula), trecho: s(vig.trecho) },
    renovacao: {
      automatica: tipoV1 ? (tipoV1 === 'automatica' ? 'sim' : tipoV1 === 'nao_encontrado' ? null : 'nao') : sn(ren.automatica),
      exige_aditivo: tipoV1 ? (tipoV1 === 'por_aditivo' ? 'sim' : null) : sn(ren.exige_aditivo),
      regra: s(ren.regra), limite: s(ren.limite), clausula: s(ren.clausula), trecho: s(ren.trecho),
    },
    aviso_previo: { dias: n(av.dias), regra: s(av.regra), clausula: s(av.clausula), trecho: s(av.trecho) },
    reajuste: { indice: s(rj.indice), periodicidade: s(rj.periodicidade), data_base: s(rj.data_base), regra: s(rj.regra), clausula: s(rj.clausula), trecho: s(rj.trecho) },
    repactuacao: { prevista: sn(rp.prevista), regra: s(rp.regra), clausula: s(rp.clausula), trecho: s(rp.trecho) },
    reequilibrio: { previsto: sn(re.previsto), regra: s(re.regra), clausula: s(re.clausula), trecho: s(re.trecho) },
    valor: { mensal: n(val.mensal), total: n(val.total), clausula: s(val.clausula) },
    quantitativos: list(r.quantitativos, x => (s(x.item) ? { item: s(x.item)!, quantidade: s(x.quantidade) ?? '—', clausula: s(x.clausula) } : null)),
    equipe: list(r.equipe, x => (s(x.funcao) ? { funcao: s(x.funcao)!, quantidade: n(x.quantidade), regime: s(x.regime), clausula: s(x.clausula) } : null)),
    equipe_total: n(r.equipe_total),
    acoes_objeto: list(r.acoes_objeto, x => (s(x.acao) ? { acao: s(x.acao)!, frequencia: s(x.frequencia), clausula: s(x.clausula) } : null)),
    sla: list(r.sla, x => (s(x.indicador) ? { indicador: s(x.indicador)!, meta: s(x.meta), prazo: s(x.prazo), penalidade: s(x.penalidade), clausula: s(x.clausula) } : null)),
    prazos: list(r.prazos, x => (s(x.descricao) ? { descricao: s(x.descricao)!, prazo: s(x.prazo) ?? '—', clausula: s(x.clausula) } : null)),
    rescisao: { hipoteses: strs(res.hipoteses), aviso_dias: n(res.aviso_dias), multa: s(res.multa), clausula: s(res.clausula), trecho: s(res.trecho) },
    multas: list(r.multas, x => (s(x.situacao) ? { situacao: s(x.situacao)!, penalidade: s(x.penalidade) ?? '—', clausula: s(x.clausula) } : null)),
    caminhos_renovacao: list(r.caminhos_renovacao, x => (s(x.caminho) ? { caminho: s(x.caminho)!, quando: s(x.quando) ?? '', requisitos: s(x.requisitos) ?? '', clausula: s(x.clausula) } : null)),
    infraestrutura: list(r.infraestrutura, x => (s(x.item) ? {
      item: s(x.item)!, responsavel: x.responsavel === 'contratada' || x.responsavel === 'contratante' ? x.responsavel : 'nao_claro',
      detalhe: s(x.detalhe), clausula: s(x.clausula) } : null)),
    servicos: list(r.servicos, x => (s(x.servico) ? { servico: s(x.servico)!, previsto: sn(x.previsto), detalhe: s(x.detalhe), periodicidade: s(x.periodicidade), clausula: s(x.clausula) } : null)),
    normativas: list(r.normativas, x => (s(x.norma) ? { norma: s(x.norma)!, exigencia: s(x.exigencia), clausula: s(x.clausula) } : null)),
    alteracoes_aditivos: list(r.alteracoes_aditivos, x => (s(x.alteracao) ? { documento: s(x.documento) ?? 'Aditivo', alteracao: s(x.alteracao)!, clausula: s(x.clausula) } : null)),
    nao_claros: list(r.nao_claros, x => (s(x.ponto) ? { ponto: s(x.ponto)!, por_que: s(x.por_que), sugestao: s(x.sugestao), clausula: s(x.clausula) } : null)),
    obrigacoes_relevantes: strs(r.obrigacoes_relevantes),
    riscos: strs(r.riscos),
    avisos: strs(r.avisos),
    proximos_passos: list(r.proximos_passos, x => {
      const acao = s(x.acao)
      if (!acao) return null
      const area = AREAS.includes(x.area as typeof AREAS[number]) ? (x.area as ReadingStep['area']) : 'comercial'
      const prazo = s(x.prazo)
      return { acao, prazo: prazo && isoOk(prazo) ? prazo : null, area, motivo: s(x.motivo) ?? '', clausula: s(x.clausula) }
    }),
  }
}

const isoOk = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
const addDaysIso = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
const br = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '—')
const brl = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function checkReading(r: ContractReading, crm: { valid_from?: string | null; valid_until: string | null; monthly_value: number | null }): ReadingChecks {
  const fimLido = isoOk(r.vigencia?.fim) ? r.vigencia.fim : null
  const fim = fimLido ?? (crm.valid_until ? crm.valid_until.slice(0, 10) : null)
  const diasAteFim = fim ? daysUntilBR(fim) : null
  const avisoDias = r.aviso_previo?.dias ?? null
  const prazoAvisoPrevio = fim && avisoDias ? addDaysIso(fim, -avisoDias) : null
  const divergencias: string[] = []
  if (fimLido && crm.valid_until && fimLido !== crm.valid_until.slice(0, 10)) {
    divergencias.push(`Fim da vigência no contrato (${br(fimLido)}) diferente do CRM (${br(crm.valid_until.slice(0, 10))}).`)
  }
  if (isoOk(r.vigencia?.inicio) && crm.valid_from && r.vigencia.inicio !== crm.valid_from.slice(0, 10)) {
    divergencias.push(`Início da vigência no contrato (${br(r.vigencia.inicio)}) diferente do CRM (${br(crm.valid_from.slice(0, 10))}).`)
  }
  if (r.valor?.mensal && crm.monthly_value && Math.abs(r.valor.mensal - Number(crm.monthly_value)) > 0.01) {
    divergencias.push(`Valor mensal no contrato (${brl(r.valor.mensal)}) diferente do CRM (${brl(Number(crm.monthly_value))}).`)
  }
  return { fimContrato: fim, diasAteFim, prazoAvisoPrevio, diasAtePrazoAviso: prazoAvisoPrevio ? daysUntilBR(prazoAvisoPrevio) : null, divergencias }
}

export type ReaderDoc = { name: string; kind: 'contrato' | 'aditivo'; base64: string }

export async function readContractPdf(opts: {
  apiKey: string
  docs: ReaderDoc[]
  crm: { client_name: string; process_number: string | null; valid_from: string | null; valid_until: string | null; monthly_value: number | null; company: string }
}): Promise<{ reading: ContractReading; tokensIn: number; tokensOut: number; model: string }> {
  const client = new Anthropic({ apiKey: opts.apiKey })
  const today = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10)
  let nAd = 0
  const labels = opts.docs.map(d => (d.kind === 'contrato' ? `CONTRATO — ${d.name}` : `ADITIVO ${++nAd} — ${d.name}`))
  const hasAditivo = nAd > 0
  const common =
    `Você é o Farmer, agente que cuida da carteira de contratos da ${opts.crm.company}. ` +
    `Documentos anexos, nesta ordem: ${labels.map((l, i) => `${i + 1}) ${l}`).join('; ')}. ` +
    `Leia por inteiro, incluindo anexos e termo de referência, e responda SOMENTE com um JSON no modelo abaixo (sem texto antes ou depois, sem markdown). ` +
    `Onde o modelo diz <texto: ...> ou <número: ...>, troque pelo valor; nos campos "sim | nao | nao_encontrado" e nas opções, use exatamente uma delas.\n\n` +
    `Regras:\n` +
    `- Use SOMENTE o que está nos documentos. Nunca invente nem complete com o que é "comum" em contratos.\n` +
    (hasAditivo
      ? `- Os aditivos alteram o contrato: registre o que VALE HOJE (ex.: vigência prorrogada pelo último aditivo, valor reajustado) e, na cláusula, ` +
        `diga de qual documento veio (ex.: "Aditivo 2, Cláusula 1ª"; "Contrato, Cláusula 5.2").\n`
      : `- Cite a cláusula de cada item (ex.: "Cláusula 5.2").\n`) +
    `- Quando a informação não estiver nos documentos: texto "", número 0, sim/não "nao_encontrado", lista vazia [].\n` +
    `- Seja objetivo: textos de até 25 palavras; trecho literal de até 30 palavras; no máximo 12 itens por lista (agrupe itens parecidos).\n` +
    `- Datas no formato YYYY-MM-DD. Hoje é ${today}. Não calcule datas que os documentos não trazem.\n` +
    `- Escreva em português do Brasil.\n`
  const specific: Record<Part, string> = {
    renovacao:
      `- Reajuste x repactuação x reequilíbrio são coisas diferentes: reajuste = índice (IPCA, IGP-M…); repactuação = revisão por custos de mão de obra ` +
      `(convenção coletiva); reequilíbrio = revisão econômico-financeira por fato imprevisível. Marque cada um só se o contrato prever.\n` +
      `- Caminhos de renovação: as opções que o contrato permite (ex.: prorrogação por aditivo dentro do limite, renovação automática, ` +
      `renegociação com reajuste); se o limite de prorrogação estiver perto ou esgotado (conte as prorrogações já feitas pelos aditivos), diga que será preciso nova contratação.\n` +
      `- Próximos passos (até 8): ações concretas para conduzir a RENOVAÇÃO (manifestar interesse dentro do aviso prévio, calcular o reajuste pelo índice, ` +
      `preparar proposta/aditivo, reunir relatórios e comprovações de SLA), com prazo coerente com o aviso prévio e o fim da vigência.\n\n` +
      `Dados no CRM (só para comparação; se os documentos disserem outra coisa, registre o que está neles): cliente ${opts.crm.client_name}` +
      `${opts.crm.process_number ? `, nº ${opts.crm.process_number}` : ''}, início ${opts.crm.valid_from ?? 'não informado'}, ` +
      `fim ${opts.crm.valid_until ?? 'não informado'}, valor mensal ${opts.crm.monthly_value ?? 'não informado'}.\n`,
    execucao:
      `- Equipe: cargos/funções exigidos, com quantidade e regime. Quantitativos: itens, equipamentos, postos ou horas contratados.\n` +
      `- SLA: indicadores, metas e prazos de atendimento/solução e a penalidade de cada um, se houver.\n`,
    escopo:
      `- Aditivos: o que cada aditivo mudou (prazo, valor, escopo, equipe). Sem aditivo: [].\n` +
      `- Infraestrutura: tudo o que é preciso ter para executar o contrato (celular, tablet, notebook, veículo/deslocamento, hospedagem, ` +
      `ferramentas, instrumentos e padrões, software, EPI, uniforme, sala, internet…) e quem fornece; se não estiver claro, use "nao_claro".\n` +
      `- Serviços: inclua SEMPRE estes, marcando previsto sim/nao/nao_encontrado: manutenção corretiva, manutenção preventiva, calibração, ` +
      `teste de segurança elétrica, qualificação, gestão (do parque/serviço). Depois acrescente outros serviços previstos.\n` +
      `- Normativas: normas, leis e resoluções citadas que a contratada precisa cumprir.\n` +
      `- Não claros: pontos ambíguos, contraditórios ou ausentes que afetam execução, custo ou renovação, com o que esclarecer com o cliente.\n`,
  }

  // Os documentos vêm primeiro e iguais nas três partes; o último leva
  // cache_control, então a 1ª parte grava o cache e as outras leem dele
  // (leitura de cache custa uma fração da entrada normal).
  const docBlocks: Anthropic.DocumentBlockParam[] = opts.docs.map((d, i) => ({
    type: 'document',
    source: { type: 'base64', media_type: 'application/pdf', data: d.base64 },
    title: labels[i],
    ...(i === opts.docs.length - 1 ? { cache_control: { type: 'ephemeral' as const } } : {}),
  }))
  const params = (part: Part): Anthropic.MessageCreateParamsNonStreaming => ({
    model: CONTRACT_READER_MODEL,
    max_tokens: 12000,
    messages: [{
      role: 'user',
      content: [...docBlocks, { type: 'text', text: `${common}${specific[part]}\nModelo do JSON:\n${TEMPLATES[part]}` }],
    }],
  })
  const reqOpts = { timeout: 105_000, maxRetries: 0 }

  function parse(part: Part, res: Anthropic.Message) {
    const u = res.usage
    console.log(`[leitura-contrato] parte ${part}: ${res.stop_reason} · entrada ${u.input_tokens} + cache gravado ${u.cache_creation_input_tokens ?? 0} + cache lido ${u.cache_read_input_tokens ?? 0} · saída ${u.output_tokens} · blocos ${res.content.map(b => b.type).join(',')}`)
    if (res.stop_reason === 'max_tokens') throw new Error('resposta longa demais (cortada)')
    if (res.stop_reason === 'refusal') throw new Error('a IA recusou a leitura')
    const text = res.content.filter(b => b.type === 'text').map(b => (b as Anthropic.TextBlock).text).join('')
    let parsed: unknown
    try { parsed = extractJson(text) } catch { throw new Error('resposta fora do formato esperado') }
    const tokensIn = u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
    return { parsed: parsed as Record<string, unknown>, tokensIn, tokensOut: u.output_tokens }
  }

  // 1ª parte em streaming: quando a resposta começa, o cache já existe e as outras saem.
  const first = client.messages.stream(params('renovacao'), reqOpts)
  const begun = new Promise<void>(resolve => {
    first.on('streamEvent', () => resolve())
    first.on('error', () => resolve())
    first.on('end', () => resolve())
    setTimeout(resolve, 30_000)
  })
  const firstResult = first.finalMessage().then(m => parse('renovacao', m))
  firstResult.catch(() => {})
  await begun
  const rest = (['execucao', 'escopo'] as const).map(part => client.messages.create(params(part), reqOpts).then(m => parse(part, m)))

  const parts: Part[] = ['renovacao', 'execucao', 'escopo']
  const results = await Promise.allSettled([firstResult, ...rest])
  const merged: Record<string, unknown> = { versao: 3 }
  const avisos: string[] = []
  let tokensIn = 0, tokensOut = 0
  results.forEach((r, i) => {
    const part = parts[i]
    if (r.status === 'fulfilled') {
      for (const k of PART_KEYS[part]) merged[k] = r.value.parsed[k]
      tokensIn += r.value.tokensIn; tokensOut += r.value.tokensOut
    } else {
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason)
      avisos.push(`Não foi possível ler ${PART_LABEL[part]} (${msg}). Clique em "Ler de novo".`)
    }
  })
  if (avisos.length === parts.length) {
    const firstErr = results[0] as PromiseRejectedResult
    throw new Error(firstErr.reason instanceof Error ? firstErr.reason.message : String(firstErr.reason))
  }
  merged.avisos = avisos
  return { reading: normalizeReading(merged), tokensIn, tokensOut, model: CONTRACT_READER_MODEL }
}
