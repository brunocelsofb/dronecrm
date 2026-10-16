// ─── Farmer: leitura do contrato (PDF) e próximos passos da renovação ────────
// O PDF vai para o Claude com a chave da Anthropic da empresa. A resposta vem
// estruturada (ferramenta obrigatória), citando cláusula e trecho. Datas-chave
// (prazo do aviso prévio, data-base do reajuste, dias até o fim) são
// RECALCULADAS pelo CRM a partir do que foi lido — a IA não faz conta de datas.

import Anthropic from '@anthropic-ai/sdk'
import { daysUntilBR } from './renewal-templates'

export const CONTRACT_READER_MODEL = 'claude-sonnet-5-5'

export type ReadingStep = {
  acao: string
  prazo: string | null              // YYYY-MM-DD
  area: 'comercial' | 'juridico' | 'tecnico' | 'financeiro' | 'cliente'
  motivo: string
  clausula: string | null
}

export type ContractReading = {
  objeto: string | null
  contratante: string | null
  contratada: string | null
  vigencia: { inicio: string | null; fim: string | null; prazo_meses: number | null; clausula: string | null; trecho: string | null }
  renovacao: { tipo: 'automatica' | 'por_aditivo' | 'nao_prevista' | 'nao_encontrado'; regra: string | null; limite: string | null; clausula: string | null; trecho: string | null }
  aviso_previo: { dias: number | null; regra: string | null; clausula: string | null; trecho: string | null }
  reajuste: { indice: string | null; periodicidade: string | null; data_base: string | null; clausula: string | null; trecho: string | null }
  valor: { mensal: number | null; total: number | null; clausula: string | null }
  rescisao: { multa: string | null; aviso_dias: number | null; clausula: string | null }
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

const S = { type: 'string' } as const
// Campos não encontrados ficam de fora (schema simples, sem tipos nulos)
const SN = { type: 'string' } as const
const NN = { type: 'number' } as const

const TOOL: Anthropic.Tool = {
  name: 'registrar_leitura_contrato',
  description: 'Registra o que foi lido no contrato. Quando a informação não estiver no documento, OMITA o campo. Nunca invente.',
  input_schema: {
    type: 'object',
    required: ['vigencia', 'renovacao', 'aviso_previo', 'reajuste', 'valor', 'rescisao', 'obrigacoes_relevantes', 'riscos', 'proximos_passos'],
    properties: {
      objeto: { ...SN, description: 'Objeto do contrato em uma frase' },
      contratante: SN,
      contratada: SN,
      vigencia: { type: 'object', properties: {
        inicio: { ...SN, description: 'YYYY-MM-DD' }, fim: { ...SN, description: 'YYYY-MM-DD' }, prazo_meses: NN, clausula: SN, trecho: { ...SN, description: 'Trecho literal curto do contrato' } } },
      renovacao: { type: 'object', required: ['tipo'], properties: {
        tipo: { type: 'string', enum: ['automatica', 'por_aditivo', 'nao_prevista', 'nao_encontrado'] }, regra: SN, limite: { ...SN, description: 'Limite total de prorrogações/prazo máximo, se houver' }, clausula: SN, trecho: SN } },
      aviso_previo: { type: 'object', properties: {
        dias: { ...NN, description: 'Dias de antecedência exigidos para manifestar não renovação/rescisão' }, regra: SN, clausula: SN, trecho: SN } },
      reajuste: { type: 'object', properties: {
        indice: { ...SN, description: 'Ex.: IPCA, IGP-M, INPC' }, periodicidade: SN, data_base: { ...SN, description: 'YYYY-MM-DD ou descrição (ex.: aniversário do contrato)' }, clausula: SN, trecho: SN } },
      valor: { type: 'object', properties: { mensal: NN, total: NN, clausula: SN } },
      rescisao: { type: 'object', properties: { multa: SN, aviso_dias: NN, clausula: SN } },
      obrigacoes_relevantes: { type: 'array', items: S, description: 'Obrigações que impactam a renovação (SLA, relatórios, garantias, documentos)' },
      riscos: { type: 'array', items: S, description: 'Pontos de atenção para a renovação, citando a cláusula' },
      proximos_passos: { type: 'array', description: 'Ações concretas para a renovação, em ordem', items: { type: 'object', required: ['acao', 'area', 'motivo'], properties: {
        acao: S, prazo: { ...SN, description: 'YYYY-MM-DD; respeite o aviso prévio e a vigência' }, area: { type: 'string', enum: ['comercial', 'juridico', 'tecnico', 'financeiro', 'cliente'] }, motivo: S, clausula: SN } } },
    },
  },
}

const isoOk = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
const addDaysIso = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
const br = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '—')

