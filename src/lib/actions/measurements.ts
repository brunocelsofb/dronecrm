'use server'

// Medição mensal de contratos "por medição":
//   - valor medido (bruto) − glosa = líquido (entra na receita)
//   - com relatório anexado → validado
//   - sem relatório → aguardando aprovação do admin (só então entra na receita)
// Recorrente não usa isto: o consultor confirma o mês (saveRecurringDiscount).

import { fmtPct, fmtNum1 } from '@/lib/format'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { measurementLoss, brl, MONTHS_LONG, round2 } from '@/lib/revenue/measurement'

export type MeasurementResult = { ok: true; status: 'validado' | 'aguardando_aprovacao' } | { ok: false; error: string }

export type MeasurementInput = {
  contractId: string
  year: number
  month: number
  measured: number
  glosa: number
  glosaReason?: string | null
  notes?: string | null
  filePath?: string | null
  fileName?: string | null
}

export async function saveMeasurement(input: MeasurementInput): Promise<MeasurementResult> {
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) return { ok: false, error: 'Usuário não autenticado.' }

  const { contractId, year, month } = input
  const measured = Number(input.measured)
  const glosa = Number(input.glosa || 0)
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return { ok: false, error: 'Ano inválido.' }
  if (!Number.isInteger(month) || month < 1 || month > 12) return { ok: false, error: 'Mês inválido.' }
  if (!Number.isFinite(measured) || measured < 0) return { ok: false, error: 'Informe o valor medido.' }
  if (!Number.isFinite(glosa) || glosa < 0) return { ok: false, error: 'Glosa inválida.' }
  if (glosa > measured) return { ok: false, error: 'A glosa não pode ser maior que o valor medido.' }
  if (glosa > 0 && !input.glosaReason?.trim()) return { ok: false, error: 'Informe o motivo da glosa.' }

  const admin = await createScopedAdmin()
  const { data: contract } = await admin.from('contracts').select('id, monthly_value, billing_type').eq('id', contractId).maybeSingle()
  if (!contract) return { ok: false, error: 'Contrato não encontrado.' }
  if (contract.billing_type !== 'metered') return { ok: false, error: 'Este contrato é recorrente: confirme o valor do mês (com ou sem desconto) na aba Faturamento.' }

  const { data: existing } = await admin.from('billing_records')
    .select('id, file_storage_path, file_name')
    .eq('contract_id', contractId).eq('year', year).eq('month', month).maybeSingle()

  // Sem novo arquivo, mantém o relatório que já estava anexado
  const filePath = input.filePath ?? existing?.file_storage_path ?? null
  const fileName = input.fileName ?? existing?.file_name ?? null
  const status = filePath ? 'validado' : 'aguardando_aprovacao'

  const contractValue = Number(contract.monthly_value) || 0
  const { net, lost, lostPct } = measurementLoss(contractValue, measured, glosa)
  const now = new Date().toISOString()

  const { error } = await admin.from('billing_records').upsert({
    contract_id: contractId,
    year,
    month,
    measured_amount: round2(measured),
    glosa_amount: round2(glosa),
    glosa_reason: glosa > 0 ? input.glosaReason!.trim() : null,
    discount_amount: 0,
    discount_reason: null,
    amount: net,
    contract_value: contractValue,
    notes: input.notes?.trim() || null,
    file_storage_path: filePath,
    file_name: fileName,
    status,
    approved_by: null,
    approved_at: null,
    confirmed_by: user.id,
    confirmed_at: now,
  }, { onConflict: 'contract_id,year,month' })
  if (error) return { ok: false, error: error.message }

  const ref = `${MONTHS_LONG[month - 1]}/${year}`
  const lossText = lost > 0 ? ` Perdemos ${brl(lost)}${lostPct !== null ? ` (${fmtPct(lostPct)})` : ''} do potencial de ${brl(contractValue)}.` : ''
  await admin.from('activities').insert({
    contract_id: contractId,
    user_id: user.id,
    type: 'system',
    content: `📏 Medição de ${ref}: medido ${brl(measured)}${glosa > 0 ? `, glosa ${brl(glosa)}` : ''}, líquido ${brl(net)}.${lossText}${status === 'validado' ? ` Relatório: ${fileName}.` : ' Sem relatório — aguardando aprovação do administrador.'}`,
    metadata: { kind: 'measurement', year, month, status },
  })

  revalidatePath(`/contracts/${contractId}`)
  revalidatePath('/pipeline')
  revalidatePath('/painel')
  return { ok: true, status }
}

