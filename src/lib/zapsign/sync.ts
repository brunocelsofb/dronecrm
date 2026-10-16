// Atualiza um documento da ZapSign no CRM a partir da própria API da ZapSign
// (fonte da verdade). Usado pelo botão "Atualizar status" e pelo webhook —
// o webhook não confia no corpo recebido: só usa o token do documento e
// consulta a ZapSign com a chave da empresa dona do documento.
// Ao ficar assinado, o PDF assinado é baixado (o link da ZapSign vale 60 min)
// e guardado na aba "Contrato e aditivos" do contrato.

import { createAdminClient } from '@/lib/supabase/admin'
import { sanitizeStorageFileName } from '@/lib/utils/storage'
import { getZapSignDocument, type ZapSignDocument } from './api'

const STATUS_MAP: Record<string, string> = { pending: 'enviado', awaiting: 'enviado', signed: 'assinado', refused: 'recusado', expired: 'expirado' }

export type ZapSignDocRow = {
  id: string
  tenant_id: string
  contract_id: string
  name: string
  status: string
  zapsign_doc_token: string
  document_kind: 'contrato' | 'aditivo'
  signed_file_id: string | null
  created_by: string | null
}

export async function getTenantZapSignToken(tenantId: string): Promise<string | null> {
  const admin = createAdminClient()
  const { data } = await admin.from('organization_settings').select('zapsign_api_token').eq('tenant_id', tenantId).maybeSingle()
  return data?.zapsign_api_token ?? null
}

export async function syncZapSignDoc(doc: ZapSignDocRow, apiToken: string): Promise<{ status: string; savedSignedFile: boolean }> {
  const admin = createAdminClient()
  const api: ZapSignDocument = await getZapSignDocument(apiToken, doc.zapsign_doc_token)
  const status = STATUS_MAP[api.status] ?? 'enviado'
  const signers = (api.signers ?? []).map(s => ({ name: s.name, email: s.email, status: s.status, sign_url: s.sign_url, signed_at: s.signed_at ?? null }))
  const update: Record<string, unknown> = { status, signers, last_sync_at: new Date().toISOString() }
  let savedSignedFile = false

  if (status === 'assinado' && !doc.signed_file_id && api.signed_file) {
    const res = await fetch(api.signed_file, { cache: 'no-store' })
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer())
      const fileName = `${doc.name} (assinado).pdf`
      const storagePath = `${doc.contract_id}/${Date.now()}-${sanitizeStorageFileName(fileName)}`
      const up = await admin.storage.from('contract-files').upload(storagePath, buf, { contentType: 'application/pdf' })
      if (!up.error) {
        const { data: file } = await admin.from('contract_files').insert({
          tenant_id: doc.tenant_id, contract_id: doc.contract_id, file_name: fileName, storage_path: storagePath,
          file_size: buf.byteLength, mime_type: 'application/pdf', uploaded_by: doc.created_by, document_kind: doc.document_kind,
        }).select('id').single()
        if (file) { update.signed_file_id = file.id; savedSignedFile = true }
      } else {
        console.error('[zapsign] falha ao guardar PDF assinado:', up.error.message)
      }
    } else {
      console.error('[zapsign] falha ao baixar PDF assinado:', res.status)
    }
  }
  if (status === 'assinado' && doc.status !== 'assinado') update.signed_at = new Date().toISOString()

  await admin.from('zapsign_documents').update(update).eq('id', doc.id).eq('tenant_id', doc.tenant_id)

  if (status !== doc.status && (status === 'assinado' || status === 'recusado' || status === 'expirado')) {
    const content = status === 'assinado'
      ? `✅ "${doc.name}" assinado por todos os signatários.${savedSignedFile ? ' O PDF assinado foi guardado na aba Contrato e aditivos.' : ''}`
      : status === 'recusado' ? `❌ "${doc.name}" foi recusado por um dos signatários.` : `🕐 "${doc.name}" expirou na ZapSign sem todas as assinaturas.`
    await admin.from('activities').insert({
      tenant_id: doc.tenant_id, contract_id: doc.contract_id, type: 'system', content,
      metadata: { kind: 'zapsign', zapsign_doc_token: doc.zapsign_doc_token },
    })
  }
  return { status, savedSignedFile }
}