export function checkReading(r: ContractReading, crm: { valid_until: string | null; monthly_value: number | null }): ReadingChecks {
  const fim = isoOk(r.vigencia?.fim) ? r.vigencia.fim : (crm.valid_until ? crm.valid_until.slice(0, 10) : null)
  const diasAteFim = fim ? daysUntilBR(fim) : null
  const avisoDias = typeof r.aviso_previo?.dias === 'number' && r.aviso_previo.dias > 0 ? r.aviso_previo.dias : null
  const prazoAvisoPrevio = fim && avisoDias ? addDaysIso(fim, -avisoDias) : null
  const divergencias: string[] = []
  if (isoOk(r.vigencia?.fim) && crm.valid_until && r.vigencia.fim !== crm.valid_until.slice(0, 10)) {
    divergencias.push(`Fim da vigência no contrato (${br(r.vigencia.fim)}) diferente do CRM (${br(crm.valid_until.slice(0, 10))}).`)
  }
  if (typeof r.valor?.mensal === 'number' && crm.monthly_value && Math.abs(r.valor.mensal - Number(crm.monthly_value)) > 0.01) {
    divergencias.push(`Valor mensal no contrato (R$ ${r.valor.mensal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}) diferente do CRM (R$ ${Number(crm.monthly_value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}).`)
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
    `e registre os dados com a ferramenta registrar_leitura_contrato.\n\n` +
    `Regras:\n` +
    `- Use SOMENTE o que está no documento. Se não encontrar, omita o campo — nunca invente.\n` +
    `- Para vigência, renovação, aviso prévio e reajuste, cite a cláusula (ex.: "Cláusula 5.2") e um trecho literal curto.\n` +
    `- Datas no formato YYYY-MM-DD. Hoje é ${today}.\n` +
    `- Próximos passos: ações concretas para conduzir a RENOVAÇÃO (ex.: manifestar interesse dentro do aviso prévio, calcular o reajuste pelo índice, ` +
    `preparar proposta/aditivo, reunir relatórios exigidos), com prazo coerente com o aviso prévio e o fim da vigência. Escreva em português do Brasil.\n\n` +
    `Dados no CRM (para comparação, não copie se o contrato disser outra coisa): cliente ${opts.crm.client_name}` +
    `${opts.crm.process_number ? `, nº ${opts.crm.process_number}` : ''}, início ${opts.crm.valid_from ?? 'não informado'}, ` +
    `fim ${opts.crm.valid_until ?? 'não informado'}, valor mensal ${opts.crm.monthly_value ?? 'não informado'}.`

  const res = await client.messages.create({
    model: CONTRACT_READER_MODEL,
    max_tokens: 4000,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: TOOL.name },
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: opts.pdfBase64 } },
        { type: 'text', text: prompt },
      ],
    }],
  })
  const block = res.content.find(b => b.type === 'tool_use')
  if (!block || block.type !== 'tool_use') throw new Error('A IA não devolveu a leitura estruturada.')
  return { reading: block.input as ContractReading, tokensIn: res.usage.input_tokens, tokensOut: res.usage.output_tokens, model: CONTRACT_READER_MODEL }
}
