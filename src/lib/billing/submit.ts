// Núcleo do envio para faturamento (sem checagem de permissão — quem chama
// confere). Fica FORA de arquivo 'use server' para não virar ação chamável
// pelo navegador. Usado pela tela Financeiro e pelo ganho do Avulso.

import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { getConnector, readErpConfig, type BillingItem } from '@/lib/erp/connectors'
import { brl, MONTHS_LONG } from '@/lib/revenue/measurement'

export type SubmitInput = { contractId: string; sourceType: 'recorrente' | 'medicao' | 'avulso'; year: number; month: number }
type Db = Awaited<ReturnType<typeof createScopedAdmin>>

const BR_OFFSET_MS = 3 * 3600 * 1000
export const brMonthOf = (iso: string) => { const d = new Date(Date.parse(iso) - BR_OFFSET_MS); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 } }

export async function submitToBilling(db: Db, userId: string | null, input: SubmitInput, returnUrl: string | null = null): Promise<{ ok: true } | { ok: false; error: string }> {
  const { contractId, sourceType, year, month } = input
  const [{ data: contract }, { data: org }] = await Promise.all([
    db.from('contracts').select('id, client_name, process_number, contract_number, cnpj_billing, companies(cnpj, name, trade_name)').eq('id', contractId).maybeSingle(),
    db.from('organization_settings').select('billing_erp').limit(1).maybeSingle(),
  ])
  if (!contract) return { ok: false, error: 'Contrato não encontrado.' }

  // Valor apurado no CRM (nunca vem do navegador)
  let amount = 0
  let billingRecordId: string | null = null
  let runId: string | null = null
  if (sourceType === 'avulso') {
    const { data: avulsoPipes } = await db.from('pipelines').select('id').eq('type', 'servico_avulso')
    const ids = (avulsoPipes ?? []).map(p => p.id)
    const { data: runs } = ids.length
      ? await db.from('pipeline_runs').select('id, value, ended_at, status').eq('contract_id', contractId).eq('status', 'won').in('pipeline_id', ids)
      : { data: [] as { id: string; value: number | null; ended_at: string | null; status: string }[] }
    const run = (runs ?? []).find(r => r.ended_at && brMonthOf(r.ended_at).y === year && brMonthOf(r.ended_at).m === month)
    if (!run) return { ok: false, error: 'Não há avulso ganho neste mês para este cliente.' }
    amount = Number(run.value) || 0
    runId = run.id
  } else {
    const { data: rec } = await db.from('billing_records').select('id, amount, status')
      .eq('contract_id', contractId).eq('year', year).eq('month', month).maybeSingle()
    if (!rec) return { ok: false, error: sourceType === 'recorrente' ? 'Confirme a recorrência do mês antes de enviar.' : 'Lance a medição do mês antes de enviar.' }
    if (rec.status !== 'validado') return { ok: false, error: 'A medição ainda não está validada (falta relatório ou aprovação do Admin).' }
    amount = Number(rec.amount) || 0
    billingRecordId = rec.id
  }
  if (amount <= 0) return { ok: false, error: 'Valor apurado zerado: nada a enviar.' }

  const config = readErpConfig(org?.billing_erp)
  const company = (contract as { companies?: { cnpj?: string | null; name?: string | null; trade_name?: string | null } | null }).companies
  // Envio por webhook identifica o cliente pelo CNPJ: confere antes de registrar
  if (config.provider === 'webhook' && (company?.cnpj ?? '').replace(/\D/g, '').length !== 14) {
    return { ok: false, error: `${contract.client_name ?? 'Cliente'} sem CNPJ válido: ligue o contrato a uma empresa com CNPJ antes de enviar.` }
  }
  const { data: sub, error: insErr } = await db.from('billing_submissions').insert({
    contract_id: contractId, source_type: sourceType, billing_record_id: billingRecordId, run_id: runId,
    year, month, amount_sent: amount, status: 'enviado', erp_provider: config.provider, sent_by: userId,
  }).select('id').single()
  if (insErr || !sub) {
    if (insErr?.code === '23505') return { ok: false, error: 'Este valor já foi enviado para faturamento neste mês.' }
    return { ok: false, error: insErr?.message ?? 'Falha ao registrar o envio.' }
  }

  const ref = `${MONTHS_LONG[month - 1]}/${year}`
  const item: BillingItem = {
    submissionId: sub.id, sourceType, year, month, amount,
    description: `${sourceType === 'recorrente' ? 'Recorrência' : sourceType === 'medicao' ? 'Medição' : 'Serviço avulso'} ${ref} — ${contract.client_name ?? ''}`,
    contract: {
      id: contract.id, client_name: contract.client_name, process_number: contract.process_number, contract_number: contract.contract_number ?? null,
      cnpj: company?.cnpj ?? null, razao_social: company?.name ?? null, nome_fantasia: company?.trade_name ?? null, cnpj_emitente: contract.cnpj_billing ?? null,
    },
  }
  try {
    const r = await getConnector(config.provider).send(item, config, { returnUrl })
    await db.from('billing_submissions').update({ erp_reference: r.reference, erp_payload: r.payload as object }).eq('id', sub.id)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await db.from('billing_submissions').update({ status: 'erro', erp_error: msg.slice(0, 500) }).eq('id', sub.id)
    return { ok: false, error: `Envio não concluído: ${msg}` }
  }

  await db.from('activities').insert({
    contract_id: contractId, user_id: userId, type: 'system',
    content: `🧾 Enviado para faturamento: ${item.description.split(' — ')[0]} — ${brl(amount)}.`,
    metadata: { kind: 'billing_submission', submission_id: sub.id, year, month, source_type: sourceType },
  })
  return { ok: true }
}
