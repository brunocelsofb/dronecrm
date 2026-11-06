'use server'
// Envio e abertura de arquivos pelo navegador, pelo ponto único (Supabase ou R2).
// O servidor põe o prefixo da empresa, confere tamanho/tipo e bloqueia acesso de suporte (só leitura).
import { createClient } from '@/lib/supabase/server'
import { resolveTenantId } from '@/lib/tenant/context'
import { storePrepareUpload, storeSignedUrl, isR2Ref, assertTenantRef, FILE_BUCKETS, type FileBucket } from '@/lib/files/store'

const MAX_BYTES: Record<FileBucket, number> = {
  'contract-files': 50 * 1024 * 1024,
  'proposal-files': 50 * 1024 * 1024,
  'public-assets': 8 * 1024 * 1024,
}
const IMAGE_ONLY: Partial<Record<FileBucket, boolean>> = { 'public-assets': true }

async function userTenant(): Promise<{ tenantId: string; readOnly: boolean } | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const tenantId = await resolveTenantId()
  const { data: ro } = await supabase.rpc('in_support_session')
  return { tenantId, readOnly: ro === true }
}

export type PreparedUpload =
  | { ok: true; ref: string; kind: 'r2'; url: string }
  | { ok: true; ref: string; kind: 'supabase'; token: string; path: string }
  | { ok: false; error: string }

// relPath: caminho dentro da pasta da empresa (com ou sem o prefixo "<tenant>/")
export async function prepareFileUpload(bucket: FileBucket, relPath: string, contentType: string, size: number): Promise<PreparedUpload> {
  if (!FILE_BUCKETS.includes(bucket)) return { ok: false, error: 'Pasta inválida.' }
  const ctx = await userTenant()
  if (!ctx) return { ok: false, error: 'Faça login novamente.' }
  if (ctx.readOnly) return { ok: false, error: 'Acesso de suporte é só leitura.' }
  if (!Number.isFinite(size) || size <= 0) return { ok: false, error: 'Arquivo vazio.' }
  if (size > MAX_BYTES[bucket]) return { ok: false, error: `Arquivo maior que ${Math.round(MAX_BYTES[bucket] / 1024 / 1024)} MB.` }
  if (IMAGE_ONLY[bucket] && !/^image\//.test(contentType || '')) return { ok: false, error: 'Envie uma imagem.' }
  const rel = String(relPath ?? '').replace(/^\/+/, '')
  const path = rel.startsWith(`${ctx.tenantId}/`) ? rel : `${ctx.tenantId}/${rel}`
  if (path.includes('..')) return { ok: false, error: 'Caminho inválido.' }
  return storePrepareUpload(bucket, path, contentType || 'application/octet-stream')
}

// Link temporário para abrir/baixar um arquivo guardado (R2 ou Supabase).
// R2: só referência da própria empresa. Supabase: as regras do banco de arquivos decidem.
export async function getFileUrl(bucket: FileBucket, ref: string, opts: { download?: string; ttl?: number } = {}): Promise<string | null> {
  if (!FILE_BUCKETS.includes(bucket) || !ref) return null
  const ctx = await userTenant()
  if (!ctx) return null
  const ttl = Math.min(Math.max(opts.ttl ?? 3600, 60), 24 * 3600)
  if (isR2Ref(ref)) {
    if (!assertTenantRef(ref, ctx.tenantId)) return null
    return storeSignedUrl(bucket, ref, ttl, { download: opts.download })
  }
  const supabase = await createClient()
  const { data } = await supabase.storage.from(bucket).createSignedUrl(ref, ttl, opts.download ? { download: opts.download } : undefined)
  return data?.signedUrl ?? null
}
