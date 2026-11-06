// ─── Arquivos: ponto único (Supabase Storage ou Cloudflare R2) ──────────────────
// Todo o CRM grava, lê e apaga arquivos por aqui. A pasta (bucket) decide o destino:
//   - R2: quando R2_BUCKETS (env) inclui a pasta e as chaves do R2 existem.
//   - Supabase: o resto (e tudo que já estava lá antes — os antigos continuam abrindo).
// Referência guardada no banco:
//   - Supabase: o caminho dentro da pasta, como sempre ("<tenant>/contratos/x.pdf").
//   - R2: "r2:" + o caminho ("r2:<tenant>/contratos/x.pdf"); no R2 a chave é "<pasta>/<caminho>".
// Isolamento por empresa: no Supabase, as regras do banco de arquivos; no R2, este módulo
// (gravação só com o prefixo da empresa; leitura só de referência da empresa — assertTenantRef).
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createRawAdminClient } from '@/lib/supabase/admin'

export type FileBucket = 'contract-files' | 'proposal-files' | 'public-assets'
export const FILE_BUCKETS: FileBucket[] = ['contract-files', 'proposal-files', 'public-assets']
const R2_PREFIX = 'r2:'

export const isR2Ref = (ref: unknown): boolean => typeof ref === 'string' && ref.startsWith(R2_PREFIX)
export const refPath = (ref: string) => (isR2Ref(ref) ? ref.slice(R2_PREFIX.length) : ref)

function r2Config() {
  const account = process.env.R2_ACCOUNT_ID
  const key = process.env.R2_ACCESS_KEY_ID
  const secret = process.env.R2_SECRET_ACCESS_KEY
  const bucket = process.env.R2_BUCKET
  return account && key && secret && bucket ? { account, key, secret, bucket } : null
}

// Pastas que já gravam no R2 (env R2_BUCKETS="public-assets,contract-files,...")
export function r2EnabledFor(bucket: FileBucket): boolean {
  if (!r2Config()) return false
  return String(process.env.R2_BUCKETS ?? '').split(',').map(s => s.trim()).includes(bucket)
}

let client: S3Client | null = null
function s3(): { c: S3Client; bucket: string } {
  const cfg = r2Config()
  if (!cfg) throw new Error('R2 não configurado.')
  client ??= new S3Client({
    region: 'auto',
    endpoint: `https://${cfg.account}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: cfg.key, secretAccessKey: cfg.secret },
  })
  return { c: client, bucket: cfg.bucket }
}
const r2Key = (bucket: FileBucket, path: string) => `${bucket}/${path.replace(/^\/+/, '')}`
const safePath = (p: string) => !!p && !p.includes('..') && !p.startsWith('/')

// Referência pertence à empresa? (caminhos de arquivo começam com "<tenant_id>/")
export function assertTenantRef(ref: string | null | undefined, tenantId: string): boolean {
  if (!ref) return false
  const p = refPath(ref)
  return safePath(p) && p.startsWith(`${tenantId}/`)
}

// ── Gravar (servidor) ─────────────────────────────────────────────────────────
export async function storeUpload(
  bucket: FileBucket, path: string, body: ArrayBuffer | Uint8Array | Blob | Buffer,
  opts: { contentType?: string; upsert?: boolean } = {},
): Promise<{ ref: string | null; error: string | null }> {
  if (!safePath(path)) return { ref: null, error: 'Caminho inválido.' }
  if (r2EnabledFor(bucket)) {
    try {
      const { c, bucket: b } = s3()
      const bytes = body instanceof Blob ? new Uint8Array(await body.arrayBuffer()) : body instanceof ArrayBuffer ? new Uint8Array(body) : body
      await c.send(new PutObjectCommand({ Bucket: b, Key: r2Key(bucket, path), Body: bytes, ContentType: opts.contentType }))
      return { ref: R2_PREFIX + path, error: null }
    } catch (e) { return { ref: null, error: (e as Error).message || 'Falha ao gravar o arquivo.' } }
  }
  const { error } = await createRawAdminClient().storage.from(bucket).upload(path, body as ArrayBuffer, { contentType: opts.contentType, upsert: opts.upsert ?? false })
  return error ? { ref: null, error: error.message } : { ref: path, error: null }
}

// Envio pelo navegador: o servidor prepara um endereço temporário de gravação.
// path já deve vir com o prefixo da empresa (quem chama garante — ver actions/files-upload.ts).
export async function storePrepareUpload(bucket: FileBucket, path: string, contentType: string):
  Promise<{ ok: true; ref: string; kind: 'r2'; url: string } | { ok: true; ref: string; kind: 'supabase'; token: string; path: string } | { ok: false; error: string }> {
  if (!safePath(path)) return { ok: false, error: 'Caminho inválido.' }
  if (r2EnabledFor(bucket)) {
    try {
      const { c, bucket: b } = s3()
      const url = await getSignedUrl(c, new PutObjectCommand({ Bucket: b, Key: r2Key(bucket, path), ContentType: contentType || 'application/octet-stream' }), { expiresIn: 600 })
      return { ok: true, ref: R2_PREFIX + path, kind: 'r2', url }
    } catch (e) { return { ok: false, error: (e as Error).message || 'Falha ao preparar o envio.' } }
  }
  const { data, error } = await createRawAdminClient().storage.from(bucket).createSignedUploadUrl(path)
  if (error || !data) return { ok: false, error: error?.message ?? 'Falha ao preparar o envio.' }
  return { ok: true, ref: path, kind: 'supabase', token: data.token, path: data.path }
}

// ── Ler ───────────────────────────────────────────────────────────────────────
export async function storeDownload(bucket: FileBucket, ref: string): Promise<{ data: Blob | null; error: { message: string } | null }> {
  // Mesmo formato do Supabase ({ data, error: { message } }) para trocar sem mudar quem chama
  if (isR2Ref(ref)) {
    try {
      const { c, bucket: b } = s3()
      const r = await c.send(new GetObjectCommand({ Bucket: b, Key: r2Key(bucket, refPath(ref)) }))
      const bytes = await r.Body?.transformToByteArray()
      if (!bytes) return { data: null, error: { message: 'Arquivo vazio.' } }
      return { data: new Blob([bytes as BlobPart], { type: r.ContentType ?? 'application/octet-stream' }), error: null }
    } catch (e) { return { data: null, error: { message: (e as Error).message || 'Arquivo não encontrado.' } } }
  }
  const { data, error } = await createRawAdminClient().storage.from(bucket).download(ref)
  return { data: data ?? null, error: error ? { message: error.message } : null }
}

// Caminho vindo de um endereço (sem o "r2:"): se a pasta já usa o R2, procura lá e, se não
// achar, no Supabase (arquivos antigos). Usado pelas rotas que servem arquivo por endereço.
export async function storeDownloadByPath(bucket: FileBucket, path: string) {
  if (r2EnabledFor(bucket)) {
    const r = await storeDownload(bucket, R2_PREFIX + path)
    if (r.data) return r
  }
  return storeDownload(bucket, path)
}

export async function storeSignedUrl(bucket: FileBucket, ref: string, ttlSeconds = 3600, opts: { download?: string } = {}): Promise<string | null> {
  if (isR2Ref(ref)) {
    try {
      const { c, bucket: b } = s3()
      return await getSignedUrl(c, new GetObjectCommand({
        Bucket: b, Key: r2Key(bucket, refPath(ref)),
        ...(opts.download ? { ResponseContentDisposition: `attachment; filename="${opts.download.replace(/"/g, '')}"` } : {}),
      }), { expiresIn: ttlSeconds })
    } catch { return null }
  }
  const { data } = await createRawAdminClient().storage.from(bucket).createSignedUrl(ref, ttlSeconds, opts.download ? { download: opts.download } : undefined)
  return data?.signedUrl ?? null
}

