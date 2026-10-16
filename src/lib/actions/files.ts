'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { resolveTenantId } from '@/lib/tenant/context'
import { onContractSigned } from '@/lib/contracts/signed-followup'

export type DocumentKind = 'arquivo' | 'contrato' | 'aditivo'
const KIND_LABEL: Record<DocumentKind, string> = { arquivo: 'Arquivo', contrato: 'Contrato', aditivo: 'Aditivo' }
const KINDS = new Set<DocumentKind>(['arquivo', 'contrato', 'aditivo'])

// Move o arquivo entre a aba Arquivos e a aba Contrato e aditivos
export async function setContractFileKind(fileId: string, contractId: string, kind: DocumentKind) {
  if (!KINDS.has(kind)) return { error: 'Tipo inválido.' }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Usuário não autenticado.' }
  const { data, error } = await supabase.from('contract_files').update({ document_kind: kind })
    .eq('id', fileId).eq('contract_id', contractId).select('file_name').maybeSingle()
  if (error) return { error: error.message }
  if (!data) return { error: 'Arquivo não encontrado.' }
  await supabase.from('activities').insert({
    contract_id: contractId, user_id: user.id, type: 'system',
    content: `"${data.file_name}" marcado como ${KIND_LABEL[kind].toLowerCase()}.`,
  })
  revalidatePath(`/contracts/${contractId}`)
  return { success: true }
}

export async function registerContractFile(
  contractId: string,
  fileName: string,
  storagePath: string,
  fileSize: number,
  mimeType: string,
  kind: DocumentKind = 'arquivo',
  alreadySigned = false
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { error: 'Usuário não autenticado.' }

  const { data: inserted, error } = await supabase.from('contract_files').insert({
    contract_id: contractId,
    file_name: fileName,
    storage_path: storagePath,
    file_size: fileSize,
    mime_type: mimeType,
    uploaded_by: user.id,
    document_kind: kind,
  }).select('id').single()

  if (error) return { error: error.message }

  await supabase.from('activities').insert({
    contract_id: contractId,
    user_id: user.id,
    type: 'system',
    content: `${KIND_LABEL[kind]} "${fileName}" anexado.`,
  })

  // Contrato/aditivo do cliente, assinado fora do CRM: mesma tarefa de "dar ganho"
  // e o mesmo aviso ao gestor que a ZapSign dispara quando todos assinam.
  if (alreadySigned && inserted && (kind === 'contrato' || kind === 'aditivo')) {
    const h = await headers()
    const host = h.get('x-forwarded-host') ?? h.get('host')
    await onContractSigned({
      tenantId: await resolveTenantId({ contractId }), contractId, documentName: fileName, kind,
      via: 'anexo', dedupeKey: `signed:anexo:${inserted.id}`, appUrl: host ? `https://${host}` : null,
    })
  }

  revalidatePath(`/contracts/${contractId}`)
  return { success: true }
}

export async function renameContractFile(fileId: string, contractId: string, newName: string) {
  const supabase = await createClient()
  const trimmed = newName.trim()

  if (!trimmed) return { error: 'O nome não pode ficar vazio.' }

  const { error } = await supabase
    .from('contract_files')
    .update({ file_name: trimmed })
    .eq('id', fileId)

  if (error) return { error: error.message }

  revalidatePath(`/contracts/${contractId}`)
  return { success: true }
}

export async function deleteContractFile(fileId: string, contractId: string, storagePath: string) {
  const supabase = await createClient()

  await supabase.storage.from('contract-files').remove([storagePath])
  await supabase.from('contract_files').delete().eq('id', fileId)

  revalidatePath(`/contracts/${contractId}`)
}

// Gera um link temporário de download (o arquivo é privado — não tem
// URL pública fixa). NOTA DE INCERTEZA: a duração exata que o link fica
// válido (aqui, 1 hora) é configurável; ajuste o número se precisar de
// mais tempo.
export async function getFileDownloadUrl(storagePath: string) {
  const supabase = await createClient()
  const { data, error } = await supabase.storage
    .from('contract-files')
    .createSignedUrl(storagePath, 3600)

  if (error || !data) return { error: error?.message ?? 'Falha ao gerar link.' }
  return { url: data.signedUrl }
}
