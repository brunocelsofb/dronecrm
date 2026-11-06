import { NextResponse } from 'next/server'
import { storeSignedUrl } from '@/lib/files/store'

// Imagens públicas guardadas no R2 (logos, fundos de telas públicas): /f/public-assets/<tenant>/...
// Só a pasta pública é servida aqui; o resto (contratos, propostas) exige login (getFileUrl).
export async function GET(_req: Request, ctx: { params: Promise<{ key: string[] }> }) {
  const { key } = await ctx.params
  const [bucket, ...rest] = (key ?? []).map(decodeURIComponent)
  const path = rest.join('/')
  if (bucket !== 'public-assets' || !path || path.includes('..')) return new NextResponse('Não encontrado', { status: 404 })
  const url = await storeSignedUrl('public-assets', `r2:${path}`, 6 * 3600)
  if (!url) return new NextResponse('Não encontrado', { status: 404 })
  return NextResponse.redirect(url, { status: 302, headers: { 'Cache-Control': 'public, max-age=3600' } })
}