// Endereço permanente de imagem pública (logo, fundos). R2: servido por /f/... (redireciona)
export function storePublicUrl(bucket: FileBucket, ref: string): string {
  if (/^https?:\/\//.test(ref)) return ref
  if (isR2Ref(ref)) {
    const base = (process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? 'https://app.comercialdrone.com.br').replace(/\/+$/, '')
    return `${base}/f/${bucket}/${refPath(ref).split('/').map(encodeURIComponent).join('/')}`
  }
  return createRawAdminClient().storage.from(bucket).getPublicUrl(ref).data.publicUrl
}

// ── Apagar ────────────────────────────────────────────────────────────────────
export async function storeRemove(bucket: FileBucket, refs: (string | null | undefined)[]): Promise<{ error: string | null }> {
  const list = refs.filter((r): r is string => !!r)
  const r2 = list.filter(isR2Ref).map(r => refPath(r)).filter(safePath)
  const sb = list.filter(r => !isR2Ref(r))
  let err: string | null = null
  if (r2.length) {
    try {
      const { c, bucket: b } = s3()
      for (let i = 0; i < r2.length; i += 1000) {
        await c.send(new DeleteObjectsCommand({ Bucket: b, Delete: { Objects: r2.slice(i, i + 1000).map(p => ({ Key: r2Key(bucket, p) })), Quiet: true } }))
      }
    } catch (e) { err = (e as Error).message }
  }
  if (sb.length) {
    const { error } = await createRawAdminClient().storage.from(bucket).remove(sb)
    if (error) err = error.message
  }
  return { error: err }
}

// Endereço público (Supabase ou /f/ do R2) → referência guardada (para apagar o arquivo)
export function refFromPublicUrl(bucket: FileBucket, url: string | null | undefined): string | null {
  if (!url) return null
  const r2Mark = `/f/${bucket}/`
  if (url.includes(r2Mark)) return R2_PREFIX + decodeURIComponent(url.split(r2Mark).pop() ?? '').split('?')[0]
  const sbMark = `/${bucket}/`
  if (url.includes('/storage/v1/object/') && url.includes(sbMark)) return decodeURIComponent(url.split(sbMark).pop() ?? '').split('?')[0]
  return null
}

// Logo da empresa: hoje fica nas imagens públicas; logos antigos ficaram na pasta de propostas.
export async function storeDownloadLogo(ref: string) {
  const a = await storeDownload('public-assets', ref)
  if (a.data) return a
  return storeDownload('proposal-files', ref)
}

// Referência vinda do navegador pode ser registrada por esta empresa? Arquivo no R2 só se for
// da pasta da empresa (no R2 não há a trava do banco). Caminhos do Supabase seguem as regras
// do próprio banco de arquivos, como antes.
export async function refOk(ref: string | null | undefined): Promise<boolean> {
  if (!ref) return true
  if (!isR2Ref(ref)) return !ref.includes('..')
  const { getCurrentTenantId } = await import('@/lib/tenant/context')
  const tenantId = await getCurrentTenantId()
  return !!tenantId && assertTenantRef(ref, tenantId)
}
