import { storeDownload } from '@/lib/files/store'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ proposalId: string }> }
) {
  const { proposalId } = await params
  const supabase = await createClient()

  const { data: proposal } = await supabase
    .from('proposals')
    .select('pdf_storage_path')
    .eq('id', proposalId)
    .maybeSingle()

  if (!proposal?.pdf_storage_path) {
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
