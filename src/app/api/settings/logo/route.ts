import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveTenantId } from '@/lib/tenant/context'
import { assertTenantRef, storeDownloadLogo } from '@/lib/files/store'

export async function GET(request: NextRequest) {
  const path = request.nextUrl.searchParams.get('path')
  if (!path) return NextResponse.json({ error: 'Caminho ausente.' }, { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  // Logo da própria empresa (imagens públicas; logos antigos na pasta de propostas)
  const tenantId = await resolveTenantId()
  const legacy = /^logo\//.test(path) && !path.includes('..')
  if (!legacy && !assertTenantRef(path, tenantId)) return NextResponse.json({ error: 'Logo não encontrado.' }, { status: 404 })
  const { data, error } = await storeDownloadLogo(path)

  if (error || !data) {
    return NextResponse.json({ error: 'Logo não encontrado.' }, { status: 404 })
  }

  const buffer = await data.arrayBuffer()
  const contentType = data.type && data.type !== 'application/octet-stream' ? data.type : (path.endsWith('.png') ? 'image/png' : 'image/jpeg')

  return new NextResponse(Buffer.from(buffer), {
    headers: { 'Content-Type': contentType, 'Cache-Control': 'private, max-age=3600' },
  })
}
