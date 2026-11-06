'use client'
// Envio de arquivo pelo navegador, pelo ponto único (Supabase ou R2): o servidor prepara um
// endereço temporário e o arquivo vai direto do navegador para o armazenamento.
// Devolve a referência a guardar no banco (no Supabase, o caminho; no R2, "r2:<caminho>").
import { createClient } from '@/lib/supabase/client'
import { prepareFileUpload } from '@/lib/actions/files-upload'
import type { FileBucket } from './store'

export async function uploadFile(bucket: FileBucket, relPath: string, file: File | Blob, contentType?: string): Promise<{ ref: string | null; error: string | null }> {
  const type = contentType || (file as File).type || 'application/octet-stream'
  const p = await prepareFileUpload(bucket, relPath, type, file.size)
  if (!p.ok) return { ref: null, error: p.error }
  if (p.kind === 'r2') {
    try {
      const r = await fetch(p.url, { method: 'PUT', body: file, headers: { 'content-type': type } })
      if (!r.ok) return { ref: null, error: `Falha no envio (${r.status}).` }
      return { ref: p.ref, error: null }
    } catch (e) { return { ref: null, error: (e as Error).message || 'Falha no envio.' } }
  }
  const { error } = await createClient().storage.from(bucket).uploadToSignedUrl(p.path, p.token, file, { contentType: type })
  return error ? { ref: null, error: error.message } : { ref: p.ref, error: null }
}
