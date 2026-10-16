// ─── Farmer: leitura do contrato (PDF) e próximos passos da renovação ────────
// O PDF vai para o Claude com a chave da Anthropic da empresa. A resposta vem
// em JSON validado por schema (structured outputs — `output_config.format`),
// citando cláusula e trecho. Datas-chave (prazo do aviso prévio, dias até o
// fim) são RECALCULADAS pelo CRM a partir do que foi lido — a IA não faz conta
// de datas.
//
// No schema todos os campos são obrigatórios (limite da API para campos
// opcionais/nulos). O que não está no contrato vem como "" (texto), 0 (número)
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
  proximos_passos: ReadingStep[]
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

// ─── Normalização ("" / 0 / nao_encontrado → null) ───────────────────────────
const s = (v: unknown): string | null => (typeof v === 'string' && v.trim() && !/^n[ãa]o (encontrad|consta)/i.test(v.trim()) ? v.trim() : null)
const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null)
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
    obrigacoes_relevantes: strs(r.obrigacoes_relevantes),
    riscos: strs(r.riscos),
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

export async function readContractPdf(opts: {
  apiKey: string
  pdfBase64: string
  fileName: string
  crm: { client_name: string; process_number: string | null; valid_from: string | null; valid_until: string | null; monthly_value: number | null; company: string }
}): Promise<{ reading: ContractReading; tokensIn: number; tokensOut: number; model: string }> {
  const client = new Anthropic({ apiKey: opts.apiKey })
  const today = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10)
  const prompt =
    `Você é o Farmer, agente que cuida da carteira de contratos da ${opts.crm.company}. Leia o contrato anexo (${opts.fileName}) ` +
    `por inteiro, incluindo anexos e termo de referência, e preencha o JSON pedido.\n\n` +
    `Regras:\n` +
    `- Use SOMENTE o que está no documento. Nunca invente nem complete com o que é "comum" em contratos.\n` +
    `- Quando a informação não estiver no documento: texto "" , número 0, sim/não "nao_encontrado", lista vazia [].\n` +
    `- Para cada item, cite a cláusula (ex.: "Cláusula 5.2") e, onde pedido, um trecho literal curto.\n` +
    `- Datas no formato YYYY-MM-DD. Hoje é ${today}. Não calcule datas que o contrato não traz.\n` +
    `- Reajuste x repactuação x reequilíbrio são coisas diferentes: reajuste = índice (IPCA, IGP-M…); repactuação = revisão por custos de mão de obra ` +
    `(convenção coletiva); reequilíbrio = revisão econômico-financeira por fato imprevisível. Marque cada um só se o contrato prever.\n` +
    `- Caminhos de renovação: liste as opções que o contrato permite (ex.: prorrogação por aditivo dentro do limite, renovação automática, ` +
    `renegociação com reajuste) e, se o limite de prorrogação já estiver perto ou esgotado, diga que será preciso nova contratação.\n` +
    `- Próximos passos: ações concretas para conduzir a RENOVAÇÃO (manifestar interesse dentro do aviso prévio, calcular o reajuste pelo índice, ` +
    `preparar proposta/aditivo, reunir relatórios e comprovações de SLA), com prazo coerente com o aviso prévio e o fim da vigência.\n` +
    `- Escreva em português do Brasil, frases curtas.\n\n` +
    `Dados no CRM (só para comparação; se o contrato disser outra coisa, registre o que está no contrato): cliente ${opts.crm.client_name}` +
    `${opts.crm.process_number ? `, nº ${opts.crm.process_number}` : ''}, início ${opts.crm.valid_from ?? 'não informado'}, ` +
    `fim ${opts.crm.valid_until ?? 'não informado'}, valor mensal ${opts.crm.monthly_value ?? 'não informado'}.`

  const res = await client.messages.create({
    model: CONTRACT_READER_MODEL,
    max_tokens: 12000,
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: opts.pdfBase64 } },
        { type: 'text', text: prompt },
      ],
    }],
  })
  if (res.stop_reason === 'max_tokens') throw new Error('A resposta da IA ficou grande demais e foi cortada. Tente de novo; se repetir, envie só o contrato (sem anexos extensos).')
  if (res.stop_reason === 'refusal') throw new Error('A IA recusou a leitura deste documento.')
  const text = res.content.filter(b => b.type === 'text').map(b => (b as Anthropic.TextBlock).text).join('')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('A IA não devolveu a leitura no formato esperado. Tente de novo.')
  }
  return { reading: normalizeReading(parsed), tokensIn: res.usage.input_tokens, tokensOut: res.usage.output_tokens, model: CONTRACT_READER_MODEL }
}