export async function approveMeasurement(recordId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Usuário não autenticado.' }
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') return { ok: false, error: 'Só o administrador aprova medição sem relatório.' }

  const admin = await createScopedAdmin()
  const { data: rec } = await admin.from('billing_records').select('id, contract_id, year, month, amount, status').eq('id', recordId).maybeSingle()
  if (!rec) return { ok: false, error: 'Medição não encontrada.' }
  if (rec.status === 'validado') return { ok: true }

  const now = new Date().toISOString()
  const { error } = await admin.from('billing_records')
    .update({ status: 'validado', approved_by: user.id, approved_at: now })
    .eq('id', recordId)
  if (error) return { ok: false, error: error.message }

  await admin.from('activities').insert({
    contract_id: rec.contract_id,
    user_id: user.id,
    type: 'system',
    content: `✅ Medição de ${MONTHS_LONG[rec.month - 1]}/${rec.year} (${brl(Number(rec.amount))}) aprovada pelo administrador sem relatório.`,
    metadata: { kind: 'measurement_approved', year: rec.year, month: rec.month },
  })

  revalidatePath(`/contracts/${rec.contract_id}`)
  revalidatePath('/pipeline')
  revalidatePath('/painel')
  return { ok: true }
}

// ─── Contrato recorrente: desconto/ajuste do mês ─────────────────────────────
// O recorrente fatura o valor do contrato todo mês; quando algo acontece
// (desconto, abatimento), registra-se o desconto do mês com o motivo.
// Faturado do mês = valor do contrato − desconto. Desconto 0 remove o ajuste.
export async function saveRecurringDiscount(input: {
  contractId: string
  year: number
  month: number
  discount: number
  reason?: string | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Usuário não autenticado.' }

  const { contractId, year, month } = input
  const discount = round2(Number(input.discount || 0))
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return { ok: false, error: 'Ano inválido.' }
  if (!Number.isInteger(month) || month < 1 || month > 12) return { ok: false, error: 'Mês inválido.' }
  if (!Number.isFinite(discount) || discount < 0) return { ok: false, error: 'Desconto inválido.' }
  if (discount > 0 && !input.reason?.trim()) return { ok: false, error: 'Informe o motivo do desconto.' }

  const admin = await createScopedAdmin()
  const [{ data: contract }, { data: profile }] = await Promise.all([
    admin.from('contracts').select('id, monthly_value, billing_type, owner_id').eq('id', contractId).maybeSingle(),
    supabase.from('profiles').select('role').eq('id', user.id).maybeSingle(),
  ])
  if (!contract) return { ok: false, error: 'Contrato não encontrado.' }
  if (contract.billing_type === 'metered') return { ok: false, error: 'Contrato por medição: use o lançamento de medição (com glosa).' }
  if (profile?.role !== 'admin' && contract.owner_id !== user.id) {
    return { ok: false, error: 'Só o responsável pela conta ou um administrador registra desconto.' }
  }
  const contractValue = Number(contract.monthly_value) || 0
  if (discount > contractValue) return { ok: false, error: 'O desconto não pode ser maior que o valor do contrato.' }

  const now = new Date().toISOString()
  const { error } = await admin.from('billing_records').upsert({
    contract_id: contractId,
    year,
    month,
    measured_amount: contractValue,
    glosa_amount: 0,
    glosa_reason: null,
    discount_amount: discount,
    discount_reason: discount > 0 ? input.reason!.trim() : null,
    amount: round2(contractValue - discount),
    contract_value: contractValue,
    status: 'validado',
    confirmed_by: user.id,
    confirmed_at: now,
  }, { onConflict: 'contract_id,year,month' })
  if (error) return { ok: false, error: error.message }

  const ref = `${MONTHS_LONG[month - 1]}/${year}`
  await admin.from('activities').insert({
    contract_id: contractId,
    user_id: user.id,
    type: 'system',
    content: discount > 0
      ? `💲 Recorrência de ${ref} confirmada com desconto de ${brl(discount)} (motivo: ${input.reason!.trim()}). Apurado: ${brl(contractValue - discount)} de ${brl(contractValue)}.`
      : `💲 Recorrência de ${ref} confirmada pelo valor cheio: ${brl(contractValue)}.`,
    metadata: { kind: 'recurring_discount', year, month, discount },
  })

  revalidatePath(`/contracts/${contractId}`)
  revalidatePath('/pipeline')
  revalidatePath('/painel')
  revalidatePath('/financeiro')
  return { ok: true }
}
