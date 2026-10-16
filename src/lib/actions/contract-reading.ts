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

// Lê o contrato e TODOS os aditivos (aba "Contrato e aditivos") numa leitura só.
// Só o Admin da empresa pode disparar: cada leitura tem custo de IA.
export async function readContractWithAI(contractId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Usuário não autenticado.' }
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (me?.role !== 'admin') return { ok: false, error: 'Só o Admin do CRM pode pedir a leitura do contrato (cada leitura tem custo de IA).' }

  const tenantId = await resolveTenantId({ contractId })
  const admin = await createScopedAdmin(tenantId)
  const [{ data: contract }, { data: files }, { data: org }] = await Promise.all([
    admin.from('contracts').select('id, client_name, process_number, valid_from, valid_until, monthly_value').eq('id', contractId).maybeSingle(),
    admin.from('contract_files').select('id, file_name, storage_path, mime_type, file_size, document_kind, created_at')
      .eq('contract_id', contractId).in('document_kind', ['contrato', 'aditivo']).order('created_at', { ascending: true }),
    admin.from('organization_settings').select('company_name').limit(1).maybeSingle(),
  ])
  if (!contract) return { ok: false, error: 'Contrato não encontrado.' }
  const isPdf = (f: { mime_type: string | null; file_name: string | null }) => (f.mime_type ?? '').includes('pdf') || /\.pdf$/i.test(f.file_name ?? '')
  // contrato(s) primeiro, depois aditivos na ordem em que foram anexados
  const docs = (files ?? []).filter(isPdf).sort((a, b) => (a.document_kind === b.document_kind ? 0 : a.document_kind === 'contrato' ? -1 : 1))
  if (!docs.some(d => d.document_kind === 'contrato')) return { ok: false, error: 'Anexe o contrato em PDF nesta aba (como "Contrato") para o Farmer ler.' }
  const totalSize = docs.reduce((a, d) => a + (d.file_size ?? 0), 0)
  if (totalSize > MAX_PDF_BYTES) return { ok: false, error: 'Contrato + aditivos passam de 20 MB juntos. Envie versões menores (sem imagens desnecessárias).' }

  const key = await getAnthropicKeyForTenant(tenantId)
  if (!key.key) return { ok: false, error: NO_AI_KEY_MESSAGE }

  const loaded: { id: string; name: string; kind: 'contrato' | 'aditivo'; base64: string }[] = []
  for (const d of docs) {
    const { data: blob, error: dlErr } = await admin.storage.from('contract-files').download(d.storage_path)
    if (dlErr || !blob) return { ok: false, error: `Não foi possível abrir "${d.file_name}": ${dlErr?.message ?? 'sem conteúdo'}` }
    loaded.push({ id: d.id, name: d.file_name ?? 'documento.pdf', kind: d.document_kind as 'contrato' | 'aditivo', base64: Buffer.from(await blob.arrayBuffer()).toString('base64') })
  }
  const nAd = loaded.filter(d => d.kind === 'aditivo').length
  const label = `${loaded.find(d => d.kind === 'contrato')!.name}${nAd ? ` + ${nAd} aditivo(s)` : ''}`

  const t0 = Date.now()
  console.log(`[leitura-contrato] início · contrato ${contractId} · ${label} (${totalSize} bytes) · chave ${key.source}`)
  try {
    const r = await readContractPdf({
      apiKey: key.key,
      docs: loaded,
      crm: {
        client_name: contract.client_name ?? '',
        process_number: contract.process_number ?? null,
        valid_from: contract.valid_from ?? null,
        valid_until: contract.valid_until ?? null,
        monthly_value: contract.monthly_value !== null ? Number(contract.monthly_value) : null,
        company: org?.company_name ?? 'empresa',
      },
    })
    console.log(`[leitura-contrato] ok em ${Date.now() - t0} ms · ${r.tokensIn}/${r.tokensOut} tokens · ${r.reading.proximos_passos.length} passos`)
    await admin.from('contract_ai_readings').insert({
      contract_id: contractId, file_id: loaded[0].id, file_ids: loaded.map(d => d.id), file_name: label, model: r.model,
      status: 'ok', result: r.reading, tokens_in: r.tokensIn, tokens_out: r.tokensOut, created_by: user.id,
    })
    await admin.from('activities').insert({
      contract_id: contractId, user_id: user.id, type: 'system',
      content: `🌱 Farmer leu "${label}" e indicou ${r.reading.proximos_passos.length} próximo(s) passo(s) para a renovação.`,
      metadata: { kind: 'contract_reading', agent: 'farmer' },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[leitura-contrato] erro em ${Date.now() - t0} ms:`, msg)
    await admin.from('contract_ai_readings').insert({
      contract_id: contractId, file_id: loaded[0].id, file_ids: loaded.map(d => d.id), file_name: label, status: 'erro', error: msg.slice(0, 500), created_by: user.id,
    })
    return { ok: false, error: `A leitura falhou: ${msg}` }
  }

  revalidatePath(`/contracts/${contractId}`)
  return { ok: true }
}

// Textos da IA podem trazer datas ISO (2026-09-08); na tarefa ficam no padrão brasileiro
const brDates = (s: string) => s.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, '$3/$2/$1')
const AREA_LABEL: Record<string, string> = { comercial: 'comercial', juridico: 'jurídico', tecnico: 'técnico', financeiro: 'financeiro', cliente: 'cliente' }

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
    title: brDates(`Farmer · ${step.acao}`).slice(0, 200),
    content: brDates(`[Farmer] ${step.motivo}${step.clausula ? ` (${step.clausula})` : ''} — área: ${AREA_LABEL[step.area] ?? step.area}.`),
    status: 'planned',
    completed: false,
    activity_date: date,
    metadata: { source: 'copiloto_ia', agent: 'farmer', kind: 'renewal_step', from_reading: true },
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/contracts/${contractId}`)
  return { ok: true }
}
