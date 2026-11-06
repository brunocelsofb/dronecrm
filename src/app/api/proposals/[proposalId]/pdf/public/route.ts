import { storeDownload } from '@/lib/files/store'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ proposalId: string }> }
) {
  const { proposalId } = await params
  const token = request.nextUrl.searchParams.get('token')

  if (!token) return NextResponse.json({ error: 'Token ausente.' }, { status: 401 })

  const supabase = createAdminClient()

  const { data: proposal } = await supabase
    .from('proposals')
    .select('pdf_storage_path, token')
    .eq('id', proposalId)
    .maybeSingle()

  // Confirma que o token bate com o desta proposta — é isso que
  // substitui o login aqui, já que é uma rota pública.
  if (!proposal || proposal.token !== token) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })
  }

  if (!proposal.pdf_storage_path) {
    return NextResponse.json({ error: 'PDF não encontrado.' }, { status: 404 })
  }

  const { data, error } = await storeDownload('proposal-files', proposal.pdf_storage_path)

  if (error || !data) {
    return NextResponse.json({ error: 'Falha ao carregar o PDF.' }, { status: 404 })
  }

  const buffer = await data.arrayBuffer()

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="proposta.pdf"',
    },
  })
}
