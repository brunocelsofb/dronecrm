// ─── Conector de faturamento (ERP) por empresa ───────────────────────────────
// O CRM registra cada "envio para faturamento" (billing_submissions) e entrega
// ao sistema de faturamento da empresa por um conector:
//   - manual:  o envio fica registrado no CRM; o financeiro fatura no ERP e o
//              "faturado" volta por lançamento manual ou pelo endereço de retorno.
//   - webhook: o CRM manda um aviso (POST JSON assinado) para o endereço que a
//              empresa informar — serve para Sankhya, TOTVS ou qualquer sistema
//              /integração que receba webhook. Identificação do cliente: CNPJ.
//              O faturado volta pelo endereço de retorno (/api/faturamento/retorno).
// Configuração: organization_settings.billing_erp (jsonb) da empresa.

import { createHmac } from 'node:crypto'

export type ErpProvider = 'manual' | 'webhook'

export type ErpConfig = {
  provider: ErpProvider
  flow_start?: string | null        // 'YYYY-MM': início do fluxo novo
  webhook_secret?: string | null    // chave do endereço de RETORNO (faturado)
  out_url?: string | null           // endereço que recebe os ENVIOS (webhook)
  out_secret?: string | null        // chave para assinar os envios (HMAC SHA-256)
}

export const ERP_LABEL: Record<ErpProvider, string> = { manual: 'Manual (registro no CRM)', webhook: 'Webhook (Sankhya, TOTVS ou outro)' }

export function readErpConfig(raw: unknown): ErpConfig {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  return {
    provider: o.provider === 'webhook' ? 'webhook' : 'manual',
    flow_start: s(o.flow_start),
    webhook_secret: s(o.webhook_secret),
    out_url: s(o.out_url),
    out_secret: s(o.out_secret),
  }
}

// Endereço de destino aceitável: https e não interno (evita o servidor do CRM
// ser usado para chamar redes privadas).
export function isAllowedOutUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:') return false
    const h = u.hostname.toLowerCase()
    if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return false
    if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h === '[::1]') return false
    return true
  } catch {
    return false
  }
}

// O que vai para o faturamento em cada envio (mesmo formato para qualquer conector)
export type BillingItem = {
  submissionId: string
  sourceType: 'recorrente' | 'medicao' | 'avulso'
  year: number
  month: number
  amount: number
  description: string
  contract: { id: string; client_name: string | null; process_number: string | null; contract_number: string | null; cnpj: string | null; razao_social: string | null; nome_fantasia: string | null; cnpj_emitente: string | null }
}

export type ErpSendResult = { reference: string | null; payload: unknown }

export interface ErpConnector {
  provider: ErpProvider
  send(item: BillingItem, config: ErpConfig, ctx: { returnUrl: string | null }): Promise<ErpSendResult>
}

const digits = (v: string | null) => (v ?? '').replace(/\D/g, '')

// Corpo do aviso (contrato estável — documentado na tela Financeiro → Integração)
export function buildWebhookPayload(item: BillingItem, ctx: { returnUrl: string | null }) {
  return {
    evento: 'faturamento.envio',
    envio_id: item.submissionId,
    cliente: {
      cnpj: digits(item.contract.cnpj),
      razao_social: item.contract.razao_social ?? item.contract.client_name,
      nome_fantasia: item.contract.nome_fantasia,
    },
    cnpj_emitente: digits(item.contract.cnpj_emitente) || null,
    tipo: item.sourceType,                                              // recorrente | medicao | avulso
    competencia: `${item.year}-${String(item.month).padStart(2, '0')}`,  // AAAA-MM
    valor: Math.round(item.amount * 100) / 100,
    descricao: item.description,
    contrato: { id: item.contract.id, numero: item.contract.contract_number ?? item.contract.process_number },
    retorno: ctx.returnUrl ? { url: ctx.returnUrl, campos: ['envio_id', 'numero_nota', 'data_faturamento', 'valor_faturado'] } : null,
    enviado_em: new Date().toISOString(),
  }
}

export async function postSignedWebhook(url: string, secret: string | null, body: unknown, event: string): Promise<{ status: number; text: string }> {
  const raw = JSON.stringify(body)
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-CRM-Evento': event }
  if (secret) headers['X-CRM-Assinatura'] = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 15_000)
  try {
    const res = await fetch(url, { method: 'POST', headers, body: raw, signal: ctrl.signal, cache: 'no-store' })
    return { status: res.status, text: (await res.text()).slice(0, 2000) }
  } finally {
    clearTimeout(timer)
  }
}

const manual: ErpConnector = {
  provider: 'manual',
  async send(item) {
    // Nada sai do CRM: o envio fica na fila do Financeiro para faturar no ERP.
    return { reference: null, payload: { modo: 'manual', ...item } }
  },
}

const webhook: ErpConnector = {
  provider: 'webhook',
  async send(item, config, ctx) {
    if (!config.out_url || !isAllowedOutUrl(config.out_url)) throw new Error('Endereço do webhook de faturamento não configurado (Financeiro → Integração).')
    if (digits(item.contract.cnpj).length !== 14) throw new Error('Cliente sem CNPJ válido: cadastre o CNPJ na empresa do contrato.')
    const payload = buildWebhookPayload(item, ctx)
    let r: { status: number; text: string }
    try {
      r = await postSignedWebhook(config.out_url, config.out_secret ?? null, payload, 'faturamento.envio')
    } catch (e) {
      throw new Error(`o endereço de faturamento não respondeu (${e instanceof Error && e.name === 'AbortError' ? 'tempo esgotado' : 'falha de conexão'})`)
    }
    if (r.status < 200 || r.status >= 300) throw new Error(`o endereço de faturamento respondeu ${r.status}${r.text ? `: ${r.text.slice(0, 200)}` : ''}`)
    // Se o sistema devolver um identificador, guarda para casar o retorno
    let reference: string | null = null
    try {
      const j = JSON.parse(r.text) as Record<string, unknown>
      const ref = j.referencia ?? j.reference ?? j.id
      if (typeof ref === 'string' || typeof ref === 'number') reference = String(ref)
    } catch { /* resposta sem JSON: ok */ }
    return { reference, payload }
  },
}

export function getConnector(provider: ErpProvider): ErpConnector {
  return provider === 'webhook' ? webhook : manual
}
