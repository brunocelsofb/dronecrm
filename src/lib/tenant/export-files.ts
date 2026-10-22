// ─── Arquivos de exportação (dados e fotos) ──────────────────────────────────
// A Vercel limita a resposta de cada função a 4,5 MB. Por isso o .zip vai para um
// bucket privado (tenant-exports), na pasta da empresa, e a pessoa baixa por um
// link assinado de 10 minutos. Arquivos antigos são apagados a cada exportação e
// pelo cron diário de privacidade.

import { createRawAdminClient } from '@/lib/supabase/admin'

export const EXPORT_BUCKET = 'tenant-exports'
const folder = (tenantId: string) => `${tenantId}/exportacoes`

// Apaga exportações da empresa mais velhas que maxAgeMs
export async function purgeOldExports(tenantId: string, maxAgeMs: number): Promise<number> {
  const storage = createRawAdminClient().storage.from(EXPORT_BUCKET)
  const { data } = await storage.list(folder(tenantId), { limit: 1000 })
  const limit = Date.now() - maxAgeMs
  const old = (data ?? []).filter(f => f.name && Date.parse(f.created_at ?? '') < limit).map(f => `${folder(tenantId)}/${f.name}`)
  if (old.length) await storage.remove(old)
  return old.length
}

export async function storeExport(tenantId: string, fileName: string, bytes: Uint8Array, contentType = 'application/zip'): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const storage = createRawAdminClient().storage.from(EXPORT_BUCKET)
  await purgeOldExports(tenantId, 15 * 60_000).catch(() => 0)
  const path = `${folder(tenantId)}/${Date.now()}-${fileName}`
  const up = await storage.upload(path, bytes, { contentType, upsert: false })
  if (up.error) return { ok: false, error: `Falha ao guardar o arquivo: ${up.error.message}` }
  const { data, error } = await storage.createSignedUrl(path, 600, { download: fileName })
  if (error || !data?.signedUrl) return { ok: false, error: error?.message ?? 'Falha ao gerar o link.' }
  return { ok: true, url: data.signedUrl }
}
