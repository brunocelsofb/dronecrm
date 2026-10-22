// Lista das fotos das peças para exportação (servidor). Nome no .zip: fotos/CODIGO/01.jpg
import type { createScopedAdmin } from '@/lib/tenant/scoped-admin'

export const PHOTOS_PER_PART = 250

export async function listProductPhotos(db: Awaited<ReturnType<typeof createScopedAdmin>>, tenantId: string): Promise<{ path: string; name: string }[]> {
  const { data } = await db.from('retail_products').select('code, photos').order('code').limit(10000)
  const out: { path: string; name: string }[] = []
  for (const p of data ?? []) {
    const code = String(p.code).replace(/[^A-Za-z0-9._-]/g, '_')
    ;((p.photos as string[] | null) ?? []).filter(path => path.startsWith(`${tenantId}/`)).forEach((path, i) => {
      const ext = (path.match(/\.([a-z0-9]{2,5})$/i)?.[1] ?? 'jpg').toLowerCase()
      out.push({ path, name: `fotos/${code}/${String(i + 1).padStart(2, '0')}.${ext}` })
    })
  }
  return out
}
