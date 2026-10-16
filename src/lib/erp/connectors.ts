// ─── Conector de faturamento (ERP) por empresa ───────────────────────────────
// O CRM registra cada "envio para faturamento" (billing_submissions) e entrega
// ao ERP da empresa por um conector. Hoje:
//   - manual: o envio fica registrado no CRM; o financeiro fatura no ERP e o
//     "faturado" volta por lançamento manual ou pelo endereço de retorno.
//   - sankhya / totvs: PREPARADOS, ainda não implementados. Os endpoints e
//     campos dependem da documentação/credenciais da empresa — nada inventado.
// Configuração: organization_settings.billing_erp (jsonb) da empresa.

export type ErpProvider = 'manual' | 'sankhya' | 'totvs'

export type ErpConfig = {
  provider: ErpProvider
  flow_start?: string | null        // 'YYYY-MM': início do fluxo novo
  webhook_secret?: string | null    // chave do endereço de retorno (faturado)
}

export const ERP_LABEL: Record<ErpProvider, string> = { manual: 'Manual (registro no CRM)', sankhya: 'Sankhya', totvs: 'TOTVS' }

export function readErpConfig(raw: unknown): ErpConfig {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const p = o.provider === 'sankhya' || o.provider === 'totvs' ? o.provider : 'manual'
  return {
    provider: p,
    flow_start: typeof o.flow_start === 'string' ? o.flow_start : null,
    webhook_secret: typeof o.webhook_secret === 'string' ? o.webhook_secret : null,
  }
}

// O que vai para o ERP em cada envio (mesmo formato para qualquer conector)
export type BillingItem = {
  submissionId: string
  sourceType: 'recorrente' | 'medicao' | 'avulso'
  year: number
  month: number
  amount: number
  description: string
  contract: { id: string; client_name: string | null; process_number: string | null; cnpj: string | null }
}

export type ErpSendResult = { reference: string | null; payload: unknown }

export interface ErpConnector {
  provider: ErpProvider
  send(item: BillingItem, config: ErpConfig): Promise<ErpSendResult>
}

const manual: ErpConnector = {
  provider: 'manual',
  async send(item) {
    // Nada sai do CRM: o envio fica na fila do Financeiro para faturar no ERP.
    return { reference: null, payload: { modo: 'manual', ...item } }
  },
}

function notReady(provider: ErpProvider): ErpConnector {
  return {
    provider,
    async send() {
      throw new Error(`Integração com ${ERP_LABEL[provider]} ainda não está ligada. Use o modo Manual até a integração ser configurada.`)
    },
  }
}

export function getConnector(provider: ErpProvider): ErpConnector {
  if (provider === 'manual') return manual
  return notReady(provider)
}
