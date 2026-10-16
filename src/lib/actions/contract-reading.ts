'use server'

// Farmer: ler o contrato (PDF dos arquivos do contrato) e transformar os
// próximos passos da renovação em atividades.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { resolveTenantId } from '@/lib/tenant/context'
import { getAnthropicKeyForTenant, NO_AI_KEY_MESSAGE } from '@/lib/ai/tenant-key'
import { readContractPdf, type ReadingStep } from '@/lib/agent/contract-reader'

const MAX_PDF_BYTES = 20 * 1024 * 1024

export async function readContractWithAI(contractId: string, fileId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) return { ok: false, error: 'Usuário não autenticado.' }

  const tenantId = await resolveTenantId({ contractId })
  const admin = await createScopedAdmin(tenantId)
  const [{ data: contract }, { data: file }, { data: org }] = await Promise.all([
    admin.from('contracts').select('id, client_name, process_number, valid_from, valid_until, monthly_value').eq('id', contractId).maybeSingle(),
    admin.from('contract_files').select('id, file_name, storage_path, mime_type, file_size').eq('id', fileId).eq('contract_id', contractId).maybeSingle(),
    admin.from('organization_settings').select('company_name').limit(1).maybeSingle(),
  ])
  if (!contract) return { ok: false, error: 'Contrato não encontrado.' }
  if (!file) return { ok: false, error: 'Arquivo não encontrado neste contrato.' }
  const isPdf = (file.mime_type ?? '').includes('pdf') || /\.pdf$/i.test(file.file_name ?? '')
  if (!isPdf) return { ok: false, error: 'A leitura funciona com arquivo PDF. Anexe o contrato em PDF na aba Arquivos.' }
  if (file.file_size && file.file_size > MAX_PDF_BYTES) return { ok: false, error: 'O PDF passa de 20 MB. Envie uma versão menor (sem imagens desnecessárias).' }

  const key = await getAnthropicKeyForTenant(tenantId)
  if (!key.key) return { ok: false, error: NO_AI_KEY_MESSAGE }

  const { data: blob, error: dlErr } = await admin.storage.from('contract-files').download(file.storage_path)
  if (dlErr || !blob) return { ok: false, error: `Não foi possível abrir o arquivo: ${dlErr?.message ?? 'sem conteúdo'}` }
  const buf = Buffer.from(await blob.arrayBuffer())
  if (buf.byteLength > MAX_PDF_BYTES) return { ok: false, error: 'O PDF passa de 20 MB.' }

  const t0 = Date.now()
  console.log(`[leitura-contrato] início · contrato ${contractId} · arquivo ${file.file_name} (${buf.byteLength} bytes) · chave ${key.source}`)
  try {
    const r = await readContractPdf({
      apiKey: key.key,
      pdfBase64: buf.toString('base64'),
      fileName: file.file_name ?? 'contrato.pdf',
      crm: {
        client_name: contract.client_name ?? '',
        process_number: contract.process_number ?? null,
        valid_from: contract.valid_from ?? null,
        valid_until: contract.valid_until ?? null,
        monthly_value: contract.monthly_value !== null ? Number(contract.monthly_value) : null,
        company: org?.company_name ?? 'empresa',
      },
    })
    console.log(`[leitura-contrato] ok em ${Date.now() - t0} ms · ${r.tokensIn}/${r.tokensOut} tokens · ${r.reading.proximos_passos?.length ?? 0} passos`)
    await admin.from('contract_ai_readings').insert({
      contract_id: contractId, file_id: file.id, file_name: file.file_name, model: r.model,
      status: 'ok', result: r.reading, tokens_in: r.tokensIn, tokens_out: r.tokensOut, created_by: user.id,
    })
    await admin.from('activities').insert({
      contract_id: contractId, user_id: user.id, type: 'system',
      content: `🌱 Farmer leu o contrato "${file.file_name}" e indicou ${r.reading.proximos_passos?.length ?? 0} próximo(s) passo(s) para a renovação.`,
      metadata: { kind: 'contract_reading', agent: 'farmer' },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[leitura-contrato] erro em ${Date.now() - t0} ms:`, msg)
    await admin.from('contract_ai_readings').insert({
      contract_id: contractId, file_id: file.id, file_name: file.file_name, status: 'erro', error: msg.slice(0, 500), created_by: user.id,
    })
    return { ok: false, error: `A leitura falhou: ${msg}` }
  }

  revalidatePath(`/contracts/${contractId}`)
  return { ok: true }
}

// Cria uma atividade (Farmer) a partir de um próximo passo sugerido
export async function createActivityFromStep(contractId: string, step: ReadingStep): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) return { ok: false, error: 'Usuário não autenticado.' }
  const admin = await createScopedAdmin(await resolveTenantId({ contractId }))
  const { data: contract } = await admin.from('contracts').select('id, owner_id').eq('id', contractId).maybeSingle()
  if (!contract) return { ok: false, error: 'Contrato não encontrado.' }
  const today = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10)
  const date = step.prazo && /^\d{4}-\d{2}-\d{2}$/.test(step.prazo) ? (step.prazo < today ? today : step.prazo) : today
  const { error } = await admin.from('activities').insert({
    contract_id: contractId,
    user_id: user.id,
    assigned_to: contract.owner_id ?? user.id,
    type: 'task',
    activity_type: 'task',
    title: `Farmer · ${step.acao}`.slice(0, 200),
    content: `[Farmer] ${step.motivo}${step.clausula ? ` (${step.clausula})` : ''} — área: ${step.area}.`,
    status: 'planned',
    completed: false,
    activity_date: date,
    metadata: { source: 'copiloto_ia', agent: 'farmer', kind: 'renewal_step', from_reading: true },
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/contracts/${contractId}`)
  return { ok: true }
}
